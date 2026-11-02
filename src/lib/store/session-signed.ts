/**
 * The session-signed path orders, cancels and the two batches take: silent, no wallet prompt. Trading
 * never registers a key (monkey-trading/console#168). With none, setup reopens; a registration the
 * node refused sends the request through the wallet instead, so a position can always close; and a
 * key the node no longer admits ends the connection on its first refusal, so the page is never stuck
 * retrying with it and reconnecting brings setup back.
 */

import { EngineError, type ActionResult } from "../engine/client";
import type { Terms, TypedRequest } from "../engine/eip712";
import type { RequestAuth } from "../engine/types";
import { UntrustedError } from "../engine/trust";
import type { Wallet } from "../engine/wallet";
import { describeReject } from "../messages";
import { liveSessionKey } from "./session";
import { openSetup } from "./setup";
import { DISCONNECTED, errorText, notBusy, REQUEST_TTL_MS, signed, usableWallet, type OnNonceTaken, type Outcome } from "./signing";
import type { ConsoleStore } from "./store";
import { KEY_REFUSED, sessionEnded } from "./wallet-session";

/** The 401 refusals that mean the node no longer admits the key: revoked, expired, or unknown to it, as after a restarted chain or a registration that never landed. */
const keyDied = (error: unknown): boolean =>
  error instanceof EngineError && error.status === 401 && ["invalid signature", "session key revoked", "session key expired"].includes(error.message);

/** The nonce the node named when it refused the whole request in the log for losing its nonce, or null. */
function nonceLostInLog(result: ActionResult): number | null {
  for (const event of result.events) if (event.type === "order_rejected" && event.reason.kind === "invalid_nonce") return event.reason.expected;
  return null;
}

/**
 * Signs and sends one order, cancel, or batch of them with the session key. A 429 asks the user to
 * wait. Two tabs share one key and its nonce sequence, so a tab can lose the race for a nonce: a
 * cancel signs again with the nonce the node names, and an order is reported, never sent again, since
 * a copy of it may have run. Error cases: as `signed` in `signing`.
 */
export async function sessionSigned(
  store: ConsoleStore,
  summary: string,
  build: (terms: Terms, account: string) => TypedRequest,
  send: (auth: RequestAuth, wallet: Wallet) => Promise<ActionResult>,
  onNonceTaken: OnNonceTaken,
): Promise<Outcome> {
  const wallet = usableWallet(store, "sign");
  if (!wallet) return { ok: false };
  const key = liveSessionKey(store);
  if (key === null) {
    const refusal = store.getSnapshot().sessionRefusal;
    if (refusal !== null) {
      store.toast("info", `${describeReject(refusal)} This request will ask your wallet instead.`);
      return signed(store, summary, build, send, onNonceTaken);
    }
    openSetup(store);
    return { ok: false };
  }
  store.patch({ busy: true });
  /** Whether the request left the page: from then on it may have run, whatever comes back. */
  let sent = false;
  try {
    const { next_nonce, time_ms } = await store.deps.client.nonce(key.address);
    const expiresAt = (time_ms ?? store.getSnapshot().now) + REQUEST_TTL_MS;
    /** Signs and sends once, abandoning silently when the connection ended or changed while the nonce read waited. */
    const attempt = async (nonce: number) => {
      if (store.liveWallet !== wallet) throw DISCONNECTED;
      const typed = build({ nonce, expiresAt }, wallet.address);
      const signature = await key.sign(typed);
      if (store.liveWallet !== wallet) throw DISCONNECTED;
      sent = true;
      return send({ nonce, expires_at: expiresAt, signature }, wallet);
    };
    try {
      const result = await attempt(next_nonce);
      // Two tabs can pass the node's admission on one nonce: the loser's refusal is then in the log.
      const expected = onNonceTaken === "sign-again" ? nonceLostInLog(result) : null;
      return { ok: true, result: expected === null ? result : await attempt(expected) };
    } catch (error) {
      if (!(error instanceof EngineError) || error.reject?.kind !== "invalid_nonce") throw error;
      // As `signed`: a cancel is re-signed with the nonce the node names; an order is reported, since a copy may have run.
      if (onNonceTaken === "sign-again") return { ok: true, result: await attempt(error.reject.expected) };
      throw new EngineError(error.status, `The node had already used nonce ${next_nonce} for this account, so it did not take this request as sent. If it was sent twice it may have run: check your positions, orders, withdrawals and history before trying again.`);
    }
  } catch (error) {
    if (error === DISCONNECTED || (!sent && store.liveWallet !== wallet)) return { ok: false }; // the connection ended mid-action: nothing to report
    if (keyDied(error)) {
      // Only the key that signed has died. The connection may have ended, or another tab's newer key been adopted, while the answer came.
      if (store.liveWallet === wallet && store.sessionKey?.address === key.address) sessionEnded(store, KEY_REFUSED);
      else if (store.liveWallet === wallet) store.toast("error", "This browser's trading authorization changed while the request was on its way, and the node refused it. Try again.");
      return { ok: false };
    }
    if (error instanceof EngineError && error.status === 429) {
      store.toast("error", "The node is limiting requests; try again in a moment.");
      return { ok: false };
    }
    if (store.noteAccess(error)) return { ok: false };
    // A sent request the node refused, left unanswered, or answered unverifiably may still have run: read the account first.
    if (sent) await store.refresh(true);
    const unanswered = error instanceof UntrustedError || (error instanceof EngineError && error.status === 0);
    const unknown = sent && unanswered ? " It may have run: check your positions, orders, withdrawals and history before trying again." : "";
    store.toast("error", `${errorText(error)}${unknown}`);
    return { ok: false };
  } finally {
    notBusy(store, wallet);
  }
}
