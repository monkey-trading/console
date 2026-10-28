/** The console's state: what the screens read, replaced whole on every change. */

import { DEFAULT_TIMEFRAME, TIMEFRAMES, type Bar, type TimeframeId } from "../bars";
import type { AttestationStatus } from "../engine/attestation";
import type { HistoryPage, MarketId, MarketView, HouseView, QueuedWithdrawal } from "../engine/types";
import { fixedToNumber } from "../fixed";
import { decodeHouse, decodeMarket, type AccountModel, type Eligibility, type HouseModel, type MarketModel } from "../models";

export type BlockReason = "united_states" | "sanctioned_jurisdiction";

export interface ToastMessage {
  id: number;
  tone: "ok" | "error" | "info";
  text: string;
}

export interface FeedLine {
  id: number;
  ts: number;
  text: string;
}

export type HistoryEntry = HistoryPage["events"][number];

export interface ConsoleState {
  /** The node's clock: the stamp of the latest message. */
  now: number;
  attestation: AttestationStatus;
  /** Set when the node refuses the caller's region. */
  blocked: BlockReason | null;
  markets: MarketModel[];
  /** Bars per market and timeframe, built from the node's marks. */
  bars: Record<MarketId, Record<TimeframeId, Bar[]>>;
  timeframe: TimeframeId;
  selected: MarketId;
  house: HouseModel;
  wallet: { address: string; label: string } | null;
  eligibility: Eligibility;
  account: AccountModel | null;
  queue: QueuedWithdrawal[];
  history: HistoryEntry[];
  feed: FeedLine[];
  toasts: ToastMessage[];
  /** Whether a signed action is in flight. */
  busy: boolean;
  /** Whether the funding drawer is open. */
  fundingOpen: boolean;
}

/** Where the bars of a market and timeframe come from: history ending at the current mark. */
export type HistorySource = (symbol: string, seconds: number, endMs: number, endPrice: number) => Bar[];

/** Bars for every market and timeframe, ending at each market's mark. */
export function seedAllBars(markets: readonly MarketModel[], startMs: number, history: HistorySource): ConsoleState["bars"] {
  const out: ConsoleState["bars"] = {};
  for (const m of markets) {
    const price = m.mark === null ? 1 : fixedToNumber(m.mark);
    const perFrame = {} as Record<TimeframeId, Bar[]>;
    for (const tf of TIMEFRAMES) perFrame[tf.id] = history(m.symbol, tf.seconds, startMs, price);
    out[m.id] = perFrame;
  }
  return out;
}

/** The state before anything has loaded, from the first `GET /v1/markets` and `/v1/house`. */
export function initialState(markets: MarketView[], house: HouseView, startMs: number, history: HistorySource): ConsoleState {
  const models = markets.map((view) => decodeMarket(view, undefined));
  return {
    now: startMs,
    attestation: { kind: "checking" },
    blocked: null,
    markets: models,
    bars: seedAllBars(models, startMs, history),
    timeframe: DEFAULT_TIMEFRAME,
    selected: models[0]?.id ?? 1,
    house: decodeHouse(house),
    wallet: null,
    eligibility: null,
    account: null,
    queue: [],
    history: [],
    feed: [],
    toasts: [],
    busy: false,
    fundingOpen: false,
  };
}
