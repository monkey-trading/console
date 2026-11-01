/**
 * Session keys as the engine's V41 rules model them (monkey-trading/console#68): an account-signed
 * registration authorizes an ephemeral key to place and cancel orders — never to move funds — until
 * its expiry or an account-signed revocation, and a request's signer is the account key or one of
 * its registered keys. The mock checks no signature, so `identifySigner` in `orders` names the
 * signer the way the flow always presents it: the account's own nonce sequence first, then the
 * sequence of the registered key the nonce matches (the console asks each signer's next nonce
 * before signing).
 */

import { EngineError, type ActionResult } from "../engine/client";
import type { Reject, SessionKeyRequest, SessionKeyRevocationRequest } from "../engine/types";
import { checkAccess, checkAuth } from "./orders";
import type { MockSessionKey, MockState } from "./state";

/** The engine's registration-expiry cap (`MAX_SESSION_KEY_EXPIRY_MS`). */
export const MAX_SESSION_KEY_EXPIRY_MS = 24 * 60 * 60 * 1000;
/** The engine's live-key cap (`MAX_SESSION_KEYS_PER_ACCOUNT`). */
export const MAX_SESSION_KEYS_PER_ACCOUNT = 10;

/** Drops the account's expired and revoked keys, as each registration prunes first. */
function prune(state: MockState, accountKey: string): Map<string, MockSessionKey> {
  let keys = state.sessionKeys.get(accountKey);
  if (keys === undefined) {
    keys = new Map();
    state.sessionKeys.set(accountKey, keys);
  }
  for (const [key, entry] of keys) if (entry.revoked || state.now > entry.expiresAt) keys.delete(key);
  return keys;
}

function rejected(state: MockState, cmd: "register_session_key" | "revoke_session_key", req: { account: string; session_key: string }, reason: Reject): ActionResult {
  const events = [{ type: "session_key_rejected" as const, account: req.account, session_key: req.session_key, reason }];
  return { seq: state.emit({ type: cmd }, events).seq, events };
}

/**
 * Registers `session_key` for the account until `expires_at`, account-signed, as the engine's
 * `register_session_key` does: prunes dead keys first, caps the expiry at 24 hours and the live
 * count at ten, and replaces a re-registered known key.
 */
export function registerSessionKey(state: MockState, req: SessionKeyRequest): ActionResult {
  checkAccess(state);
  // As the node's authorise refuses any account-signed request for a never-credited account.
  if (!state.credited.has(req.account.toLowerCase())) throw new EngineError(403, "account has never been credited");
  const account = state.account(req.account);
  checkAuth(state, account, req.auth);
  const accountKey = req.account.toLowerCase();
  const sessionKey = req.session_key.toLowerCase();
  if (sessionKey === accountKey) return rejected(state, "register_session_key", req, { kind: "invalid_session_key" });
  const keys = prune(state, accountKey);
  const held = keys.get(sessionKey);
  if (held === undefined && keys.size >= MAX_SESSION_KEYS_PER_ACCOUNT) return rejected(state, "register_session_key", req, { kind: "too_many_session_keys", max: MAX_SESSION_KEYS_PER_ACCOUNT });
  if (req.expires_at <= state.now) return rejected(state, "register_session_key", req, { kind: "expired", expires_at: req.expires_at });
  if (req.expires_at > state.now + MAX_SESSION_KEY_EXPIRY_MS) return rejected(state, "register_session_key", req, { kind: "expiry_too_far", latest: state.now + MAX_SESSION_KEY_EXPIRY_MS });
  // The key owns its nonce sequence from registration, as the engine seeds `request_nonces`: even
  // a key pruned before its first request keeps its replay protection.
  state.sessionKeyNonces.set(sessionKey, state.sessionKeyNonces.get(sessionKey) ?? 0);
  keys.set(sessionKey, { expiresAt: req.expires_at, revoked: false });
  const events = [{ type: "session_key_registered" as const, account: req.account, session_key: req.session_key, expires_at: req.expires_at }];
  return { seq: state.emit({ type: "register_session_key" }, events).seq, events };
}

/** Revokes `session_key` for the account, account-signed; an unknown key refuses as the engine's `InvalidSessionKey`. */
export function revokeSessionKey(state: MockState, req: SessionKeyRevocationRequest): ActionResult {
  checkAccess(state);
  const account = state.account(req.account);
  checkAuth(state, account, req.auth);
  const key = state.sessionKeys.get(req.account.toLowerCase())?.get(req.session_key.toLowerCase());
  if (key === undefined) return rejected(state, "revoke_session_key", req, { kind: "invalid_session_key" });
  key.revoked = true;
  const events = [{ type: "session_key_revoked" as const, account: req.account, session_key: req.session_key }];
  return { seq: state.emit({ type: "revoke_session_key" }, events).seq, events };
}
