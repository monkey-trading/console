/** The mock node's listed markets: their specs as `GET /v1/markets` serves them, and how each simulates. */

import { fixedFromInt, type Fixed } from "../fixed";
import type { MarketView, Tier } from "../engine/types";

/** How a market's index moves in the simulation. */
export interface SimParams {
  /** The starting index, in dollars. */
  start: Fixed;
  /** Typical move per second, in basis points. */
  volBps: number;
}

export interface ListedMarket {
  spec: Omit<MarketView, "open" | "reduce_only" | "mark" | "stress_level">;
  sim: SimParams;
}

const SESSION_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

const tiers = (bands: [number | null, number][]): Tier[] =>
  bands.map(([upTo, bps]) => ({ up_to: upTo === null ? null : String(upTo), bps }));

const MARGIN_CRYPTO = tiers([[100_000, 200], [1_000_000, 500], [null, 1_000]]);
const MARGIN_MAJOR = tiers([[500_000, 100], [2_000_000, 300], [null, 800]]);
const MARGIN_INDEX = tiers([[250_000, 200], [1_000_000, 500], [null, 1_000]]);
const SPREAD_BANDS = tiers([[250_000, 0], [1_000_000, 3], [null, 8]]);

const COMMON = { house_cap_bps: 500, max_slippage_bps: 50, min_order_notional: "100", price_rules: { max_age_ms: 5_000, max_divergence_bps: 50, min_sources: 1 } } as const;

export const MARKETS: readonly ListedMarket[] = [
  {
    spec: { id: 1, symbol: "BTC-USD", asset_class: "crypto", schedule: { kind: "always_open" }, margin_tiers: MARGIN_CRYPTO, spread_tiers: SPREAD_BANDS, ...COMMON },
    sim: { start: fixedFromInt(67_420), volBps: 1.6 },
  },
  {
    spec: { id: 2, symbol: "ETH-USD", asset_class: "crypto", schedule: { kind: "always_open" }, margin_tiers: MARGIN_CRYPTO, spread_tiers: SPREAD_BANDS, ...COMMON },
    sim: { start: 2_614_800_000_000n, volBps: 2.1 },
  },
  {
    spec: {
      id: 3, symbol: "EUR-USD", asset_class: "fx", margin_tiers: MARGIN_MAJOR, spread_tiers: SPREAD_BANDS, ...COMMON,
      schedule: { kind: "weekly", tz: "UTC", closed_dates: [], windows: [
        { open: "Mon 00:00", close: "Fri 22:00" },
      ] },
    },
    sim: { start: 1_082_400_000n, volBps: 0.45 },
  },
  {
    spec: {
      id: 4, symbol: "US500", asset_class: "index", margin_tiers: MARGIN_INDEX, spread_tiers: SPREAD_BANDS, ...COMMON,
      schedule: { kind: "weekly", tz: "UTC", closed_dates: [], windows: SESSION_DAYS.map((day) => ({ open: `${day} 14:30`, close: `${day} 21:00` })) },
    },
    sim: { start: 5_842_500_000_000n, volBps: 0.8 },
  },
  {
    spec: {
      id: 5, symbol: "XAU-USD", asset_class: "commodity", margin_tiers: MARGIN_INDEX, spread_tiers: SPREAD_BANDS, ...COMMON,
      schedule: { kind: "weekly", tz: "UTC", closed_dates: [], windows: SESSION_DAYS.map((day) => ({ open: `${day} 01:00`, close: `${day} 21:59` })) },
    },
    sim: { start: 2_731_200_000_000n, volBps: 1.1 },
  },
];
