/** The mock node's dashboard routes: the House page's scan figures, positions, series, MONKEY totals and index candles. */

import { EngineError } from "../engine/client";
import type { MarkPage } from "../engine/mark-types";
import type { HouseMarketView, HouseScanView, HouseSeriesMetric, LevelEntry, MonkeySeriesMetric, MonkeyView, PositionsView, SeriesMetric, SeriesPage, SeriesQuery, SideCounts, StatsReads, ValueEntry } from "../engine/stats-types";
import { decodeSchedule, type EmissionSchedule } from "../engine/emission-schedule";
import type { HouseView, MarketId } from "../engine/types";
import { absFixed, fixedFromWire, fixedToNumber, fixedToWire } from "../fixed";
import { seedBars } from "../bars";
import { SEED } from "../prng";
import { houseNav } from "./accounts";
import { activityPage, distributionProof, mockContracts, monkeySeries, overview } from "./monkey";
import { AVERAGE_POSITION_USD, bookAt, cashAt, MOCK_RECORD_BEGINS_MS, navAt, noise, numberOf, queueAt, volumeIn, wire, type Book } from "./stats-model";
import type { MockState } from "./state";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const WIDTH_MS = { "1m": MINUTE_MS, "1h": HOUR_MS, "1d": DAY_MS } as const;
/** What each resolution keeps, as the node's default retention does; a day resolution keeps all. */
const RETAIN_MS = { "1m": 2 * DAY_MS, "1h": 90 * DAY_MS, "1d": Number.POSITIVE_INFINITY } as const;
const CLOSEOUT_RANGE_BPS = 2_000;
const CLOSEOUT_BUCKET_BPS = 50;
const PROFIT_RANGE_BPS = 1_000;
const PROFIT_BUCKET_BPS = 100;
/** How the mock's scan lags the clock: it runs once a minute, as the node's default does. */
const scanTime = (now: number): number => Math.floor(now / MINUTE_MS) * MINUTE_MS;

const bad = (message: string) => new EngineError(400, message);
const markOf = (state: MockState, id: MarketId): number => {
  const market = state.markets.get(id);
  if (market === undefined) throw bad(`market ${id} is not listed`);
  return fixedToNumber(market.mid);
};

/** The scan figures `/v1/house` adds. */
export function houseScan(state: MockState): HouseScanView {
  const at = scanTime(state.now);
  const markets: HouseMarketView[] = [...state.markets.keys()].map((id) => {
    const book = bookAt(state, id, at);
    const market = state.markets.get(id);
    let clients = 0;
    if (market !== undefined) for (const account of state.accounts.values()) {
      const held = account.positions.get(id);
      if (held !== undefined) clients += fixedToNumber(held.qty) * (fixedToNumber(market.mid) - fixedToNumber(held.entry));
    }
    let volume = 0;
    for (let h = 0; h < 24; h++) volume += volumeIn(id, state.now - h * HOUR_MS) * 60;
    return {
      market: id, symbol: market?.listed.spec.symbol ?? String(id), mark: market === undefined ? null : wire(fixedToNumber(market.mid)),
      long: wire(book.long), short: wire(book.short), net: wire(book.long - book.short),
      long_positions: book.longPositions, short_positions: book.shortPositions, unrealised: wire(-clients), volume: wire(volume),
    };
  });
  const sum = (pick: (m: HouseMarketView) => number) => markets.reduce((total, m) => total + pick(m), 0);
  return {
    seq: state.seq, snapshot_ms: at,
    open_interest: wire(sum((m) => numberOf(m.long ?? "0") + numberOf(m.short ?? "0"))),
    open_margin: wire(sum((m) => (numberOf(m.long ?? "0") + numberOf(m.short ?? "0")) * 0.06)),
    open_positions: markets.reduce((total, m) => total + (m.long_positions ?? 0) + (m.short_positions ?? 0), 0),
    unrealised: wire(fixedToNumber(houseNav(state) - state.houseCash)),
    volume: wire(sum((m) => numberOf(m.volume))), volume_since_ms: state.now - DAY_MS, markets,
  };
}

function queueNow(state: MockState): bigint {
  return state.queue.reduce((total, entry) => total + entry.remaining, 0n);
}

/** One metric's value at `ms`, in dollars; the bucket that holds the node's clock ends on the figure it answers now. */
function valueAt(state: MockState, metric: HouseSeriesMetric, market: MarketId | null, ms: number): number {
  const now = state.now;
  switch (metric) {
    case "nav": return navAt(houseNav(state), now, ms);
    case "cash": return cashAt(state.houseCash, now, ms);
    case "withdrawal_queue": return queueAt(queueNow(state), now, ms);
    case "long": return market === null ? 0 : bookAt(state, market, ms).long;
    case "short": return market === null ? 0 : bookAt(state, market, ms).short;
    case "volume": {
      const ids = market === null ? [...state.markets.keys()] : [market];
      return ids.reduce((total, id) => total + volumeIn(id, ms), 0);
    }
  }
}

