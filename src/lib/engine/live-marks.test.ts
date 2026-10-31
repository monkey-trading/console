/** Tests for the one-off signed log scan that backfills the chart's marks from the log's `prices` commands. */

import { describe, expect, it } from "vitest";

import { BUDGET, frame, prices, rejectFrames, RULES, scanWith, scanning, sessionRulesFor, SESSIONS } from "./live-marks-kit";
import { acceptAll, FakeSocket } from "./test-kit";
import type { PriceRules } from "./types";
import type { Verifier } from "./verifier";

describe("scanning the log for marks", () => {
  it("opens from the seq given, folds prices commands into index marks, and ends once the cursor reaches the head a heartbeat names", async () => {
    const sockets: FakeSocket[] = [];
    const { run } = scanning(sockets);
    const found = run(40);
    await Promise.resolve();
    const socket = sockets[0];
    if (!socket) throw new Error("no socket");
    expect(socket.url).toBe(`wss://node.test/v1/stream?signed=1&challenge=${"ab".repeat(32)}&from=40`);
    // A heartbeat naming a head beyond the cursor does not end the read.
    socket.receive(frame(0, { type: "heartbeat", head: "45:0" }));
    socket.receive(frame(1, prices(40, 10_000, "99"))); // the first command: its mark warms the book up
    socket.receive(frame(2, prices(41, 11_000, "100"))); // exactly one freshness window later: still warming up
    socket.receive(frame(3, prices(42, 12_000, "101", "b")));
    socket.receive(frame(4, { type: "checkpoint", offset: "42:1", seq: 42 })); // the cursor advances on any offset-bearing entry
    let settled = false;
    void found.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    socket.receive(frame(5, prices(43, 13_000, "102")));
    socket.receive(frame(6, prices(44, 14_000, "103", "b")));
    socket.receive(frame(7, prices(45, 15_000, "104")));
    socket.receive(frame(8, { type: "heartbeat", head: "45:0" }));
    await expect(found).resolves.toEqual([
      { market: 1, ts: 12_000, mid: 100.5 },
      { market: 1, ts: 13_000, mid: 101.5 },
      { market: 1, ts: 14_000, mid: 102.5 },
      { market: 1, ts: 15_000, mid: 103.5 },
    ]);
    expect(socket.closed).toBe(true);
  });

  it("thins marks closer than the step and keeps, per market, only the marks within the window of its newest", async () => {
    const sockets: FakeSocket[] = [];
    const { run } = scanning(sockets);
    const found = run(40);
    await Promise.resolve();
    const socket = sockets[0];
    if (!socket) throw new Error("no socket");
    socket.receive(frame(0, prices(40, 8_999, "100"))); // warms the book up
    socket.receive(frame(1, prices(41, 10_000, "102"))); // emitted, then falls before the kept window
    socket.receive(frame(2, prices(42, 11_000, "103"))); // emitted, exactly at the window's edge: kept
    socket.receive(frame(3, prices(43, 11_500, "103.5"))); // inside the step of the last mark: skipped
    socket.receive(frame(4, prices(44, 16_000, "105"))); // the newest mark: the window ends 5 s before it
    socket.receive(frame(5, { type: "heartbeat", head: "44:0" }));
    await expect(found).resolves.toEqual([
      { market: 1, ts: 11_000, mid: 103 },
      { market: 1, ts: 16_000, mid: 105 },
    ]);
  });

  it("stops at the message budget, and answers with what it kept when the connection then drops", async () => {
    const sockets: FakeSocket[] = [];
    const { run } = scanning(sockets);
    const found = run(40, { ...BUDGET, maxMessages: 3, coverMs: Number.POSITIVE_INFINITY });
    await Promise.resolve();
    const socket = sockets[0];
    if (!socket) throw new Error("no socket");
    socket.receive(frame(0, prices(40, 9_000, "100")));
    socket.receive(frame(1, prices(41, 10_000, "101")));
    socket.receive(frame(2, prices(42, 11_001, "101")));
    await expect(found).resolves.toEqual([{ market: 1, ts: 11_001, mid: 101 }]);
    expect(socket.closed).toBe(true);
    const late = run(40);
    await Promise.resolve();
    sockets[1]?.receive(frame(0, prices(40, 10_000, "100")));
    sockets[1]?.receive(frame(1, prices(41, 11_000, "101")));
    sockets[1]?.receive(frame(2, prices(42, 12_001, "102")));
    sockets[1]?.drop("close");
    await expect(late).resolves.toEqual([{ market: 1, ts: 12_001, mid: 102 }]);
  });

  it("rejects when the log gives nothing readable, and gives up when the budget's time runs out", async () => {
    const sockets: FakeSocket[] = [];
    const { run, scheduler } = scanning(sockets);
    const broken = run(40);
    await Promise.resolve();
    sockets[0]?.receive(frame(1, { type: "heartbeat", head: "45:0" }));
    await expect(broken).rejects.toThrow("skipped");
    const slow = run(40);
    await Promise.resolve();
    sockets[1]?.receive(frame(0, { type: "heartbeat", head: "45:0" }));
    sockets[1]?.receive(frame(1, prices(40, 10_000, "100")));
    sockets[1]?.receive(frame(2, prices(41, 11_000, "101")));
    sockets[1]?.receive(frame(3, prices(42, 12_001, "102")));
    scheduler.advance(30_000);
    await expect(slow).resolves.toEqual([{ market: 1, ts: 12_001, mid: 102 }]);
  });

  it("rejects a failure that read entries but collected no marks, so the store retries instead of seeding nothing", async () => {
    const sockets: FakeSocket[] = [];
    const { run } = scanning(sockets);
    const empty = run(40);
    await Promise.resolve();
    sockets[0]?.receive(frame(0, { type: "checkpoint", offset: "40:0", seq: 40 }));
    sockets[0]?.drop("close");
    await expect(empty).rejects.toThrow("closed while scanning");
  });

  it("suppresses marks until unseen pre-scan quotes must have expired, a millisecond past the freshness window", async () => {
    const sockets: FakeSocket[] = [];
    const { run } = scanning(sockets);
    const found = run(40);
    await Promise.resolve();
    const socket = sockets[0];
    if (!socket) throw new Error("no socket");
    // The engine may hold fresh quotes the scan never sees; a mark within one freshness window of
    // the first command could price from that unseen book. A quote exactly max_age old still
    // counts, so the boundary mark is kept back too.
    socket.receive(frame(0, prices(40, 10_000, "100")));
    socket.receive(frame(1, prices(41, 11_000, "101")));
    socket.receive(frame(2, prices(42, 11_001, "102")));
    socket.receive(frame(3, { type: "heartbeat", head: "42:0" }));
    await expect(found).resolves.toEqual([{ market: 1, ts: 11_001, mid: 102 }]);
  });

  it("advances every market on each command, so a tick expiring a source moves the index", async () => {
    const sockets: FakeSocket[] = [];
    const rule: PriceRules = { max_age_ms: 1_000, max_divergence_bps: 100, min_sources: 1 };
    const { found } = scanWith(sockets, { 1: rule }, sessionRulesFor([1]));
    await Promise.resolve();
    const socket = sockets[0];
    if (!socket) throw new Error("no socket");
    socket.receive(frame(0, prices(40, 10_000, "100"))); // warms the book up
    socket.receive(frame(1, prices(41, 10_500, "100.2", "b"))); // inside the warm-up: no mark
    socket.receive(frame(2, { offset: "42:0", type: "command", seq: 42, ts: 11_500, cmd: { type: "tick" }, events: [] })); // the stale source expires, as on the engine
    socket.receive(frame(3, { type: "heartbeat", head: "42:0" }));
    await expect(found).resolves.toEqual([{ market: 1, ts: 11_500, mid: 100.2 }]);
  });

  it("enforces the message budget on non-command entries too", async () => {
    const sockets: FakeSocket[] = [];
    const { run } = scanning(sockets);
    const found = run(40, { ...BUDGET, maxMessages: 2, coverMs: Number.POSITIVE_INFINITY });
    await Promise.resolve();
    const socket = sockets[0];
    if (!socket) throw new Error("no socket");
    socket.receive(frame(0, prices(40, 10_000, "100"))); // command: counted
    socket.receive(frame(1, { type: "checkpoint", offset: "41:0", seq: 41 })); // checkpoint: the budget is spent here
    expect(socket.closed).toBe(true); // the read ends at the budget on a non-command entry
    await expect(found).resolves.toEqual([]);
  });

  it("rejects a frame that does not verify, before any mark, and answers with the kept marks after a valid prefix", async () => {
    const before: FakeSocket[] = [];
    const early = scanWith(before, RULES, SESSIONS, undefined, rejectFrames);
    await Promise.resolve();
    const first = before[0];
    if (!first) throw new Error("no socket");
    first.receive(frame(0, prices(40, 10_000, "100")));
    await expect(early.found).rejects.toThrow("did not verify");
    expect(first.closed).toBe(true);

    // A verifier that accepts two frames and then fails: the verified prefix's marks are kept.
    const flaky: Verifier = {
      ...acceptAll,
      openFrames: () => {
        let seen = 0;
        return {
          verify: (text) => {
            seen += 1;
            if (seen > 2) return { ok: false, reason: "bad signature" };
            return { ok: true, msg: (JSON.parse(text) as { msg: string }).msg };
          },
        };
      },
    };
    const after: FakeSocket[] = [];
    const late = scanWith(after, RULES, SESSIONS, undefined, flaky);
    await Promise.resolve();
    const second = after[0];
    if (!second) throw new Error("no socket");
    second.receive(frame(0, prices(40, 10_000, "100"))); // warms up
    second.receive(frame(1, prices(41, 11_001, "101"))); // verified: a mark
    second.receive(frame(2, prices(42, 12_002, "102"))); // unsigned: the read ends with what it kept
    await expect(late.found).resolves.toEqual([{ market: 1, ts: 11_001, mid: 101 }]);
    expect(second.closed).toBe(true);
  });

  it("closes the socket and ends when the caller cancels the scan", async () => {
    const sockets: FakeSocket[] = [];
    let dead = false;
    const { found } = scanWith(sockets, RULES, SESSIONS, () => dead);
    await Promise.resolve();
    const socket = sockets[0];
    if (!socket) throw new Error("no socket");
    socket.receive(frame(0, prices(40, 10_000, "100"))); // read while live
    dead = true;
    socket.receive(frame(1, prices(41, 11_000, "101"))); // the next message finds the scan cancelled
    await expect(found).rejects.toThrow("cancelled");
    expect(socket.closed).toBe(true);
  });

  it("advances a market on another market's prices command, as the engine recomputes every mark each command", async () => {
    const sockets: FakeSocket[] = [];
    const rule: PriceRules = { max_age_ms: 2_000, max_divergence_bps: 100, min_sources: 1 };
    const { found } = scanWith(sockets, { 1: rule, 2: rule }, sessionRulesFor([1, 2]));
    await Promise.resolve();
    const socket = sockets[0];
    if (!socket) throw new Error("no socket");
    const two = (seq: number, ts: number, mid: string) => ({ ...prices(seq, ts, mid), cmd: { type: "prices", market: 2, quotes: [{ source: "a", mid, ts }] } });
    socket.receive(frame(0, two(40, 10_000, "200"))); // market 2: warms up
    socket.receive(frame(1, two(41, 12_001, "201"))); // market 2: a mark
    socket.receive(frame(2, two(42, 12_400, "202"))); // inside the step: no mark, the book refreshes
    socket.receive(frame(3, prices(43, 13_500, "100"))); // market 1's command advances market 2 to a fresh mark
    socket.receive(frame(4, { type: "heartbeat", head: "43:0" }));
    await expect(found).resolves.toEqual([
      { market: 2, ts: 12_001, mid: 201 },
      { market: 1, ts: 13_500, mid: 100 },
      { market: 2, ts: 13_500, mid: 202 },
    ]);
  });
});
