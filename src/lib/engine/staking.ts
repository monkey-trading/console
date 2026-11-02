/** What the console needs from a wallet to stake MONKEY and claim USDC distributions. */

import type { DistributionProof } from "./stats-types";
import type { Progress } from "./wallet";

/** The account's standing on the staking contract and the vault, as the wallet's chain reads see it. */
export interface StakingPosition {
  /** Whether the build names a staking contract; when false, `staked` and `unstaking` are empty and only the vault's figures are read. */
  stakingEnabled: boolean;
  /** MONKEY base units staked. */
  staked: bigint;
  /** An unstake waiting out its cooldown, with the time it completes in milliseconds. */
  unstaking: { amount: bigint; claimableAtMs: number } | null;
  /** The MONKEY the wallet holds, in base units; zero while the vault has no token. */
  balance: bigint;
  /** The USDC base units the vault has paid this account's distributions. */
  distributionsClaimed: bigint;
  /** The seq of the vault's latest posted checkpoint, at which a distribution proof's claim works. */
  latestSeq: number;
}

/**
 * A wallet's staking calls. Every transaction goes through the wallet's provider; `position` makes
 * its chain reads one at a time and is called on load and after a transaction, never on a timer.
 * Error cases (every method):
 * - the wallet is on another chain than the deployment's, or the build names no staking contract
 * - the user declines, or a transaction reverts or is not confirmed after 180 receipt polls a second apart
 */
export interface StakingWallet {
  position(): Promise<StakingPosition>;
  /** Approves the staking contract for `amount` MONKEY if needed, then stakes it. */
  stake(amount: bigint, progress?: Progress): Promise<string>;
  /** Starts unstaking `amount`; it stops earning once the cooldown completes and the engine mirrors it. */
  startUnstake(amount: bigint, progress?: Progress): Promise<string>;
  completeUnstake(progress?: Progress): Promise<string>;
  /** Claims the USDC `proof`'s cumulative distribution adds to what the vault has paid. */
  claimDistribution(proof: DistributionProof, progress?: Progress): Promise<string>;
}
