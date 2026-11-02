import { describe, expect, it } from "vitest";

import { same, selection } from "./selection";

describe("same", () => {
  it("equals primitives, bigints and structures with equal members", () => {
    expect(same(1n, 1n)).toBe(true);
    expect(same({ a: [1n, { b: "x" }], c: null }, { a: [1n, { b: "x" }], c: null })).toBe(true);
  });

  it("tells apart a changed member, a changed length, a missing key and a different type", () => {
    expect(same({ a: 1n }, { a: 2n })).toBe(false);
    expect(same([1, 2], [1, 2, 3])).toBe(false);
    expect(same({ a: 1 }, { b: 1 })).toBe(false);
    expect(same([], {})).toBe(false);
    expect(same(null, {})).toBe(false);
  });

  it("stops comparing past four levels and calls a deeper copy different", () => {
    const deep = () => ({ a: { b: { c: { d: { e: 1 } } } } });
    expect(same(deep(), deep())).toBe(false);
    const shallow = () => ({ a: { b: { c: { d: 1 } } } });
    expect(same(shallow(), shallow())).toBe(true);
  });
});

describe("selection", () => {
  it("keeps its previous slice while a patch leaves it equal, and a new one when it changes", () => {
    let state = { marks: 1, shown: { nav: 5n } };
    const read = selection(() => state, (s) => s.shown);
    const first = read();
    state = { marks: 2, shown: { nav: 5n } };
    expect(read()).toBe(first);
    state = { marks: 3, shown: { nav: 6n } };
    expect(read()).not.toBe(first);
    expect(read()).toEqual({ nav: 6n });
  });

  it("does not select again for a state it has seen", () => {
    const state = { n: 1 };
    let calls = 0;
    const read = selection(() => state, (s) => { calls += 1; return { n: s.n }; });
    read();
    read();
    expect(calls).toBe(1);
  });
});
