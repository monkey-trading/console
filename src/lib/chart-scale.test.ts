/** Tests for the SVG chart's scales: the axis floor, ticks, thinning that keeps peaks, markers and tag spacing. */

import { describe, expect, it } from "vitest";

import { nearestIndex, niceTicks, placeMarks, spreadTags, thin, timeLabel, timeTicks, valueAt, valueDomain, type ChartPoint } from "./chart-scale";

const pts = (values: readonly number[], step = 60_000, from = 0): ChartPoint[] => values.map((value, i) => ({ ts: from + i * step, value }));

describe("valueDomain", () => {
  it("fits a series flat at zero to $0 to about $1, never below zero", () => {
    const domain = valueDomain([0, 0, 0], true);
    expect(domain.min).toBe(0);
    expect(domain.max).toBeGreaterThanOrEqual(1);
    expect(domain.max).toBeLessThan(1.2);
  });

  it("fits a single point at zero the same way, and a single positive point around its own value", () => {
    expect(valueDomain([0], true).min).toBe(0);
    const single = valueDomain([100_000], true);
    expect(single.min).toBeGreaterThan(90_000);
    expect(single.max).toBeLessThan(110_000);
    expect(single.max).toBeGreaterThan(100_000);
  });

  it("starts the $0.15 position that drew an axis down to -$0.40 at zero", () => {
    const domain = valueDomain([0, 0.15], true);
    expect(domain.min).toBe(0);
    expect(domain.max).toBeGreaterThan(0.15);
  });

  it("never starts below zero for a series that cannot go there, whatever its values", () => {
    for (const values of [[0], [0, 0.01], [0.2, 0.2], [3, 3], [0, 5_000], [99_900, 99_950], [1e-9, 2e-9]]) expect(valueDomain(values, true).min).toBeGreaterThanOrEqual(0);
  });

  it("lets a series that may go below zero, such as NAV, keep its own range", () => {
    const domain = valueDomain([-5, 10], false);
    expect(domain.min).toBeLessThan(-5);
    expect(domain.max).toBeGreaterThan(10);
  });

  it("keeps a flat series that is not at zero centred, with a span wide enough for distinct ticks", () => {
    const domain = valueDomain([5_000_000, 5_000_000], false);
    expect(domain.max - domain.min).toBeGreaterThan(100_000);
    expect(new Set(niceTicks(domain, 5).map((t) => Math.round(t / 1000))).size).toBeGreaterThan(2);
  });

  it("keeps zero in view for bars and lets them rise from it, with no air beneath", () => {
    expect(valueDomain([4, 9], true, true).min).toBe(0);
    expect(valueDomain([4, 9], false, true).min).toBe(0);
  });

  it("shows $0 to $1 for no values at all", () => {
    expect(valueDomain([], true)).toEqual({ min: 0, max: 1 });
  });
});

