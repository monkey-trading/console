/**
 * The session-key login (monkey-trading/console#68): one wallet signature at connect authorizes an
 * ephemeral in-browser key, and orders and cancels then sign with it — no wallet prompt per
 * request. Deposits, withdrawals and vault claims never use it: the engine refuses a session key's
 * funds request. The keypair lives only in the store, never in the snapshot or browser storage.
 */

import { EngineError, type ActionResult } from "../engine/client";
import { registerSessionKeyTypedData, revokeSessionKeyTypedData, type Terms, type TypedRequest } from "../engine/eip712";
import { SessionKeySigner, sessionKeyExpiry } from "../engine/session-key";
import type { RequestAuth, StreamMessage } from "../engine/types";
import { UntrustedError } from "../engine/trust";
import type { Wallet } from "../engine/wallet";
import { formatStamp } from "../time";
import { describeReject } from "../messages";
import { domainOf, errorText, prompting, REQUEST_TTL_MS, usableWallet, type OnNonceTaken, type Outcome } from "./signing";
import type { ConsoleStore } from "./store";

/** What the login asks the wallet to sign, shown in the prompt and passed to the wallet. */
const authorizeSummary = (expiresAt: number) => `authorize this browser to trade until ${formatStamp(expiresAt)} UTC`;

/** The live session key, or null when the login has not run or the node's clock has passed its registration. */
export function liveSessionKey(store: ConsoleStore): SessionKeySigner | null {
  const key = store.sessionKey;
  return key !== null && store.sessionKeyExpiresAt > store.getSnapshot().now ? key : null;
}

/**
 * Runs the login once: generates an ephemeral key, asks the wallet for the one `RegisterSessionKey`
 * signature, and posts the registration. False leaves the wallet connected but trading unsigned,
 * with the reason already shown — except for a never-credited account, where the registration is
 * expected to refuse until the first deposit credits; the login runs then, on the deposit's event.
 */
export async function loginSession(store: ConsoleStore): Promise<boolean> {
  const wallet = usableWallet(store, "authorize trading");
  if (!wallet) return false;
  store.patch({ busy: true });
  const key = SessionKeySigner.generate();
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
    const refused = result.events.find((e) => e.type === "session_key_rejected");
    if (refused && refused.type === "session_key_rejected") {
      store.toast("error", describeReject(refused.reason));
      return false;
    }
    if (!result.events.some((e) => e.type === "session_key_registered")) throw new Error("The node did not register the session key.");
    store.sessionKey = key;
    store.sessionKeyExpiresAt = sessionExpiresAt;
    return true;
  } catch (error) {
    if (error instanceof EngineError && error.status === 403 && error.message === "account has never been credited") return false; // expected before the first deposit credits; the deposit's event retries
    if (!store.noteAccess(error)) store.toast("error", errorText(error));
    return false;
  } finally {
    store.patch({ busy: false });
  }
}

/**
 * The login a caller may kick freely: concurrent calls share one attempt, so two actions at once
 * never open two wallet prompts. `force` re-runs the login even when a key is live — the node said
 * the key died, whatever the store's clock thinks.
 */
export function ensureLogin(store: ConsoleStore, force = false): Promise<boolean> {
  if (!force && liveSessionKey(store) !== null) return Promise.resolve(true);
  store.sessionLogin ??= loginSession(store).finally(() => {
    store.sessionLogin = null;
  });
  return store.sessionLogin;
}

/**
 * Runs the login when one of the account's events says it has become credited — its first deposit
 * or its eligibility declaration — so a fresh account is asked for the one signature at the moment
 * trading becomes possible, not at every connect.
 */
export function loginOnCredit(store: ConsoleStore, events: StreamMessage["events"], mine: string | undefined): void {
  if (mine === undefined || store.liveWallet === null || store.liveWallet.readOnly === true || liveSessionKey(store) !== null) return;
  if (events.some((e) => (e.type === "deposited" || e.type === "eligibility_attested") && e.account.toLowerCase() === mine)) void ensureLogin(store);
}

/**
 * Revokes the session key with one wallet signature, best effort: a decline or a failed request
 * leaves the registration to expire on its own. Runs before the wallet's session is released, so
 * a WalletConnect pairing can still sign.
 */
export async function revokeSession(store: ConsoleStore, wallet: Wallet, key: SessionKeySigner): Promise<void> {
  try {
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
 * Signs and sends one order or cancel with the session key: silent, no wallet prompt. When the
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
  if (liveSessionKey(store) === null && !(await ensureLogin(store))) return { ok: false };
  const key = liveSessionKey(store);
  if (key === null) return { ok: false };
  store.patch({ busy: true });
  /** Whether the request left the page: from then on it may have run, whatever comes back. */
  let sent = false;
  try {
    const { next_nonce, time_ms } = await store.deps.client.nonce(key.address);
    const expiresAt = (time_ms ?? store.getSnapshot().now) + REQUEST_TTL_MS;
    const attempt = async (withKey: SessionKeySigner, nonce: number) => {
      const typed = build({ nonce, expiresAt }, wallet.address);
      const signature = await withKey.sign(typed);
      sent = true;
      return send({ nonce, expires_at: expiresAt, signature }, wallet);
    };
    try {
      return { ok: true, result: await attempt(key, next_nonce) };
    } catch (error) {
      if (error instanceof EngineError && error.reject?.kind === "invalid_nonce") {
        // As `signed`: a cancel is re-signed with the nonce the node names; an order is reported, since a copy may have run.
        if (onNonceTaken === "sign-again") return { ok: true, result: await attempt(key, error.reject.expected) };
        throw new EngineError(error.status, `The node had already used nonce ${next_nonce} for this account, so it did not take this request as sent. If it was sent twice it may have run: check your positions, orders, withdrawals and history before trying again.`);
      }
      // A key the node no longer admits (revoked, expired, or unknown after a restart) re-runs the login once.
      if (keyDied(error) && (await ensureLogin(store, true))) {
        const fresh = liveSessionKey(store);
        if (fresh !== null) return { ok: true, result: await attempt(fresh, (await store.deps.client.nonce(fresh.address)).next_nonce) };
      }
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
