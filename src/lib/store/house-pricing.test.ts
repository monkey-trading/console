/** Tests for the house state the trading surfaces read: the parameters, stress levels, fee curve and listing notices behind prices and fees. */

import { describe, expect, it } from "vitest";

import type { EngineEvent, StreamMessage } from "../engine/types";
import { fixedFromWire } from "../fixed";
import { settle } from "../engine/test-kit";
import { setup as setupClosed } from "./live-fake";

const PARAMS = { profitFeeBps: 1000, closeoutLevelBps: 5000, totalCapBps: 20000, totalCapFloor: fixedFromWire("2000000"), stressLevels: [], profitFeeCurve: [], seq: 7 };
const CHECKPOINT = { type: "checkpoint" as const, offset: "1200:1", seq: 1200, root: `0x${"ab".repeat(32)}` };
const NOTICE = { spread_tiers: [{ up_to: null, tenth_bps: 30 }], effective_at: 1_000 };

/** A stream message at `seq`: an admin command with `event`, or a tick with none. */
const message = (seq: number, event?: EngineEvent): StreamMessage => ({ offset: `${seq}:0`, type: "command", seq, ts: seq, cmd: event === undefined ? { type: "tick" } : { type: "admin", action: "set_params" }, events: event === undefined ? [] : [event] });

describe("the house state the trading surfaces read, with the House page closed", () => {
  it("reads the house state once for the trading surfaces while the House page is closed, and never the queue", async () => {
    const { client, store } = setupClosed();
    client.params = PARAMS;
    client.checkpoint = CHECKPOINT;
    client.listingNotices = { 1: NOTICE };
    client.totals = { count: 2, remaining: fixedFromWire("30.5"), largest: null, head: null, seq: 9, complete: true, stable: true };
    store.start(0);
    await settle();
    await store.refresh(false);
    await settle();
    // The prices, fees and market details read the parameters and the listing notices; later refreshes leave them.
    expect(store.getSnapshot()).toMatchObject({ houseReady: true, houseParams: PARAMS, listingNotices: { 1: NOTICE }, houseStateStatus: "read", withdrawalTotals: null });
    expect(client.houseStateReads).toBe(1);
  });

  it("reads the house state again after the stream carries an applied admin command, or resumes after a gap", async () => {
    const { client, store } = setupClosed();
    client.params = PARAMS;
    store.start(0);
    await settle();
    expect(client.houseStateReads).toBe(1);
    client.params = { ...PARAMS, profitFeeBps: 1_500, seq: 8 };
    // An admin command the engine refused changes nothing, so the next refresh reads nothing.
    client.onMessage?.(message(10, { type: "admin_rejected", reason: "below its launch value" }));
    await store.refresh(false);
    await settle();
    expect(client.houseStateReads).toBe(1);
    client.onMessage?.(message(12, { type: "admin_applied" }));
    await store.refresh(false);
    await settle();
    expect([client.houseStateReads, store.getSnapshot().houseParams?.profitFeeBps]).toEqual([2, 1_500]);
    // A feed back from a gap may have missed one.
    client.listener?.({ type: "feed", status: "stale" });
    client.listener?.({ type: "feed", status: "live" });
    await settle();
    expect(client.houseStateReads).toBe(3);
  });
});
