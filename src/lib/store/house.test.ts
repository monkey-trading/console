/** Tests for the store's house panel state: the parameters, the latest checkpoint, and the withdrawal queue's totals. */

import { describe, expect, it } from "vitest";

import { fixedFromWire } from "../fixed";
import { settle } from "../engine/test-kit";
import { setup } from "./live-fake";

const PARAMS = { profitFeeBps: 1000, closeoutLevelBps: 5000, totalCapBps: 20000, totalCapFloor: fixedFromWire("2000000"), seq: 7 };
const CHECKPOINT = { type: "checkpoint" as const, offset: "1200:1", seq: 1200, root: `0x${"ab".repeat(32)}` };

describe("the store's house panel state", () => {
  it("starts with nothing read and the figures gated off for a live node", () => {
    const { store } = setup();
    const state = store.getSnapshot();
    expect(state).toMatchObject({ houseReady: false, houseParams: null, checkpoint: null, withdrawalTotals: null });
  });

  it("patches the parameters, checkpoint and queue totals a refresh reads", async () => {
    const { client, store } = setup();
    client.params = PARAMS;
    client.checkpoint = CHECKPOINT;
    client.totals = { count: 2, remaining: fixedFromWire("30.5"), seq: 9, truncated: false };
    store.start(0);
    await settle();
    const state = store.getSnapshot();
    expect(state.houseReady).toBe(true);
    expect(state.house.cash).toBe(fixedFromWire("5"));
    expect(state.houseParams).toEqual(PARAMS);
    expect(state.checkpoint).toEqual(CHECKPOINT);
    expect(state.withdrawalTotals).toEqual({ count: 2, remaining: fixedFromWire("30.5"), seq: 9, truncated: false });
  });

  it("marks the house figures ready once a refresh has read them", async () => {
    const { client, store } = setup();
    store.start(0);
    await settle();
    // The canned client fails nothing: the refresh ran, so the figures stand.
    expect(store.getSnapshot().houseReady).toBe(true);
    expect(client.marketReads).toBe(1);
  });
});
