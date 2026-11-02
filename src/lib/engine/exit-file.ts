/**
 * An account's saved exit proof (monkey-trading/console#36): as a browser's storage holds it, per
 * chain, vault and account, and as a file the trader exports and imports. Storage and files are
 * untrusted: what comes back is read as any proof is, and only the vault's check makes it usable.
 */

import { exitProofAccount, ExitProofError, parseExitProof } from "./exit-proof";
import type { ExitProof } from "./exit-types";
import type { Address } from "./types";

/** The most a file may hold, far past any one account's proof. */
export const MAX_EXIT_FILE_BYTES = 16 * 1024 * 1024;
const FILE_KIND = "monkeytrading.exit-proof";
const FILE_VERSION = 1;
const STORAGE_PREFIX = `${FILE_KIND}.v${FILE_VERSION}`;

/** The deployment and account a saved proof belongs to. */
export interface ExitScope {
  chainId: number;
  /** Lowercase `0x` hex. */
  vault: string;
  /** Lowercase `0x` hex. */
  account: Address;
}

/** A proof the vault's verifier accepted against the vault's latest root at the time. */
export interface ExitRecord extends ExitScope {
  proof: ExitProof;
  /** The vault's `lastCheckpointAt` when it was checked, in chain seconds: when its root was posted. */
  checkpointAt: number;
  /** What `accountClaim` answered, in USDC base units. */
  accountClaim: bigint;
  /** The distribution not yet paid when it was checked, in USDC base units. */
  distributionOwed: bigint;
  /** The approvals the vault showed paid when it was checked. The proof keeps them: the chain can still undo a payment, and what registers is read afresh. */
  paidApprovals: number[];
}

/** The part of browser storage a saved proof needs. */
export interface ExitStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** What an imported file held: the proof, and the deployment it names, null for the engine's offline builder, whose output names none. */
export interface ExitFile {
  proof: ExitProof;
  account: Address | null;
  chainId: number | null;
  vault: string | null;
}

/** What a read of storage came to; `problem` says why a value there could not be used, written for the user. */
export interface StoredExit {
  record: ExitRecord | null;
  problem: string | null;
}

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : "the browser refused");

/** The better of the proof in storage and the one in the page: the one at the vault's latest root, else the later. */
export function preferredRecord(stored: ExitRecord | null, held: ExitRecord | null, latestRoot: string | null): ExitRecord | null {
  if (stored === null || held === null) return stored ?? held;
  if (held.proof.root === latestRoot) return held;
  if (stored.proof.root === latestRoot) return stored;
  return stored.proof.seq > held.proof.seq ? stored : held;
}

/** Whether two records hold one proof, whatever the figures read with each. Both were read through `parseExitProof`, which sets the fields' order. */
export const sameProof = (a: ExitRecord, b: ExitRecord): boolean => JSON.stringify(a.proof) === JSON.stringify(b.proof);

/** The JSON a record is written as, in storage and in a file alike. */
export function exitFileText(record: ExitRecord): string {
  return JSON.stringify({
    kind: FILE_KIND, version: FILE_VERSION, chain_id: record.chainId, vault: record.vault, account: record.account,
    checkpoint_at: record.checkpointAt, account_claim: record.accountClaim.toString(), distribution_owed: record.distributionOwed.toString(), paid_approvals: record.paidApprovals, proof: record.proof,
  });
}

/** The name an exported file takes: the account and checkpoint it holds. */
export const exitFileName = (record: ExitRecord): string => `monkey-exit-proof-${record.account.slice(0, 10)}-${record.proof.seq}.json`;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new ExitProofError(`it is not JSON (${reasonOf(cause)})`);
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * What an imported file holds: this page's export, or what `engine exit-proof` prints, whose `account`
 * is the proof. Nothing here decides whether the proof is good, or is for the connected wallet.
 * Error cases:
 * - it is too long, not JSON, not either shape, or its proof does not read: `ExitProofError`
 */
