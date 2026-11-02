/**
 * The session-key login (monkey-trading/console#68): one wallet signature at connect authorizes an
 * ephemeral in-browser key, and orders, cancels, and the cancel-all and close-all batches then sign
 * with it — no wallet prompt per request. Deposits, withdrawals and vault claims never use it: the engine refuses a session key's
 * funds request. The keypair lives only in the store, never in the snapshot or browser storage.
 */

import { signBlock } from "../engine/attestation";
import { EngineError, type ActionResult } from "../engine/client";
import { registerSessionKeyTypedData, revokeSessionKeyTypedData, type Terms, type TypedRequest } from "../engine/eip712";
import { SessionKeySigner, sessionKeyExpiry } from "../engine/session-key";
import type { RequestAuth, StreamMessage } from "../engine/types";
import { UntrustedError } from "../engine/trust";
import type { Wallet } from "../engine/wallet";
import { formatStamp } from "../time";
import { describeReject } from "../messages";
import { domainOf, errorText, prompting, REQUEST_TTL_MS, signed, usableWallet, type OnNonceTaken, type Outcome } from "./signing";
import type { ConsoleStore } from "./store";

/** What the login asks the wallet to sign, shown in the prompt and passed to the wallet. */
const authorizeSummary = (expiresAt: number) => `authorize this browser to trade until ${formatStamp(expiresAt)} UTC`;

/** The live session key, or null when the login has not run or the node's clock has passed its registration. */
export function liveSessionKey(store: ConsoleStore): SessionKeySigner | null {
  const key = store.sessionKey;
  return key !== null && store.sessionKeyExpiresAt > store.getSnapshot().now ? key : null;
}

/**
 * Runs the login once: asks the wallet for the one `RegisterSessionKey` signature over the
 * connection's candidate key and posts the registration. False leaves the wallet connected but
 * trading unsigned, with the reason already shown — except for a never-credited account, where the
 * registration is expected to refuse until the first deposit credits; the login runs then, on the
 * deposit's event. One candidate keypair serves every attempt of a connection, as the engine's
 * client contract settles it: re-registering a known key never counts against the caps.
 */
export async function loginSession(store: ConsoleStore): Promise<boolean> {
  // Silent gate: user actions toast their own refusal, and the feed-live hook retries here once signing is possible.
  const wallet = store.liveWallet;
  if (wallet === null || wallet.readOnly === true) return false;
  const blocked = signBlock(store.getSnapshot().attestation, store.getSnapshot().stream, false);
  if (blocked !== null) return false;
  store.sessionLoginRefusal = null;
  const key = (store.sessionKey ??= SessionKeySigner.generate());
  try {
    const { next_nonce, time_ms } = await store.deps.client.nonce(wallet.address);
    const now = time_ms ?? store.getSnapshot().now;
    const sessionExpiresAt = sessionKeyExpiry(now);
    const terms: Terms = { nonce: next_nonce, expiresAt: now + REQUEST_TTL_MS };
    const summary = authorizeSummary(sessionExpiresAt);
    const attempt = async (nonce: number) => {
      const typed = registerSessionKeyTypedData(domainOf(store), wallet.address, key.address, sessionExpiresAt, { ...terms, nonce });
      const signature = await prompting(store, `Confirm in your wallet: ${summary}. It covers trading only — deposits and withdrawals will still ask each time.`, () => wallet.sign({ summary, typed }));
      return store.deps.client.registerSessionKey({ account: wallet.address, session_key: key.address, expires_at: sessionExpiresAt, auth: { nonce, expires_at: terms.expiresAt, signature } });
    };
    let result: ActionResult;
    try {
      result = await attempt(next_nonce);
    } catch (error) {
      // A nonce spent by a concurrent account request is re-signed once with the nonce the node names.
      if (!(error instanceof EngineError) || error.reject?.kind !== "invalid_nonce") throw error;
      result = await attempt(error.reject.expected);
    }
    // The wallet may have disconnected (or another connected) while the prompt waited: only this
    // connection's wallet may take the answer.
    if (store.liveWallet !== wallet) return false;
    const refused = result.events.find((e) => e.type === "session_key_rejected");
    if (refused && refused.type === "session_key_rejected") {
      store.sessionLoginRefusal = refused.reason;
      store.toast("error", describeReject(refused.reason));
      return false;
    }
    if (!result.events.some((e) => e.type === "session_key_registered")) throw new Error("The node did not register the session key.");
    store.sessionKeyExpiresAt = sessionExpiresAt;
    return true;
  } catch (error) {
    if (store.liveWallet !== wallet) return false; // disconnected mid-login: nothing to report
    if (error instanceof EngineError && error.status === 403 && error.message === "account has never been credited") return false; // expected before the first deposit credits; the deposit's event retries
    if (!store.noteAccess(error)) store.toast("error", errorText(error));
    return false;
  }
}

