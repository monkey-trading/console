/** Tests for the scan's session pruning and the listing changes (`upsert_market`) the log carries. */

import { describe, expect, it } from "vitest";

import { frame, prices, scanWith, SESSIONS } from "./live-marks-kit";
import { FakeSocket } from "./test-kit";
import type { PriceRules } from "./types";

describe("session pruning and listing replay", () => {
  it("prunes retained quotes across a session close, so no mark prices after it", async () => {
    const CLOSE = 15_000;
    const sockets: FakeSocket[] = [];
    const rule: PriceRules = { max_age_ms: 500, max_divergence_bps: 100, min_sources: 1 };
    const sessions = { 1: { inSession: (ts: number, now: number) => ts <= CLOSE && now <= CLOSE } };
    const { found } = scanWith(sockets, { 1: rule }, sessions);
    await Promise.resolve();
    const socket = sockets[0];
    if (!socket) throw new Error("no socket");
    socket.receive(frame(0, prices(40, 14_000, "100"))); // in session: warms the book up
    socket.receive(frame(1, prices(41, 14_501, "100"))); // in session: a mark
    socket.receive(frame(2, prices(42, CLOSE + 500, "101"))); // after the close: incoming refused, retained pruned
    socket.receive(frame(3, { type: "heartbeat", head: "42:0" }));
    await expect(found).resolves.toEqual([{ market: 1, ts: 14_501, mid: 100 }]);
  });

  it("applies an upsert_market the log carries, replacing the rules in force from that seq on", async () => {
    const sockets: FakeSocket[] = [];
    const strict: PriceRules = { max_age_ms: 1_000, max_divergence_bps: 100, min_sources: 2 };
    const { found } = scanWith(sockets, { 1: strict }, SESSIONS);
    await Promise.resolve();
    const socket = sockets[0];
    if (!socket) throw new Error("no socket");
    socket.receive(frame(0, prices(40, 9_000, "100"))); // one source under min_sources 2: no price
    socket.receive(frame(1, prices(41, 10_000, "101")));
    socket.receive(frame(2, {
      offset: "42:0", type: "command", seq: 42, ts: 10_500, events: [{ type: "admin_applied" }],
      cmd: { type: "signed_admin", command: { action: "upsert_market", id: 1, price_rules: { max_age_ms: 1_000, max_divergence_bps: 100, min_sources: 1 }, schedule: { kind: "always_open" } } },
    }));
    socket.receive(frame(3, prices(43, 11_000, "102"))); // the new listing, and a cleared book: warms up
    socket.receive(frame(4, prices(44, 12_001, "103"))); // one source now prices
    socket.receive(frame(5, { type: "heartbeat", head: "44:0" }));
    await expect(found).resolves.toEqual([{ market: 1, ts: 12_001, mid: 103 }]);
  });

  it("ignores an upsert_market the engine rejected, keeping the rules, schedule, and book it had", async () => {
    const sockets: FakeSocket[] = [];
    const strict: PriceRules = { max_age_ms: 1_000, max_divergence_bps: 100, min_sources: 2 };
    const { found } = scanWith(sockets, { 1: strict }, SESSIONS);
    await Promise.resolve();
    const socket = sockets[0];
    if (!socket) throw new Error("no socket");
    socket.receive(frame(0, prices(40, 9_000, "100"))); // one source under min_sources 2: no price
    socket.receive(frame(1, prices(41, 10_001, "101"))); // still no price
    socket.receive(frame(2, {
      offset: "42:0", type: "command", seq: 42, ts: 10_500, events: [{ type: "admin_rejected", reason: "margin tiers overlap" }],
      cmd: { type: "signed_admin", command: { action: "upsert_market", id: 1, price_rules: { max_age_ms: 1_000, max_divergence_bps: 100, min_sources: 1 }, schedule: { kind: "always_open" } } },
    }));
    socket.receive(frame(3, prices(43, 11_002, "102"))); // the rejected listing stands unapplied: warms up under min_sources 2
    socket.receive(frame(4, prices(44, 12_003, "103"))); // one fresh source: still no price under min_sources 2
    socket.receive(frame(5, { type: "heartbeat", head: "44:0" }));
    await expect(found).resolves.toEqual([]);
  });

  it("advances the books on an accepted upsert, as the engine recomputes every mark on that command", async () => {
    const sockets: FakeSocket[] = [];
    const rule: PriceRules = { max_age_ms: 2_000, max_divergence_bps: 100, min_sources: 1 };
    const { found } = scanWith(sockets, { 1: rule, 2: rule }, SESSIONS);
    await Promise.resolve();
    const socket = sockets[0];
    if (!socket) throw new Error("no socket");
    socket.receive(frame(0, prices(40, 10_000, "100"))); // market 1: warms up
    socket.receive(frame(1, prices(41, 12_001, "101"))); // market 1: a mark
    socket.receive(frame(2, {
      offset: "42:0", type: "command", seq: 42, ts: 14_000, events: [{ type: "admin_applied" }],
      // An upsert for market 2, naming no usable spec: market 1 still advances to the command's time.
      cmd: { type: "signed_admin", command: { action: "upsert_market", id: 2 } },
    }));
    socket.receive(frame(3, { type: "heartbeat", head: "42:0" }));
    // Market 1's book is fresh at the upsert (its quote is 1_999 ms old): the engine's index there is a mark.
    await expect(found).resolves.toEqual([
      { market: 1, ts: 12_001, mid: 101 },
      { market: 1, ts: 14_000, mid: 101 },
    ]);
  });

  it("excludes a market from the replay when a listing quotes it in another currency", async () => {
    const sockets: FakeSocket[] = [];
    const rule: PriceRules = { max_age_ms: 1_000, max_divergence_bps: 100, min_sources: 1 };
    const { found } = scanWith(sockets, { 1: rule }, SESSIONS);
    await Promise.resolve();
    const socket = sockets[0];
    if (!socket) throw new Error("no socket");
    socket.receive(frame(0, prices(40, 10_000, "100"))); // warms up
    socket.receive(frame(1, prices(41, 12_001, "101"))); // a mark, while USD-quoted
    socket.receive(frame(2, {
      offset: "42:0", type: "command", seq: 42, ts: 12_500, events: [{ type: "admin_applied" }],
      // The listing moves the market to EUR: the engine's marks now need the FX market's index.
      cmd: { type: "signed_admin", command: { action: "upsert_market", id: 1, price_rules: { max_age_ms: 1_000, max_divergence_bps: 100, min_sources: 1 }, quote_currency: { currency: "eur", fx_market: 3 } } },
    }));
    socket.receive(frame(3, prices(43, 13_500, "102"))); // the bounded replay cannot price this
    socket.receive(frame(4, prices(44, 14_501, "103"))); // and stays dark once warmed up again
    socket.receive(frame(5, { type: "heartbeat", head: "44:0" }));
    await expect(found).resolves.toEqual([{ market: 1, ts: 12_001, mid: 101 }]);
  });

  it("never lets a listing in the log re-enable a market the scan excluded", async () => {
    const sockets: FakeSocket[] = [];
    // No eligible markets: a futures-priced listing the window carries must stay unscanned.
    const { found } = scanWith(sockets, {}, {});
    await Promise.resolve();
    const socket = sockets[0];
    if (!socket) throw new Error("no socket");
    socket.receive(frame(0, {
      offset: "40:0", type: "command", seq: 40, ts: 9_500, events: [{ type: "admin_applied" }],
      cmd: { type: "admin", action: "upsert_market", id: 1, price_rules: { max_age_ms: 1_000, max_divergence_bps: 100, min_sources: 1 }, schedule: { kind: "always_open" } },
    }));
    socket.receive(frame(1, prices(41, 10_000, "100"))); // front and next contract quotes would mix here
    socket.receive(frame(2, prices(42, 11_001, "101")));
    socket.receive(frame(3, { type: "heartbeat", head: "42:0" }));
    await expect(found).resolves.toEqual([]);
  });
});
