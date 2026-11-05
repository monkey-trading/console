/** What the MONKEY, Staking and Dashboard pages' store holds: the node's and the wallet's reads, what is typed, and which page an opening serves. */

import type { ActivityPage, DistributionProof, MonkeySeriesMetric, MonkeyView } from "../engine/stats-types";
import type { StakingPosition } from "../engine/staking";
import { LOADING, type Read } from "./figures";
import type { TimeframeId } from "./timeframes";

/**
 * The page a panel serves (monkey-trading/console#271): the MONKEY page reads the token, its emissions
 * and the public activity; the Staking page the account's stake and its USDC distributions; the
 * Dashboard the house, emissions, supply and distribution histories (monkey-trading/console#310).
 */
export type PanelPage = "monkey" | "staking" | "dashboard";

export type FeedName = "epochs" | "perLoss" | "supply" | "rewards";

/** Each chart's metrics and the window it opens on. */
export const FEEDS: Readonly<Record<FeedName, { readonly metrics: readonly MonkeySeriesMetric[]; readonly initial: TimeframeId }>> = {
  epochs: { metrics: ["distributed_per_epoch"], initial: "7d" },
  perLoss: { metrics: ["monkey_per_loss"], initial: "all" },
  supply: { metrics: ["total_allocated", "total_staked"], initial: "all" },
  rewards: { metrics: ["cumulative_distributed"], initial: "all" },
};
/**
 * The charts each page draws: the Dashboard all four, the MONKEY and Staking sections none.
 */
export const PAGE_FEEDS: Readonly<Record<PanelPage, readonly FeedName[]>> = { monkey: [], staking: [], dashboard: ["perLoss", "supply", "epochs", "rewards"] };

/** What the connected account holds on chain and what the node proves it was distributed. */
export interface WalletFigures {
  /** The address these figures are for; null with no wallet. */
  address: string | null;
  /** The wallet's chain reads; unavailable for a wallet that reads no chain, such as a watched account's. */
  position: Read<StakingPosition>;
  /** The account's distribution proof; null when the node holds none. */
  proof: Read<DistributionProof | null>;
  /** Whether the MONKEY page's read of the vault's record of the account's MONKEY claims landed; the record itself goes to the console's store. */
  record: Read<true>;
}

/** The text typed in the stake and unstake fields, for the account it was typed for. */
export interface Drafts { account: string | null; stake: string; unstake: string; delegate: string; move: string; undelegate: string }
/** The amount fields the page keeps what was typed in. */
export type DraftField = Exclude<keyof Drafts, "account">;

export const NO_DRAFTS: Drafts = { account: null, stake: "", unstake: "", delegate: "", move: "", undelegate: "" };

export interface PanelState {
  overview: Read<MonkeyView>;
  /** Read by the MONKEY page alone; the Staking page leaves it loading. */
  activity: Read<ActivityPage>;
  /** The stake and the proof are read by the Staking page alone, the record by the MONKEY page alone; the other page leaves them loading. */
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

export const NO_WALLET: WalletFigures = { address: null, position: LOADING, proof: LOADING, record: LOADING };