export function parseExitFile(text: string): ExitFile {
  if (text.length > MAX_EXIT_FILE_BYTES) throw new ExitProofError("it is longer than any exit proof");
  const value = parseJson(text);
  if (!isObject(value)) throw new ExitProofError("it is not an exit proof");
  if (value.kind === FILE_KIND) {
    if (value.version !== FILE_VERSION) throw new ExitProofError(`it is version ${String(value.version)} of the format, and this console reads ${FILE_VERSION}`);
    const proof = parseExitProof(value.proof);
    const named = exitProofAccount(proof);
    const account = typeof value.account === "string" ? value.account.toLowerCase() : null;
    if (named !== null && named !== account) throw new ExitProofError("the account it names is not the one its proof names");
    return { proof, account, chainId: typeof value.chain_id === "number" ? value.chain_id : null, vault: typeof value.vault === "string" ? value.vault.toLowerCase() : null };
  }
  // `engine exit-proof`'s `ExitBundle`: its calls beside the proof they carry. For the house it holds no account's proof.
  if (Array.isArray(value.calls) && "account" in value) {
    if (value.account === null) throw new ExitProofError("it is the offline builder's output for the house, which holds no account's proof");
    const proof = parseExitProof(value.account);
    return { proof, account: exitProofAccount(proof), chainId: null, vault: null };
  }
  throw new ExitProofError("it is not an exit proof");
}

/** Where `scope`'s record is kept. */
export const exitStorageKey = (scope: ExitScope): string => `${STORAGE_PREFIX}.${scope.chainId}.${scope.vault}.${scope.account}`;

/** A value in storage as a record of `scope`; anything else is refused with `ExitProofError`. */
function recordFrom(text: string, scope: ExitScope): ExitRecord {
  const file = parseExitFile(text);
  if (file.account !== scope.account || file.chainId !== scope.chainId || file.vault !== scope.vault) throw new ExitProofError("it is for another account or deployment");
  // A file's own shape: `parseExitFile` read `kind` as this format's, whose writer gave these fields.
  const { checkpoint_at: checkpointAt, account_claim: accountClaim, distribution_owed: distributionOwed, paid_approvals: paidApprovals } = JSON.parse(text) as Record<string, unknown>;
  if (typeof checkpointAt !== "number" || !Number.isSafeInteger(checkpointAt) || typeof accountClaim !== "string" || !/^\d+$/.test(accountClaim) || typeof distributionOwed !== "string" || !/^\d+$/.test(distributionOwed)) throw new ExitProofError("its saved figures do not read");
  if (!Array.isArray(paidApprovals) || !paidApprovals.every((nonce) => Number.isSafeInteger(nonce))) throw new ExitProofError("its saved figures do not read");
  // Each was just checked as an integer.
  return { ...scope, proof: file.proof, checkpointAt, accountClaim: BigInt(accountClaim), distributionOwed: BigInt(distributionOwed), paidApprovals: paidApprovals as number[] };
}

/** What this browser holds for `scope`. Nothing throws: a denied or corrupt store is a problem for the page to show. */
export function readStoredExit(storage: () => ExitStorage | null, scope: ExitScope): StoredExit {
  let text: string | null;
  try {
    const store = storage();
    if (store === null) return { record: null, problem: "this browser's storage is not available" };
    text = store.getItem(exitStorageKey(scope));
  } catch (error) {
    return { record: null, problem: `this browser's storage is not available: ${reasonOf(error)}` };
  }
  try {
    return { record: text === null ? null : recordFrom(text, scope), problem: null };
  } catch (error) {
    return { record: null, problem: `the proof saved in this browser could not be read: ${reasonOf(error)}` };
  }
}

/** Saves `record`, replacing the one before it; why it was not saved, or null. */
export function writeStoredExit(storage: () => ExitStorage | null, record: ExitRecord): string | null {
  try {
    const store = storage();
    if (store === null) return "this browser's storage is not available";
    store.setItem(exitStorageKey(record), exitFileText(record));
    return null;
  } catch (error) {
    return `this browser's storage refused it: ${reasonOf(error)}`;
  }
}

/** Removes what is saved for `scope`; why it was not removed, or null. */
export function removeStoredExit(storage: () => ExitStorage | null, scope: ExitScope): string | null {
  try {
    storage()?.removeItem(exitStorageKey(scope));
    return null;
  } catch (error) {
    return reasonOf(error);
  }
}
