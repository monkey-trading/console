/** What a move to another node keeps of what the console said, each request's outcome where the trader made it and nothing said of the node left behind, and of the screen. */

import { describe, expect, it } from "vitest";

import { memoryStorage } from "../engine/wallet-kit";
import { authorizedTab, nextStore } from "./live-kit";
import { carriedNotices, moveToNode } from "./node-move";
import { NOTICE_SURFACES, type Notices } from "./state";

describe("carriedNotices", () => {
  it("keeps what a request came to, such as an order sent as the old node went down, and drops what was said of the old node's reads", () => {
    const notices: Notices = Object.fromEntries(NOTICE_SURFACES.map((surface, id) => [surface, { id, tone: "error", text: surface }]));
    const kept = Object.keys(carriedNotices(notices)).sort();
    expect(kept).toEqual(NOTICE_SURFACES.filter((surface) => !["node", "feed", "accountRead", "payoutReads", "chart"].includes(surface)).sort());
    expect(kept).toContain("ticket");
    expect(carriedNotices({ ticket: { id: 1, tone: "error", text: "The server did not respond." } })).toEqual({ ticket: { id: 1, tone: "error", text: "The server did not respond." } });
  });

  it("carries nothing from a store that said nothing", () => {
    expect(carriedNotices({})).toEqual({});
  });
});

describe("moveToNode", () => {
  it("says on the new server what a request came to, before, through and after reconnecting the wallet, on the same market and timeframe", async () => {
    const storage = memoryStorage();
    const old = await authorizedTab(storage);
    old.store.patch({ selected: 7, timeframe: "1h" });
    old.store.notify("ticket", "The server did not respond. The request may still have been executed.");
    old.store.notify("feed", "The old server's feed failed.");
    const next = nextStore(storage);
    const moving = moveToNode(old.store, next.store);
    // The market and timeframe on screen move with it (the kit's server lists only BTC-USD, so its markets read later falls back to that).
    expect([next.store.getSnapshot().selected, next.store.getSnapshot().timeframe]).toEqual([7, "1h"]);
    // Heard after the move's own listener, as a screen reading the store renders once every listener has run.
    const seen: (string | undefined)[] = [];
    next.store.subscribe(() => seen.push(next.store.getSnapshot().notices.ticket?.text));
    // From the move, through the reconnect that clears the wallet's surfaces, the outcome is never missing for a moment.
    expect(next.store.getSnapshot().notices.ticket?.text).toContain("did not respond");
    await moving;
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((text) => text?.includes("did not respond"))).toBe(true);
    const { notices } = next.store.getSnapshot();
    expect([notices.ticket?.text, notices.feed]).toEqual(["The server did not respond. The request may still have been executed.", undefined]);
    // An outcome the old store says only once its refresh has ended, after the move, is said on the new one too.
    old.store.notify("orders", "No live price is available, so the order was refused.");
    expect(next.store.getSnapshot().notices.orders?.text).toBe("No live price is available, so the order was refused.");
  });
});
