/** What the vault's refusal of a claim says in plain words, for the MONKEY and USDC distribution claims. */

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

const SELECTORS = REFUSALS.map(([signature, text]) => ({ name: signature.slice(0, signature.indexOf("(")), text, selector: toFunctionSelector(`function ${signature}`).slice(2).toLowerCase() }));

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

/**
 * `error` from a claim transaction, with a contract revert it carries replaced by a plain message
 * naming what the vault refused. The user's own refusal and every failure that is not a revert pass
 * through unchanged.
 */
export function claimFailure(error: unknown): unknown {
  if (declinedByUser(error)) return error;
  const raw = error instanceof Error && error.cause !== undefined ? error.cause : error;
  if (!isRevert(raw)) return error;
  const carried = texts(raw).join(" ").toLowerCase();
  const known = SELECTORS.find(({ name, selector }) => carried.includes(selector) || carried.includes(name.toLowerCase()));
  return new Error(known?.text ?? GENERIC, { cause: error });
}
