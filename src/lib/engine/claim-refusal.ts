/** What the vault's refusal of a claim says in plain words: the MONKEY and USDC distribution claims, and a withdrawal's claim. */

import { toFunctionSelector } from "viem";

import { declinedByUser, isRevert } from "./provider-errors";

/** The vault's custom errors a claim can end in, each with what it means for the trader. */
const REFUSALS = [
  ["UnknownCheckpoint()", "The vault has not recorded the checkpoint this proof was built against, so it refused the claim and nothing was sent. The node's next proof will name one it has; try again shortly."],
  ["InvalidSignerEpoch()", "The vault's signer has changed since the checkpoint this proof was built against, so it refused the claim and nothing was sent. The new signer's first checkpoint brings a fresh proof; try again once it posts."],
  ["NoSigner()", "The vault has no signer right now, so it accepts no claims and nothing was sent. Try again once governance has installed one."],
  ["NothingToClaim(uint256,uint256)", "The vault has already paid everything this proof covers, so nothing was sent."],
  ["InvalidEntitlementProof()", "The vault did not accept the node's proof, so nothing was sent. Try again shortly."],
  ["ExitActive()", "The vault is in its exit, which ends claims, so nothing was sent."],
] as const;

/** What a refusal table holds once each error has its selector. */
type Table = { name: string; text: string; selector: string }[];
const tableOf = (refusals: readonly (readonly [string, string])[]): Table => refusals.map(([signature, text]) => ({ name: signature.slice(0, signature.indexOf("(")), text, selector: toFunctionSelector(`function ${signature}`).slice(2).toLowerCase() }));
const SELECTORS = tableOf(REFUSALS);

/**
 * The vault's custom errors a withdrawal's claim can end in. What the withdrawal flow offers next is
 * its "Ask for a new authorization" button, which appears once the authorization's expiry has passed
 * on the console's clock, and the node's own reissue after a change of signer.
 */
const WITHDRAWAL_REFUSALS = [
  ["InvalidWithdrawalTime()", "This withdrawal's 24-hour authorization has passed on the vault's clock, so it refused the claim and nothing was sent. When the withdrawal shows its authorization as expired, ask for a new one."],
  ["UnknownCheckpoint()", "The vault has not recorded the checkpoint this authorization names, so it refused the claim and nothing was sent. Try again shortly."],
  ["InvalidSignerEpoch()", "The vault's signer has changed since this authorization was signed, so it refused the claim and nothing was sent. The node signs a new authorization under the new signer, which arrives here by itself; you can also ask for one."],
  ["WithdrawalAlreadyPaid()", "The vault has already paid this withdrawal, so nothing was sent."],
  ["WithdrawalsPaused()", "Withdrawals are paused at the vault, so nothing was sent. Try again once the pause ends."],
  ["NoSigner()", "The vault has no signer right now, so it accepts no claims and nothing was sent. Try again once governance has installed one."],
  ["ExitActive()", "The vault is in its exit, which ends claims, so nothing was sent."],
] as const;
const WITHDRAWAL_SELECTORS = tableOf(WITHDRAWAL_REFUSALS);

/** The vault's refusal of a withdrawal's claim for any revert whose error is not named above. */
const WITHDRAWAL_GENERIC = "The vault refused the claim and nothing was sent: it did not accept this authorization. Try again shortly, or ask for a new authorization if the withdrawal offers one.";

/** The vault's refusal for any revert whose error is not named above. */
const GENERIC = "The vault refused the claim and nothing was sent: its record does not match the node's proof. Try again shortly.";

/** Every string a wallet's error carries, at the top and under `data`, `originalError` or `cause`. */
function texts(error: unknown, depth = 0): string[] {
  if (depth > 4 || error === null || error === undefined) return [];
  if (typeof error === "string") return [error];
  if (typeof error !== "object") return [];
  const found: string[] = [];
  for (const key of ["message", "data", "originalError", "cause", "reason"]) {
    if (key in error) found.push(...texts((error as Record<string, unknown>)[key], depth + 1));
  }
  return found;
}

function refusal(error: unknown, table: Table, generic: string): unknown {
  if (declinedByUser(error)) return error;
  const raw = error instanceof Error && error.cause !== undefined ? error.cause : error;
  if (!isRevert(raw)) return error;
  const carried = texts(raw).join(" ").toLowerCase();
  const known = table.find(({ name, selector }) => carried.includes(selector) || carried.includes(name.toLowerCase()));
  return new Error(known?.text ?? generic, { cause: error });
}

/**
 * `error` from a distribution claim transaction, with a contract revert it carries replaced by a
 * plain message naming what the vault refused. The user's own refusal and every failure that is not
 * a revert pass through unchanged.
 */
export const claimFailure = (error: unknown): unknown => refusal(error, SELECTORS, GENERIC);

/** `claimFailure` for a withdrawal's claim, whose errors and next steps differ. */
export const withdrawalFailure = (error: unknown): unknown => refusal(error, WITHDRAWAL_SELECTORS, WITHDRAWAL_GENERIC);
