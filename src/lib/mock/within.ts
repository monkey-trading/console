/** Which of a time-ordered list of closes fall inside a series bucket, for the mock's MONKEY series. */

/**
 * The entries of `sorted`, which `time` orders ascending, with `from <= time < to`: found by bisection
 * rather than a scan of every close for every bucket, which a seven-day window at hourly buckets
 * repeats a hundred and sixty-eight times over the mock's whole history.
 */
export function within<T>(sorted: readonly T[], time: (entry: T) => number, from: number, to: number): readonly T[] {
  const lowerBound = (bound: number) => {
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      const entry = sorted[mid];
      if (entry !== undefined && time(entry) < bound) low = mid + 1;
      else high = mid;
    }
    return low;
  };
  return sorted.slice(lowerBound(from), lowerBound(to));
}
