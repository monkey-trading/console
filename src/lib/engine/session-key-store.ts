/**
 * The session key the console keeps in `localStorage` until it expires (monkey-trading/console#168,
 * approved by the owner there), so a reload or a new tab reuses it with no signature. One entry per
 * account, chain and vault, so another account's or deployment's key is never used. Disclosed on
 * /notices. What a browser holds is untrusted input: anything that does not parse, or names another
 * account, chain or vault, or does not derive its own address, is discarded and never used. Nothing
 * here throws, and no value read reaches a message: storage is best-effort throughout, and a browser
 * that denies site data just asks for the signature again on its next load.
 */

import type { ChoiceStorage } from "./wallet-persist";
import { SessionKeySigner } from "./session-key";

/** `ChoiceStorage`, and what the sweep of dead entries reads. */
export interface KeyStorage extends ChoiceStorage {
  keys(): readonly string[];
}

/** What a stored key is for: the account it trades and the deployment that account's registration names. */
export interface KeyScope {
  readonly account: string;
  readonly chainId: number;
  readonly vault: string;
}

/** What a read found: nothing usable, a key past its expiry (now removed), or a key to use. */
export type StoredKey = { readonly kind: "none" } | { readonly kind: "expired" } | { readonly kind: "live"; readonly signer: SessionKeySigner; readonly expiresAt: number };

/** The prefix of every entry's name, and what tells the sweep an entry is one of these. */
const PREFIX = "monkeytrading.session-key.";
const PRIVATE_KEY = /^0x[0-9a-f]{64}$/;
const NONE: StoredKey = { kind: "none" };

/** The entry's fields, as written. */
interface Entry {
  privateKey: `0x${string}`;
  address: string;
  account: string;
  chainId: number;
  vault: string;
  expiresAt: number;
}

/** The storage name of `scope`'s entry. */
export const sessionKeyName = ({ account, chainId, vault }: KeyScope): string => `${PREFIX}${chainId}.${vault.toLowerCase()}.${account.toLowerCase()}`;

/** The entry `raw` holds when it has the shape this console writes, or null. */
function decode(raw: string | null): Entry | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // not JSON: not a value this console wrote
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const e = parsed as Record<string, unknown>; // narrowed just above to an object; each field is checked below
  if (typeof e.privateKey !== "string" || !PRIVATE_KEY.test(e.privateKey)) return null;
  if (typeof e.address !== "string" || typeof e.account !== "string" || typeof e.vault !== "string") return null;
  if (typeof e.chainId !== "number" || typeof e.expiresAt !== "number" || !Number.isSafeInteger(e.expiresAt) || e.expiresAt <= 0) return null;
  // The pattern above checked the value's form.
  return { privateKey: e.privateKey as `0x${string}`, address: e.address, account: e.account, chainId: e.chainId, vault: e.vault, expiresAt: e.expiresAt };
}

/** The signer of `privateKey` when it derives `address`, or null; the error a bad key throws names nothing and goes no further. */
function signerOf(privateKey: `0x${string}`, address: string): SessionKeySigner | null {
  try {
    const signer = SessionKeySigner.fromPrivateKey(privateKey);
    return signer.address.toLowerCase() === address.toLowerCase() ? signer : null;
  } catch {
    return null;
  }
}

/**
 * What `raw` holds for `scope` by the sequenced clock `nowMs`; 0 is a clock not known yet, as before a
 * page's first frame, and the store judges the expiry when it is. Nothing bounds an expiry from above: a
 * reader's clock may lag the node's, so a bound would delete live keys, and whoever could write a later
 * expiry already holds the key, whose registration the node enforces.
 */
export function readStoredKey(raw: string | null, scope: KeyScope, nowMs: number): StoredKey {
  const entry = decode(raw);
  if (entry === null) return NONE;
  if (entry.account.toLowerCase() !== scope.account.toLowerCase() || entry.vault.toLowerCase() !== scope.vault.toLowerCase() || entry.chainId !== scope.chainId) return NONE;
  const signer = signerOf(entry.privateKey, entry.address);
  if (signer === null) return NONE;
  if (entry.expiresAt <= nowMs) return { kind: "expired" };
  return { kind: "live", signer, expiresAt: entry.expiresAt };
}

/** Reads `scope`'s key, removing an entry it will not use. */
export function loadSessionKey(storage: ChoiceStorage, scope: KeyScope, nowMs: number): StoredKey {
  let raw: string | null;
  try {
    raw = storage.getItem(sessionKeyName(scope));
  } catch {
    return NONE; // storage denied: nothing is remembered
  }
  const found = readStoredKey(raw, scope, nowMs);
  if (raw !== null && found.kind !== "live") removeSessionKey(storage, scope);
  return found;
}

/** Writes `scope`'s key; a quota or permission failure leaves it in memory only, and a reload asks for the signature again. */
export function saveSessionKey(storage: ChoiceStorage, scope: KeyScope, signer: SessionKeySigner, expiresAt: number): void {
  const entry: Entry = { privateKey: signer.exportPrivateKey(), address: signer.address, account: scope.account.toLowerCase(), chainId: scope.chainId, vault: scope.vault.toLowerCase(), expiresAt };
  try {
    storage.setItem(sessionKeyName(scope), JSON.stringify(entry));
  } catch {
    // storage denied or full: the key simply is not remembered
  }
}

/**
 * Removes `scope`'s entry, or with `only` just while it holds that key address: a connection whose
 * key died never removes a newer key another tab registered under the shared name.
 */
export function removeSessionKey(storage: ChoiceStorage, scope: KeyScope, only?: string): void {
  try {
    const name = sessionKeyName(scope);
    if (only === undefined || decode(storage.getItem(name))?.address.toLowerCase() === only.toLowerCase()) storage.removeItem(name);
  } catch {
    // storage denied: nothing to remove anyway
  }
}

/** Removes every entry past its expiry by `nowMs` or not in the shape this console writes, whatever account it was for: no connection may ever come back to remove it. */
export function sweepSessionKeys(storage: KeyStorage, nowMs: number): void {
  try {
    for (const name of storage.keys()) {
      if (!name.startsWith(PREFIX)) continue;
      const entry = decode(storage.getItem(name));
      if (entry === null || entry.expiresAt <= nowMs) storage.removeItem(name);
    }
  } catch {
    // storage denied: nothing to sweep
  }
}
