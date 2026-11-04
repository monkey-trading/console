/** What the MONKEY and Staking pages' store holds: the node's and the wallet's reads, what is typed, and which page an opening serves. */

import type { ActivityPage, DistributionProof, MonkeyView } from "../engine/stats-types";
import type { StakingPosition } from "../engine/staking";
import { LOADING, type Read } from "./figures";

/**
 * The page a panel serves (monkey-trading/console#271): the MONKEY page reads the token, its emissions
 * and the public activity; the Staking page the account's stake and its USDC distributions.
 */
export type PanelPage = "monkey" | "staking";

/** What the connected account holds on chain and what the node proves it was distributed. */
export interface WalletFigures {
  /** The address these figures are for; null with no wallet. */
  address: string | null;
  /** The wallet's chain reads; unavailable for a wallet that reads no chain, such as a watched account's. */
  position: Read<StakingPosition>;
  /** The account's distribution proof; null when the node holds none. */
  proof: Read<DistributionProof | null>;
}

/** The text typed in the stake and unstake fields, for the account it was typed for. */
export interface Drafts { account: string | null; stake: string; unstake: string }

export const NO_DRAFTS: Drafts = { account: null, stake: "", unstake: "" };

export interface PanelState {
  overview: Read<MonkeyView>;
  /** Read by the MONKEY page alone; the Staking page leaves it loading. */
  activity: Read<ActivityPage>;
  /** Read by the Staking page alone; the MONKEY page leaves it loading. */
  wallet: WalletFigures;
  /**
   * Set after a transaction that changed the account's counted stake (a stake, a completed unstake),
   * to the node's total as it stood: the node mirrors the chain a little later, so until its total
   * moves, the wallet and the total disagree and a share of one in the other would be wrong.
   */
  unmirroredTotal: string | null;
  /**
   * Held here, not in the fields, so a gap in the feed (the stop clears the wallet figures and the
   * forms with them) loses nothing a visitor typed; another account's, or none, clears them.
   */
  drafts: Drafts;
  /** True from the moment a transaction lands until the wallet has been read again, so a stale balance or Max cannot be sent again. */
  settling: boolean;
}

export const NO_WALLET: WalletFigures = { address: null, position: LOADING, proof: LOADING };
