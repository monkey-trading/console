/** The seeded random generator that drives every simulation on the page, and the seed they share. */

/** The seed every simulation starts from: 1871, the year of Jevons's *The Theory of Political Economy*. */
export const SEED = 1871;

/**
 * Mulberry32: a small seeded generator returning floats in [0, 1). It drives the simulations so
 * that every visitor, and the server render, sees the same sequence. Not for anything secret.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An integer in `[min, max]` drawn from `rand`. */
export function randInt(rand: () => number, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

/**
 * One of `items`, drawn from `rand`.
 * Error cases:
 * - `items` is empty
 */
export function pick<T>(rand: () => number, items: readonly T[]): T {
  const item = items[randInt(rand, 0, items.length - 1)];
  // Only an empty list leaves nothing to pick; callers pass fixed, non-empty tables.
  if (item === undefined) throw new Error("pick: no items to choose from");
  return item;
}
