/** What a contract's refusal says in plain words: the MONKEY minter's and the vault's refusal of the MONKEY claims, the vault's refusal of the USDC distribution claims and of a withdrawal's claim, and the vote contract's refusal of a vote. */

import { toFunctionSelector } from "viem";

import { declinedByUser, isRevert } from "./provider-errors";

/** The vault's custom errors a claim can end in, each with what it means for the trader. */
const REFUSALS = [
  ["UnknownCheckpoint()", "Your claim was not sent, because the vault has not yet recorded the snapshot on which your proof is based. Please try again shortly."],
  ["InvalidSignerEpoch()", "Your claim was not sent, because the vault's signing key has changed since the snapshot on which your proof is based. A new proof will be available once the vault has recorded the first snapshot under the new signing key, so please try again then."],
  ["NoSigner()", "Your claim was not sent, because the vault currently has no signing key and accepts no claims. Please try again once a new signing key has been installed."],
  ["NothingToClaim(uint256,uint256)", "Your claim was not sent, because the vault has already paid everything your proof covers."],
  ["InvalidEntitlementProof()", "Your claim was not sent, because the vault did not accept the proof provided by the server. Please try again shortly."],
  ["ExitActive()", "Your claim was not sent, because the vault's exit has started and normal claims have ended. A staking distribution can still be registered through the vault's exit on the Funding page."],
] as const;

/** What a refusal table holds once each error has its selector. */
type Table = { name: string; text: string; selector: string }[];
const tableOf = (refusals: readonly (readonly [string, string])[]): Table => refusals.map(([signature, text]) => ({ name: signature.slice(0, signature.indexOf("(")), text, selector: toFunctionSelector(`function ${signature}`).slice(2).toLowerCase() }));
const SELECTORS = tableOf(REFUSALS);

/**
 * The custom errors a MONKEY claim can end in: the minter's own, and the vault's, which the minter
 * passes on when the vault will not give it the root of the checkpoint the proof names.
 */
const EMISSIONS_REFUSALS = [
  ...REFUSALS.slice(0, 3),
  ["VaultNotSet()", "Your claim was not sent, because MONKEY claims have not yet been opened. Please try again once they have."],
  ["NothingToClaim(uint256,uint256)", "Your claim was not sent, because you have already claimed everything your proof covers."],
  ["InvalidEntitlementProof()", "Your claim was not sent, because the proof provided by the server was not accepted. Please try again shortly."],
] as const;
const EMISSIONS_SELECTORS = tableOf(EMISSIONS_REFUSALS);

/**
 * The vault's custom errors a withdrawal's claim can end in. What the withdrawal flow offers next is
 * its "Renew the claim" button, which appears once the authorization's expiry has passed on the
 * console's clock, and the node's own reissue after a change of signer.
 */
const WITHDRAWAL_REFUSALS = [
  ["InvalidWithdrawalTime()", "Your claim was not sent, because the 24-hour approval for this withdrawal has expired. Once the withdrawal shows that it can no longer be claimed, select Renew the claim to request a new approval."],
  ["UnknownCheckpoint()", "Your claim was not sent, because the vault has not yet recorded the snapshot that approved this withdrawal. Please try again shortly."],
  ["InvalidSignerEpoch()", "Your claim was not sent, because the vault's signing key has changed since this withdrawal was approved. The server will issue a new approval under the new signing key, which will appear here automatically, or you can select Renew the claim to request one now."],
  ["WithdrawalAlreadyPaid()", "Your claim was not sent, because the vault has already paid this withdrawal."],
  ["WithdrawalsPaused()", "Your claim was not sent, because withdrawals are currently paused at the vault. Please try again once the pause has ended."],
  ["NoSigner()", "Your claim was not sent, because the vault currently has no signing key and accepts no claims. Please try again once a new signing key has been installed."],
  ["ExitActive()", "Your claim was not sent, because the vault's exit has started and normal claims have ended. Register the withdrawal through the vault's exit on the Funding page instead."],
] as const;
const WITHDRAWAL_SELECTORS = tableOf(WITHDRAWAL_REFUSALS);

/** The vote contract's custom errors a vote can end in (`ParameterVote.vote`). */
const VOTE_REFUSALS = [
  ["AlreadyVoted(uint256,address)", "Your vote was not sent, because this account has already voted on this proposal."],
  ["AlreadyPassed(uint256)", "Your vote was not sent, because this proposal has already passed and accepts no further votes."],
  ["VotingClosed(uint256,uint64)", "Your vote was not sent, because voting on this proposal has closed."],
  ["NotAMember(address)", "Your vote was not sent, because this account was not a member of the operator rotation when the proposal was opened."],
  ["RotationOff()", "Your vote was not sent, because voting is closed while operator rotation is inactive."],
  ["UnknownProposal(uint256)", "Your vote was not sent, because no proposal with this number exists."],
] as const;
const VOTE_SELECTORS = tableOf(VOTE_REFUSALS);
const VOTE_GENERIC = "Your vote was rejected and has not been recorded. Please try again shortly.";

/** The vault's refusal of a withdrawal's claim for any revert whose error is not named above. */
const WITHDRAWAL_GENERIC = "Your claim was not sent, because the vault did not accept this withdrawal's approval. Please try again shortly, or select Renew the claim if it is offered.";

/** The refusal of a MONKEY claim for any revert whose error is not named above. */
const EMISSIONS_GENERIC = "Your claim was not sent, because the MONKEY contract did not accept the proof provided by the server. Please try again shortly.";

/** The vault's refusal for any revert whose error is not named above. */
const GENERIC = "Your claim was not sent, because the vault's records do not match the proof provided by the server. Please try again shortly.";

/** Every string a wallet's error carries, at the top and under `data`, `originalError` or `cause`. */
export function texts(error: unknown, depth = 0): string[] {
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

/** `claimFailure` for a MONKEY claim, whose refusals are the minter's and the vault's. */
export const emissionsFailure = (error: unknown): unknown => refusal(error, EMISSIONS_SELECTORS, EMISSIONS_GENERIC);

/** `claimFailure` for a withdrawal's claim, whose errors and next steps differ. */
export const withdrawalFailure = (error: unknown): unknown => refusal(error, WITHDRAWAL_SELECTORS, WITHDRAWAL_GENERIC);

/** `claimFailure` for a vote, whose refusals are the vote contract's. */
export const voteFailure = (error: unknown): unknown => refusal(error, VOTE_SELECTORS, VOTE_GENERIC);