/**
 * The login a caller may kick freely: concurrent calls share one attempt, so two actions at once
 * never open two wallet prompts. `force` re-runs the login even when a key is live — the node said
 * the key died, whatever the store's clock thinks.
 */
export function ensureLogin(store: ConsoleStore, force = false): Promise<boolean> {
  if (!force && liveSessionKey(store) !== null) return Promise.resolve(true);
  if (store.sessionLogin === null) {
    const attempt = loginSession(store);
    store.sessionLogin = attempt;
    void attempt.finally(() => {
      // A disconnect already discarded this attempt: never erase a newer connection's login.
      if (store.sessionLogin === attempt) store.sessionLogin = null;
    });
  }
  return store.sessionLogin;
}

/**
 * Runs the login when one of the account's deposits credits it, so a fresh account is asked for the
 * one signature at the moment trading becomes possible, not at every connect. `deposited` is the
 * only trigger: the engine credits a first deposit at its declaration or its finality, and both
 * paths emit `deposited` — `eligibility_attested` can precede crediting, where a registration must
 * refuse and would spend a signature for nothing.
 */
export function loginOnCredit(store: ConsoleStore, events: StreamMessage["events"], mine: string | undefined): void {
  if (mine === undefined || store.liveWallet === null || store.liveWallet.readOnly === true || liveSessionKey(store) !== null) return;
  if (events.some((e) => e.type === "deposited" && e.account.toLowerCase() === mine)) void ensureLogin(store);
}

/**
 * Runs the login when the feed first turns live, for a connect that found it still starting: the
 * account was credited but the prompt waited for a verified feed.
 */
export function loginWhenLive(store: ConsoleStore): void {
  const state = store.getSnapshot();
  if (state.account === null || store.liveWallet === null || store.liveWallet.readOnly === true || liveSessionKey(store) !== null || store.sessionLogin !== null) return;
  void ensureLogin(store);
}

/**
 * Revokes the session key with one wallet signature, best effort: a decline or a failed request
 * leaves the registration to expire on its own. Runs before the wallet's session is released, so
 * a WalletConnect pairing can still sign.
 */
export async function revokeSession(store: ConsoleStore, wallet: Wallet, key: SessionKeySigner): Promise<void> {
  try {
    const blocked = signBlock(store.getSnapshot().attestation, store.getSnapshot().stream, false);
    if (blocked !== null) throw new Error(`signing is blocked: ${blocked}`);
    const { next_nonce, time_ms } = await store.deps.client.nonce(wallet.address);
    const expiresAt = (time_ms ?? store.getSnapshot().now) + REQUEST_TTL_MS;
    const typed = revokeSessionKeyTypedData(domainOf(store), wallet.address, key.address, { nonce: next_nonce, expiresAt });
    const summary = "revoke this browser's trading authorization";
    const signature = await prompting(store, `Confirm in your wallet: ${summary}.`, () => wallet.sign({ summary, typed }));
    await store.deps.client.revokeSessionKey({ account: wallet.address, session_key: key.address, auth: { nonce: next_nonce, expires_at: expiresAt, signature } });
  } catch {
    // Best effort, as the issue settles it: an unrevoked key dies at its expiry either way.
    store.toast("info", "The trading authorization was not revoked; it expires on its own.");
  }
}

