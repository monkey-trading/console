/** Plots each open market's mark on its chart bars: the candle logic every mark, read or streamed, goes through. */

import { MAX_BARS, pushTick, TIMEFRAMES, type Bar, type TimeframeId } from "../bars";
import { fixedToNumber } from "../fixed";
import type { MarketModel } from "../models";
import type { ConsoleStore } from "./store";

/** The store's bars with `markets`' marks pushed onto them at node time `now`. */
export function tickBars(store: ConsoleStore, markets: readonly MarketModel[], now: number): ReturnType<ConsoleStore["getSnapshot"]>["bars"] {
  const bars = { ...store.getSnapshot().bars };
  for (const m of markets) {
    if (m.mark === null || !m.open) continue;
    const price = fixedToNumber(m.mark);
    // A market first seen now, as a live node's list arrives, starts from the history source.
    const frames = bars[m.id] ?? (Object.fromEntries(TIMEFRAMES.map((tf) => [tf.id, store.deps.history(m.symbol, tf.seconds, now, price)])) as Record<TimeframeId, Bar[]>);
    // `fromEntries` loses the key type; the keys are exactly the timeframes `frames` holds.
    // Before the node's first message there is no node time to place a bar at.
    bars[m.id] = now === 0 ? frames : (Object.fromEntries(TIMEFRAMES.map((tf) => {
      const next = pushTick(frames[tf.id], now, price, tf.seconds);
      // A closed or unpriced market's candle is untouched, so its last tick stays where it was.
      const bucket = Math.floor(now / 1000 / tf.seconds) * tf.seconds;
      const ticks = (store.barTicks[m.id] ?? {}) as Record<TimeframeId, Map<number, number>>;
      const series = (ticks[tf.id] ?? new Map<number, number>()) as Map<number, number>;
      series.set(bucket, now);
      for (const at of series.keys()) if (at < bucket - MAX_BARS * tf.seconds) series.delete(at);
      store.barTicks[m.id] = { ...ticks, [tf.id]: series };
      return [tf.id, next];
    })) as typeof frames);
  }
  return bars;
}