/** `GET /v1/stats/series` over the mock's waves. */
export function seriesPage(state: MockState, query: SeriesQuery): SeriesPage {
  const { metric, market, resolution } = query;
  // The MONKEY metrics are served by `mockStats` from `monkey.ts`; one reaching here is a mistake of the caller's.
  if (isMonkeyMetric(metric)) throw bad(`${metric} is not a house metric`);
  if ((metric === "long" || metric === "short") && market === null) throw bad(`${metric} needs a market`);
  if ((metric !== "long" && metric !== "short" && metric !== "volume") && market !== null) throw bad(`${metric} takes no market`);
  if (market !== null) markOf(state, market);
  const width = WIDTH_MS[resolution];
  const retained = Math.floor((state.now - RETAIN_MS[resolution]) / width) * width;
  const first = Math.max(Math.floor(query.fromMs / width) * width, Math.floor(MOCK_RECORD_BEGINS_MS / width) * width, retained);
  const flow = metric === "volume";
  const entries: (LevelEntry | ValueEntry)[] = [];
  let next: number | null = null;
  for (let ts = first; ts <= Math.min(query.toMs, state.now); ts += width) {
    if (entries.length >= query.limit) { next = ts; break; }
    if (flow) {
      if (ts >= state.now) break; // a bucket that opens at this instant has traded nothing yet
      // The minutes the bucket holds, sampled at most sixty times and weighted by the minutes each stands for.
      const step = Math.max(MINUTE_MS, width / 60);
      let total = 0;
      for (let m = ts; m < Math.min(ts + width, state.now); m += step) total += valueAt(state, metric, market, m) * (step / MINUTE_MS);
      entries.push({ ts, value: wire(total) });
      continue;
    }
    const end = Math.min(ts + width - 1, state.now);
    const samples = [valueAt(state, metric, market, ts), valueAt(state, metric, market, ts + width / 2), valueAt(state, metric, market, end)];
    entries.push({ ts, open: wire(samples[0] ?? 0), high: wire(Math.max(...samples)), low: wire(Math.min(...samples)), close: wire(samples[2] ?? 0) });
  }
  return {
    metric, market, resolution, kind: flow ? "flow" : "level", unit: "usd", begins_ms: MOCK_RECORD_BEGINS_MS, begins_seq: 0, from_genesis: true,
    retained_from_ms: retained > MOCK_RECORD_BEGINS_MS ? retained : null, entries, next, max_limit: 2_000,
  };
}

/** A side's notional spread over buckets by `weights`, as the wire's per-bucket figures. */
function split(total: number, weights: readonly number[]): { usd: number; count: number }[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => {
    const usd = sum === 0 ? 0 : (total * w) / sum;
    return { usd, count: usd > 0 ? Math.max(1, Math.round(usd / AVERAGE_POSITION_USD)) : 0 };
  });
}

const bell = (x: number, center: number, sigma: number): number => Math.exp(-(((x - center) / sigma) ** 2) / 2);

const counts = (long: { usd: number; count: number } | undefined, short: { usd: number; count: number } | undefined): SideCounts => ({
  long_usd: wire(long?.usd ?? 0), long_count: long?.count ?? 0, short_usd: wire(short?.usd ?? 0), short_count: short?.count ?? 0,
});