/** The 401 refusals that mean the key died since it last signed: the login runs once and the request is retried. */
const keyDied = (error: unknown): boolean =>
  error instanceof EngineError && error.status === 401 && ["invalid signature", "session key revoked", "session key expired"].includes(error.message);

/**
 * Signs and sends one order, cancel, or batch of them with the session key: silent, no wallet prompt. When the
 * login has not run or its key has died, the one-signature login runs first; a 401 that says the
 * key died mid-flight re-runs the login once and retries with the fresh key. A 429 asks the user
 * to wait. Error cases: as `signed` in `signing`, plus no session key when the wallet will not
 * authorize one.
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
  // Busy across the on-demand login too: a second Trade press waits instead of queueing a second order.
  store.patch({ busy: true });
  /** Whether the request left the page: from then on it may have run, whatever comes back. */
  let sent = false;
  try {
    if (liveSessionKey(store) === null) {
      const loggedIn = await ensureLogin(store);
      // The login waited on the wallet: this connection must still be the one that asked.
      if (store.liveWallet !== wallet) return { ok: false };
      if (liveSessionKey(store) === null) {
        // The node refuses registrations (for example the ten-key cap): the wallet signs, as before
        // this feature, so a position can always close and an order always has a way through.
        if (!loggedIn && store.sessionLoginRefusal !== null) {
          store.toast("info", `${describeReject(store.sessionLoginRefusal)} This request will ask your wallet instead.`);
          return signed(store, summary, build, send, onNonceTaken);
        }
        return { ok: false };
      }
    }
    const key = liveSessionKey(store);
    if (key === null) return { ok: false };
    /** Signs and sends once, abandoning silently when the connection ended or changed while the nonce read waited. */
    const attempt = async (withKey: SessionKeySigner, nonce: number, validUntil: number) => {
      if (store.liveWallet !== wallet) throw DISCONNECTED;
      const typed = build({ nonce, expiresAt: validUntil }, wallet.address);
      const signature = await withKey.sign(typed);
      if (store.liveWallet !== wallet) throw DISCONNECTED;
      sent = true;
      return send({ nonce, expires_at: validUntil, signature }, wallet);
    };
    try {
      const { next_nonce, time_ms } = await store.deps.client.nonce(key.address);
      const expiresAt = (time_ms ?? store.getSnapshot().now) + REQUEST_TTL_MS;
      try {
        return { ok: true, result: await attempt(key, next_nonce, expiresAt) };
      } catch (error) {
        if (error instanceof EngineError && error.reject?.kind === "invalid_nonce") {
          // As `signed`: a cancel is re-signed with the nonce the node names; an order is reported, since a copy may have run.
          if (onNonceTaken === "sign-again") return { ok: true, result: await attempt(key, error.reject.expected, expiresAt) };
          throw new EngineError(error.status, `The node had already used nonce ${next_nonce} for this account, so it did not take this request as sent. If it was sent twice it may have run: check your positions, orders, withdrawals and history before trying again.`);
        }
        // A key the node no longer admits (revoked, expired, or unknown after a restart) re-runs the login once.
        if (keyDied(error) && (await ensureLogin(store, true)) && store.liveWallet === wallet) {
          const fresh = liveSessionKey(store);
          if (fresh !== null) {
            // Fresh terms from the answer after the re-login: the first expiry may already be past.
            const terms = await store.deps.client.nonce(fresh.address);
            const freshExpiry = (terms.time_ms ?? store.getSnapshot().now) + REQUEST_TTL_MS;
            return { ok: true, result: await attempt(fresh, terms.next_nonce, freshExpiry) };
          }
        }
        throw error;
      }
    } catch (error) {
      if (error === DISCONNECTED) return { ok: false }; // the connection ended mid-action: nothing to report
      throw error;
    }
  } catch (error) {
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
    store.patch({ busy: false });
  }
}

/** The sentinel an abandoned action throws when its connection ends between the nonce read and the send. */
const DISCONNECTED = new Error("The connection ended before the request was sent.");