describe("niceTicks", () => {
  it("lists round values inside the range, about the count asked", () => {
    expect(niceTicks({ min: 0, max: 1 }, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks({ min: 4_900_000, max: 5_120_000 }, 5)).toEqual([4_900_000, 4_950_000, 5_000_000, 5_050_000, 5_100_000]);
  });

  it("lists nothing for an empty range or a count below one", () => {
    expect(niceTicks({ min: 1, max: 1 }, 5)).toEqual([]);
    expect(niceTicks({ min: 0, max: 1 }, 0)).toEqual([]);
  });

  it("never lists a tick below the range, so a nonnegative axis has no negative label", () => {
    for (const ticks of [niceTicks(valueDomain([0, 0.15], true), 6), niceTicks(valueDomain([0], true), 6)]) expect(Math.min(...ticks)).toBeGreaterThanOrEqual(0);
  });
});

describe("timeTicks and timeLabel", () => {
  const T0 = Date.UTC(2026, 10, 2, 15, 0, 0);
  it("steps by a round time that fits the width, on the clock", () => {
    const { step, ticks } = timeTicks(T0, T0 + 24 * 3_600_000, 6);
    expect(step).toBe(6 * 3_600_000);
    expect(ticks.map((t) => timeLabel(t, step))).toEqual(["18:00", "3 Nov", "06:00", "12:00"]);
  });

  it("labels days from a day's step up, and gives fewer ticks to a narrow chart", () => {
    const wide = timeTicks(T0, T0 + 30 * 86_400_000, 8);
    const narrow = timeTicks(T0, T0 + 30 * 86_400_000, 3);
    expect(wide.ticks.length).toBeGreaterThan(narrow.ticks.length);
    expect(timeLabel(wide.ticks[0] ?? { ts: 0, major: false }, wide.step)).toMatch(/^\d+ \w{3}$/);
  });

  it("has no ticks for a span of nothing", () => {
    expect(timeTicks(T0, T0, 5).ticks).toEqual([]);
  });
});

describe("thin", () => {
  it("returns a series that already fits as it is", () => {
    const small = pts([1, 2, 3, 4, 5]);
    expect(thin(small, 10)).toBe(small);
  });

  it("keeps each column's peak and dip, so a spike survives, and the first and last points", () => {
    const values = Array.from({ length: 10_000 }, (_, i) => (i === 4_321 ? 1_000 : i === 7_777 ? -1_000 : Math.sin(i / 50)));
    const thinned = thin(pts(values), 100);
    expect(thinned.length).toBeLessThanOrEqual(100 * 4);
    expect(thinned.some((p) => p.value === 1_000)).toBe(true);
    expect(thinned.some((p) => p.value === -1_000)).toBe(true);
    expect(thinned[0]?.ts).toBe(0);
    expect(thinned[thinned.length - 1]?.ts).toBe(9_999 * 60_000);
  });

  it("keeps time order and never invents a point", () => {
    const source = pts(Array.from({ length: 5_000 }, (_, i) => (i * 7919) % 101));
    const thinned = thin(source, 50);
    const stamps = thinned.map((p) => p.ts);
    expect([...stamps].sort((a, b) => a - b)).toEqual(stamps);
    for (const p of thinned) expect(source).toContain(p);
  });

  it("handles one point, none, and a series all at one instant", () => {
    expect(thin([], 10)).toEqual([]);
    const one = pts([5]);
    expect(thin(one, 10)).toBe(one);
    const same = Array.from({ length: 100 }, (_, i) => ({ ts: 5, value: i }));
    expect(thin(same, 2).length).toBeLessThan(100);
  });
});

describe("nearestIndex and valueAt", () => {
  const line = pts([10, 20, 30], 1000);
  it("finds the nearest point in time, either side", () => {
    expect(nearestIndex(line, 0)).toBe(0);
    expect(nearestIndex(line, 1400)).toBe(1);
    expect(nearestIndex(line, 1600)).toBe(2);
    expect(nearestIndex(line, 99_999)).toBe(2);
    expect(nearestIndex([], 5)).toBe(-1);
  });

  it("reads a series at a time only within reach of one of its points", () => {
    expect(valueAt(line, 1100, 500)).toBe(20);
    expect(valueAt(line, 1600, 300)).toBeNull();
  });
});

describe("placeMarks", () => {
  const line = pts([1, 2, 3, 4], 100);
  it("moves a marker to the first point at or after its time", () => {
    expect(placeMarks([{ ts: 150, text: "Between" }, { ts: 200, text: "Halving" }], line)).toEqual([{ ts: 200, text: "Between" }, { ts: 200, text: "Halving" }]);
  });

  it("drops a marker before the first point or after the last, and all of them for a line with no points", () => {
    expect(placeMarks([{ ts: -1, text: "early" }, { ts: 301, text: "late" }], line)).toEqual([]);
    expect(placeMarks([{ ts: 100, text: "x" }], [])).toEqual([]);
  });
});

describe("spreadTags", () => {
  it("moves value tags apart when their values are close, and keeps them in the plot", () => {
    const placed = spreadTags([100, 102, 300], 20, 0, 400);
    expect(placed[1]).toBeGreaterThanOrEqual((placed[0] ?? 0) + 20);
    expect(placed[2]).toBe(300);
  });

  it("returns each tag in the order given, and pulls one at an edge inside", () => {
    expect(spreadTags([390, 5], 20, 10, 380)).toEqual([380, 10]);
  });
});
