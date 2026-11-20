/** Tests for the Positions list's layout: a row keeps its place in one array whichever section its position is in. */

import { createElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { flatPositions } from "./flat-positions";

const keyed = (key: string): ReactElement => createElement("li", { key });
const row = (market: number) => keyed(`row-${market}`);
const group = (...markets: number[]) => ({ heading: keyed("hedge-metals"), rows: markets });
const layout = (hedges: ReturnType<typeof group>[], others: number[]) => flatPositions(hedges, { heading: hedges.length > 0 && others.length > 0 ? keyed("others") : null, rows: others }, row);

describe("the Positions list", () => {
  it("is one flat array of keyed elements, hedges first, then the Others heading and the rest", () => {
    const list = layout([group(1, 2)], [3]);
    expect(list.map((e) => e.key)).toEqual(["hedge-metals", "row-1", "row-2", "others", "row-3"]);
    expect(list.some((e) => Array.isArray(e))).toBe(false);
  });

  it("keeps the same key for a position that enters or leaves a hedge, in one array each time", () => {
    const alone = layout([], [1, 2]);
    const hedged = layout([group(1, 2)], []);
    // React keeps an element between renders only when both are children of one array, at one key.
    expect(alone.map((e) => e.key)).toEqual(["row-1", "row-2"]);
    expect(hedged.map((e) => e.key)).toEqual(["hedge-metals", "row-1", "row-2"]);
    expect(layout([group(1)], [2]).every((e) => !Array.isArray(e))).toBe(true);
  });

  it("flattens a row that renders more than one element, and leaves out one that renders none", () => {
    const list = flatPositions([group(1, 2)], { heading: null, rows: [3] }, (market) => (market === 3 ? null : [row(market), market === 1 ? keyed("note-1") : null]));
    expect(list.map((e) => e.key)).toEqual(["hedge-metals", "row-1", "note-1", "row-2"]);
  });
});
