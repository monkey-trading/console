/** What the console needs from a wallet to read and cast parameter votes on the vote contract (`ParameterVote.sol`, monkey-trading/engine#548). */

import type { Progress } from "./wallet";

/** A proposal as the vote contract holds it (`ParameterVote.Proposal`); weights in MONKEY base units. */
export interface ChainProposal {
  setId: number;
  fast: boolean;
  passed: boolean;
  closesAtMs: number;
  yes: bigint;
  total: bigint;
}

/** A member of a rotation set and the weight the set adopted for it, in MONKEY base units. */
export interface SetMember {
  /** Lowercase `0x` hex. */
  candidate: string;
  weight: bigint;
}

/**
 * A wallet's vote calls. The vote contract's address comes from the node's signed answers; every
 * read goes through the wallet to the chain, and a caller brackets its reads with `onChain`, since on
 * another chain the contract's address names something else.
 * Error cases (every method):
 * - a read fails; for `onChain`, the wallet is on another chain than the deployment's
 * - for `vote`: the user declines, the wallet is on another chain, or the transaction reverts or is not confirmed
 */
export interface GovernanceWallet {
  /** Resolves when the wallet is on the deployment's chain, and rejects when it is not. */
  onChain(): Promise<void>;
  /** Proposal `id` on the vote contract `vote`; null when it holds none by that id. */
  proposal(vote: string, id: number): Promise<ChainProposal | null>;
  /** The members of rotation set `setId` of the schedule the vote contract follows, each once with its whole weight. */
  set(vote: string, setId: number): Promise<SetMember[]>;
  /** Whether `member` has voted on proposal `id`. */
  voted(vote: string, id: number, member: string): Promise<boolean>;
  /** Votes yes on proposal `id` with the account's weight in the set it opened under. */
  vote(vote: string, id: number, progress?: Progress): Promise<string>;
}
