/**
 * The session-key login (monkey-trading/console#68, #168): the setup popup's one wallet signature
 * authorizes an in-browser key, and orders, cancels, and the cancel-all and close-all batches then
 * sign with it, no wallet prompt per request (`session-signed.ts`). Deposits, withdrawals and vault
 * claims never use it: the engine refuses a session key's funds request. The key lives on the store
 * and in the entry `session-key-store.ts` keeps, written only once the node has registered it, and
 * never in the snapshot, a message or a log.
 */

import { signBlock } from "../engine/attestation";
import { EngineError, type ActionResult } from "../engine/client";
import { registerSessionKeyTypedData, revokeSessionKeyTypedData, type Terms } from "../engine/eip712";
import { saveSessionKey, type KeyScope } from "../engine/session-key-store";
import { sessionKeyExpiry } from "../engine/session-key-limits";
import type { SessionKeySigner } from "../engine/session-key";
import { sessionKeySigner } from "../engine/session-key-class";
import type { Wallet } from "../engine/wallet";
import { formatStamp } from "../time";
import { describeReject } from "../messages";
import { DISCONNECTED, domainOf, errorText, notBusy, prompting, REQUEST_TTL_MS } from "./signing";
import type { NoticeSurface } from "./state";
import type { ConsoleStore } from "./store";

/** What the login asks the wallet to sign, shown in the prompt and passed to the wallet. */
const authorizeSummary = (expiresAt: number) => `authorize this browser to trade until ${formatStamp(expiresAt)} UTC`;

/** The live session key, or null when none is registered or the node's clock has passed its registration. */
export function liveSessionKey(store: ConsoleStore): SessionKeySigner | null {
  const key = store.sessionKey;
  const { sessionExpiresAt, now } = store.getSnapshot();
  return key !== null && sessionExpiresAt > now ? key : null;
}

/** What a stored key for this wallet is scoped to. */
export const keyScope = (store: ConsoleStore, wallet: Wallet): KeyScope => ({ account: wallet.address, chainId: store.deps.client.deployment.chainId, vault: store.deps.client.deployment.vault });

/** Makes `key` this connection's session key until `expiresAt`. */
export function installKey(store: ConsoleStore, key: SessionKeySigner, expiresAt: number): void {
  store.sessionKey = key;
  store.patch({ sessionExpiresAt: expiresAt, sessionRefusal: null });
}

/**
 * Runs the login once: asks the wallet for the one `RegisterSessionKey` signature over the
 * connection's candidate key and posts the registration. False leaves the wallet connected with no
 * key, with the reason on `surface`, where the user asked for the login. One candidate keypair serves every attempt of a connection, as
 * the engine's client contract settles it: re-registering a known key never counts against the caps.
 * The key is stored only once the node has registered it, so storage never holds one that did not land.
 */
export async function loginSession(store: ConsoleStore, surface: NoticeSurface): Promise<boolean> {
  // Silent gate: the popup's step says why it waits, and its button stays off until signing is possible.
  const wallet = store.liveWallet;
  if (wallet === null || wallet.readOnly === true) return false;
  const blocked = signBlock(store.getSnapshot().attestation, store.getSnapshot().stream, false);
  if (blocked !== null) return false;
  store.patch({ sessionRefusal: null });
  const key = (store.sessionKey ??= sessionKeySigner().generate());
  try {
    const { next_nonce, time_ms } = await store.deps.client.nonce(wallet.address);
    const now = time_ms ?? store.getSnapshot().now;
    const sessionExpiresAt = sessionKeyExpiry(now);
    const terms: Terms = { nonce: next_nonce, expiresAt: now + REQUEST_TTL_MS };
    const summary = authorizeSummary(sessionExpiresAt);
    const attempt = async (nonce: number) => {
      // The connection may have ended while the nonce read waited: its wallet is not asked.
      if (store.liveWallet !== wallet) throw DISCONNECTED;
      const typed = registerSessionKeyTypedData(domainOf(store), wallet.address, key.address, sessionExpiresAt, { ...terms, nonce });
      const signature = await prompting(store, wallet, surface, `Confirm in your wallet: ${summary}. It covers trading only — deposits and withdrawals will still ask each time.`, () => wallet.sign({ summary, typed }));
      // Or while the wallet asked: nothing registers for a connection that ended.
      if (store.liveWallet !== wallet) throw DISCONNECTED;
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
    // Only this connection's wallet may take the answer.
    if (store.liveWallet !== wallet) return false;
    const refused = result.events.find((e) => e.type === "session_key_rejected");
    if (refused && refused.type === "session_key_rejected") {
      store.patch({ sessionRefusal: refused.reason });
      // The setup step shows the refusal itself, with the way out; anywhere else it is said where the login was asked for.
      if (surface !== "setup") store.notify(surface, describeReject(refused.reason));
      return false;
    }
    if (!result.events.some((e) => e.type === "session_key_registered")) throw new Error("The node did not register the session key.");
    installKey(store, key, sessionExpiresAt);
    if (store.deps.persistence !== undefined) saveSessionKey(store.deps.persistence, keyScope(store, wallet), key, sessionExpiresAt);
    return true;
  } catch (error) {
    if (store.liveWallet !== wallet) return false; // disconnected mid-login: nothing to report
    if (!store.noteAccess(error)) store.notify(surface, errorText(error));
    return false;
  }
}

/** The login a caller may kick freely: concurrent calls share one attempt, so two presses never open two wallet prompts. */
export function ensureLogin(store: ConsoleStore, surface: NoticeSurface): Promise<boolean> {
  if (liveSessionKey(store) !== null) return Promise.resolve(true);
  if (store.sessionLogin === null) {
    const attempt = loginSession(store, surface);
    store.sessionLogin = attempt;
    void attempt.finally(() => {
      // A disconnect already discarded this attempt: never erase a newer connection's login.
      if (store.sessionLogin === attempt) store.sessionLogin = null;
    });
  }
  return store.sessionLogin;
}

/** The one wallet signature that authorizes this browser, busy while the wallet asks. True once this browser holds a live key. */
export async function authorizeBrowser(store: ConsoleStore, surface: NoticeSurface): Promise<boolean> {
  const wallet = store.liveWallet;
  if (wallet === null) return false;
  store.clearNotice(surface);
  store.patch({ busy: true });
  try {
    return await ensureLogin(store, surface);
  } finally {
    notBusy(store, wallet);
  }
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
    const signature = await prompting(store, null, "wallet", `Confirm in your wallet: ${summary}.`, () => wallet.sign({ summary, typed }));
    await store.deps.client.revokeSessionKey({ account: wallet.address, session_key: key.address, auth: { nonce: next_nonce, expires_at: expiresAt, signature } });
  } catch {
    // Best effort, as the issue settles it: an unrevoked key dies at its expiry either way.
    store.notify("wallet", "The trading authorization was not revoked; it expires on its own.", "info");
  }
}
