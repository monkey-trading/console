/** Candlesticks built from a stream of marks, for the chart only; floats here never mirror engine state. */

import { mulberry32 } from "./prng";

export interface Candle {
  /** Start of the bucket, in milliseconds. */
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** The candle width: five simulated seconds. */
export const CANDLE_MS = 5_000;
/** The most candles kept per market. */
export const MAX_CANDLES = 60;

/** Adds a mark to the series: it extends the current candle or opens the next. */
export function pushMark(series: readonly Candle[], t: number, price: number): Candle[] {
  const bucket = Math.floor(t / CANDLE_MS) * CANDLE_MS;
  const last = series[series.length - 1];
  if (last && last.t === bucket) {
    const next = { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price };
    return [...series.slice(0, -1), next];
  }
  const open = last ? last.close : price;
  const candle = { t: bucket, open, high: Math.max(open, price), low: Math.min(open, price), close: price };
  return [...series, candle].slice(-MAX_CANDLES);
}

/**
 * A plausible history ending at `end`, so the chart is not empty on first load. Seeded, so the
 * server and the browser draw the same candles.
 */
export function seedCandles(seed: number, end: number, startMs: number, volPct: number, count = MAX_CANDLES - 1): Candle[] {
  const rand = mulberry32(seed);
  const closes: number[] = [end];
  for (let i = 1; i <= count; i++) {
    const step = (rand() + rand() + rand() - 1.5) * 2 * volPct * Math.sqrt(CANDLE_MS / 1000) * 3;
    closes.unshift((closes[0] ?? end) / (1 + step / 100));
  }
  const bucket = Math.floor(startMs / CANDLE_MS) * CANDLE_MS;
  return closes.map((close, i) => {
    const prev = closes[i - 1] ?? close;
    const wick = close * volPct * 0.01 * rand() * 2;
    return {
      t: bucket - (closes.length - 1 - i) * CANDLE_MS, open: prev, close,
      high: Math.max(prev, close) + wick, low: Math.min(prev, close) - wick,
    };
  });
}
