/** The console's state: what the screens read, replaced whole on every change. */

import { seedCandles, type Candle } from "../candles";
import type { AttestationStatus } from "../engine/attestation";
import type { HistoryPage, MarketId, MarketView, HouseView, QueuedWithdrawal } from "../engine/types";
import { fixedToNumber } from "../fixed";
import { decodeHouse, decodeMarket, type AccountModel, type Eligibility, type HouseModel, type MarketModel } from "../models";

export type ChartMode = "reference" | "execution" | "risk";
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
  candles: Record<MarketId, Candle[]>;
  selected: MarketId;
  mode: ChartMode;
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

/** Candles for each market, seeded from its mark so the first frame is the same everywhere. */
export function seedAllCandles(markets: readonly MarketModel[], startMs: number): Record<MarketId, Candle[]> {
  const out: Record<MarketId, Candle[]> = {};
  for (const m of markets) {
    const price = m.mark === null ? 1 : fixedToNumber(m.mark);
    out[m.id] = seedCandles(1871 + m.id, price, startMs, 0.01 + m.baseSpreadBps / 1000);
  }
  return out;
}

/** The state before anything has loaded, from the first `GET /v1/markets` and `/v1/house`. */
export function initialState(markets: MarketView[], house: HouseView, startMs: number): ConsoleState {
  const models = markets.map((view) => decodeMarket(view, undefined));
  return {
    now: startMs,
    attestation: { kind: "checking" },
    blocked: null,
    markets: models,
    candles: seedAllCandles(models, startMs),
    selected: models[0]?.id ?? 1,
    mode: "reference",
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
