/** Slices of the console's state, held steady: a slice that equals the one before is the one before, so a component re-renders only when what it shows has changed. */

/** Structural equality of two slices, four levels deep: equal members compare with `Object.is` (bigints included). */
export function same(a: unknown, b: unknown, depth = 4): boolean {
  if (Object.is(a, b)) return true;
  if (depth === 0 || typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i], depth - 1));
  const left = Object.entries(a);
  return left.length === Object.keys(b).length && left.every(([k, v]) => Object.hasOwn(b, k) && same(v, Reflect.get(b, k), depth - 1));
}

/**
 * A snapshot reader over `snapshot` that selects `select(state)` and keeps the previous selection
 * while the new one equals it, so the reader's result keeps its identity across unrelated patches.
 */
export function selection<S, T>(snapshot: () => S, select: (state: S) => T): () => T {
  let seen: { state: S; value: T } | null = null;
  return () => {
    const state = snapshot();
    if (seen !== null && seen.state === state) return seen.value;
    const value = select(state);
    seen = { state, value: seen !== null && same(seen.value, value) ? seen.value : value };
    return seen.value;
  };
}