/** `GET /v1/house/positions` over the mock's book at its last scan. */
export function positionsView(state: MockState, id: MarketId): PositionsView {
  const mark = markOf(state, id);
  const at = scanTime(state.now);
  const book: Book = bookAt(state, id, at);
  const minute = Math.floor(at / MINUTE_MS);
  const closeoutFrom: number[] = [];
  for (let from = -CLOSEOUT_RANGE_BPS; from < CLOSEOUT_RANGE_BPS; from += CLOSEOUT_BUCKET_BPS) closeoutFrom.push(from);
  // Longs close out below the mark and shorts above it; the last two weights are the positions beyond the range and those due now.
  const closeoutWeights = (side: "long" | "short") => [
    ...closeoutFrom.map((from) => {
      const middle = from + CLOSEOUT_BUCKET_BPS / 2;
      return bell(middle, side === "long" ? -380 : 380, 190) * (0.1 + 1.9 * noise(id * 3 + (side === "long" ? 1 : 2), middle / CLOSEOUT_BUCKET_BPS + minute) ** 2) + 0.004;
    }),
    0.25,
    0.05,
  ];
  const longs = split(book.long, closeoutWeights("long"));
  const shorts = split(book.short, closeoutWeights("short"));
  const profitFrom: number[] = [];
  for (let from = -PROFIT_RANGE_BPS; from < PROFIT_RANGE_BPS; from += PROFIT_BUCKET_BPS) profitFrom.push(from);
  const profitWeights = (center: number, seed: number) => [0.4, ...profitFrom.map((from) => bell(from + PROFIT_BUCKET_BPS / 2, center, 360) * (0.8 + 0.4 * Math.abs(noise(seed, from + minute)))), 0.4];
  const profitLong = split(book.long, profitWeights(60, id * 5 + 1));
  const profitShort = split(book.short, profitWeights(-60, id * 5 + 2));
  const price = (bps: number) => wire(mark * (1 + bps / 10_000), 6);
  const n = closeoutFrom.length;
  return {
    market: id, symbol: state.markets.get(id)?.listed.spec.symbol ?? String(id), seq: state.seq, snapshot_ms: at, mark: wire(mark, 6),
    closeout_range_bps: CLOSEOUT_RANGE_BPS, closeout_bucket_bps: CLOSEOUT_BUCKET_BPS, profit_range_bps: PROFIT_RANGE_BPS, profit_bucket_bps: PROFIT_BUCKET_BPS,
    long: { usd: wire(book.long), count: book.longPositions }, short: { usd: wire(book.short), count: book.shortPositions },
    due_now: counts(longs[n + 1], shorts[n + 1]),
    closeout: closeoutFrom.map((from, i) => ({ from_bps: from, to_bps: from + CLOSEOUT_BUCKET_BPS, from_price: price(from), to_price: price(from + CLOSEOUT_BUCKET_BPS), ...counts(longs[i], shorts[i]) })),
    beyond_range: counts(longs[n], shorts[n]),
    profit: [
      { from_bps: null, to_bps: -PROFIT_RANGE_BPS, ...counts(profitLong[0], profitShort[0]) },
      ...profitFrom.map((from, i) => ({ from_bps: from, to_bps: from + PROFIT_BUCKET_BPS, ...counts(profitLong[i + 1], profitShort[i + 1]) })),
      { from_bps: PROFIT_RANGE_BPS, to_bps: null, ...counts(profitLong[profitFrom.length + 1], profitShort[profitFrom.length + 1]) },
    ],
  };
}

/** `GET /v1/monkey` over the mock: the schedule, stakers and distributions `monkey.ts` holds. */
export function monkeyView(state: MockState): MonkeyView {
  return overview(state);
}

/**
 * `GET /v1/house` over `state`: the cash and NAV, the scan figures, and a gross exposure that is the sum of the markets'
 * absolute nets, which the scan's book (the other traders and the accounts held here) gives.
 */
export function houseFigures(state: MockState): HouseView {
  const scan = houseScan(state);
  const gross = (scan.markets ?? []).reduce((total, market) => total + absFixed(fixedFromWire(market.net ?? "0")), 0n);
  return { cash: fixedToWire(state.houseCash), nav: fixedToWire(houseNav(state)), gross_exposure: fixedToWire(gross), ...scan };
}

/** The emission schedule the ledger reads: the emissions group of the one `/v1/monkey` answer the mock serves. */
export function emissionScheduleOf(state: MockState): EmissionSchedule {
  const schedule = decodeSchedule(monkeyView(state).emissions);
  if (schedule === null) throw new Error("the mock's emission schedule cannot divide time into periods");
  return schedule;
}

/** The dashboard routes over `state`. */
export function mockStats(state: MockState): StatsReads {
  return {
    positions: async (market) => positionsView(state, market),
    series: async (query) => (isMonkeyMetric(query.metric) ? monkeySeries(state, { ...query, metric: query.metric }) : seriesPage(state, query)),
    monkey: async () => monkeyView(state),
    activity: async (params) => activityPage(state, params),
    distributions: async (address) => {
      try {
        return distributionProof(state, address);
      } catch (error) {
        if (error instanceof EngineError && error.status === 404) return null;
        throw error;
      }
    },
    contracts: mockContracts(),
  };
}

const MONKEY_METRICS: ReadonlySet<string> = new Set<MonkeySeriesMetric>(["total_staked", "total_allocated", "cumulative_distributed", "monkey_per_loss", "distributed_per_epoch"]);
const isMonkeyMetric = (metric: SeriesMetric): metric is MonkeySeriesMetric => MONKEY_METRICS.has(metric);

/** `GET /v1/markets/{id}/marks` over the mock's seeded history, ending at its index now. */
export function marksPage(state: MockState, id: MarketId, resolution: "1s" | "1m" | "1h" | "1d", fromMs: number, toMs: number): MarkPage {
  const market = state.markets.get(id);
  if (market === undefined) throw bad(`market ${id} is not listed`);
  const seconds = resolution === "1s" ? 1 : WIDTH_MS[resolution] / 1_000;
  const bars = seedBars(SEED + id, Math.min(toMs, state.now), fixedToNumber(market.mid), seconds, market.listed.sim.volBps, 400);
  const entries = bars.filter((bar) => bar.time * 1_000 >= fromMs && bar.time * 1_000 <= toMs).map((bar) => ({ ts: bar.time * 1_000, open: wire(bar.open, 6), high: wire(bar.high, 6), low: wire(bar.low, 6), close: wire(bar.close, 6), provenance: "log_derived" as const }));
  return { entries, next: null };
}
