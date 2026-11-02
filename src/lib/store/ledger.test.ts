/** Tests for the P&L tab's reads: when they run, what they ask for, and how stream messages and a changed wallet affect what is held. */

import { describe, expect, it } from "vitest";

import { settle } from "../engine/test-kit";
import { fixedFromInt } from "../fixed";
import { MAX_ROWS } from "../ledger";
import { allocated, fill, lieu, message, monkey, page, SCHEDULE } from "../ledger-kit";
import { sharesOf } from "../ledger-share";
import { ACCOUNT } from "./live-fake";
import { opened } from "./ledger-store-kit";

const usd = fixedFromInt;
const PERIOD = SCHEDULE.periodMs;

describe("the P&L tab's reads", () => {
  it("reads nothing until the tab opens, whatever the stream delivers", async () => {
    const { client, store, reads } = await opened();
    client.onMessage?.(message(30, 5_000, [fill("x", 0, usd(-4))]));
    await settle();
    expect(reads()).toEqual([]);
    expect(client.scheduleReads).toBe(0);
    expect(store.getSnapshot().ledger.status).toBe("idle");
    expect(store.getSnapshot().ledger.data.rows).toEqual([]);
  });

  it("reads one page of each kind and the schedule once when the tab opens", async () => {
    const { store, client, reads } = await opened();
    store.ledger.open(ACCOUNT);
    await settle();
    expect(reads().map((r) => [r.address, r.kind, r.before, r.limit])).toEqual([
      [ACCOUNT, "fill", undefined, 100], [ACCOUNT, "corporate_cash_in_lieu", undefined, 50], [ACCOUNT, "emission_allocated", undefined, 100],
    ]);
    expect(client.scheduleReads).toBe(1);
    expect(store.getSnapshot().ledger.status).toBe("ready");
  });

  it("shows the rows with their shares once the pages and the schedule arrive", async () => {
    const { store, ledger } = await opened({
      fill: { "": page([fill("20:0", 2 * PERIOD + 5, usd(-4)), fill("19:0", 2 * PERIOD + 4, usd(-1)), fill("10:0", PERIOD, usd(3))]) },
      emission_allocated: { "": page([allocated("21:0", 3 * PERIOD + 1, 2, monkey(50n))]) },
    });
    store.ledger.open(ACCOUNT);
    await settle();
    const { data, schedule } = ledger();
    expect(data.rows.map((r) => r.cursor)).toEqual(["20:0", "19:0", "10:0"]);
    const shares = sharesOf(data, schedule);
    expect(shares.get("20:0")).toEqual({ kind: "share", units: monkey(40n) });
    expect(shares.get("19:0")).toEqual({ kind: "share", units: monkey(10n) });
    expect(shares.has("10:0")).toBe(false);
  });

  it("reads the pages once for the session: closing and reopening the tab reads nothing again", async () => {
    const { store, reads } = await opened();
    const close = store.ledger.open(ACCOUNT);
    await settle();
    close();
    store.ledger.open(ACCOUNT);
    await settle();
    expect(reads()).toHaveLength(3);
  });

  it("does not read twice when the tab opens twice at once, as StrictMode does", async () => {
    const { store, client, reads } = await opened();
    const close = store.ledger.open(ACCOUNT);
    close();
    store.ledger.open(ACCOUNT);
    await settle();
    expect(reads()).toHaveLength(3);
    expect(client.scheduleReads).toBe(1);
  });

  it("reads older pages only on load more, from each stream's own cursor, and skips a stream that ended", async () => {
    const { store, reads } = await opened({
      fill: { "": page([fill("20:0", 100, usd(-1))], "20:0"), "20:0": page([fill("10:0", 50, usd(-1))]) },
      corporate_cash_in_lieu: { "": page([lieu("15:0", 80, usd(1))]) },
    });
    store.ledger.open(ACCOUNT);
    await settle();
    expect(reads()).toHaveLength(3);
    await store.ledger.loadMore();
    expect(reads().slice(3).map((r) => [r.kind, r.before])).toEqual([["fill", "20:0"]]);
    expect(store.getSnapshot().ledger.data.rows.map((r) => r.cursor)).toEqual(["20:0", "15:0", "10:0"]);
  });

  it("ignores a second load more while one runs", async () => {
    const { store, reads } = await opened({ fill: { "": page([fill("20:0", 100, usd(-1))], "20:0") } });
    store.ledger.open(ACCOUNT);
    await settle();
    const before = reads().length;
    await Promise.all([store.ledger.loadMore(), store.ledger.loadMore()]);
    expect(reads().length - before).toBe(1);
  });

  it("reads older allocations until they reach the oldest row's period, and no further", async () => {
    const { store, reads } = await opened({
      fill: { "": page([fill("20:0", 2 * PERIOD + 5, usd(-1))]) },
      emission_allocated: {
        "": page([allocated("40:0", 6 * PERIOD, 5, 1n)], "40:0"),
        "40:0": page([allocated("30:0", 4 * PERIOD, 3, 1n)], "30:0"),
        "30:0": page([allocated("21:0", 3 * PERIOD + 1, 2, monkey(8n))], "21:0"),
        "21:0": page([allocated("1:0", 1, 0, 1n)]),
      },
    });
    store.ledger.open(ACCOUNT);
    await settle();
    expect(reads().filter((r) => r.kind === "emission_allocated").map((r) => r.before)).toEqual([undefined, "40:0", "30:0"]);
    const { data, schedule } = store.getSnapshot().ledger;
    expect(sharesOf(data, schedule).get("20:0")).toEqual({ kind: "share", units: monkey(8n) });
  });

  it("stops reading older allocations after a few pages when none reaches the oldest row's period", async () => {
    const { store, client, reads } = await opened({ fill: { "": page([fill("20:0", 2 * PERIOD + 5, usd(-1))]) } });
    const answer = client.historyAnswer;
    client.historyAnswer = (params) => {
      if (params.kind !== "emission_allocated") return answer(params);
      const n = params.before === undefined ? 0 : Number(params.before.split(":")[0]);
      return page([allocated(`${n + 1}:0`, 6 * PERIOD - n - 1, 5, 1n)], `${n + 1}:0`);
    };
    store.ledger.open(ACCOUNT);
    await settle();
    expect(reads().filter((r) => r.kind === "emission_allocated")).toHaveLength(6);
  });

  it("reads the schedule again when a reset drops the read in flight, and ignores the dropped one's answer", async () => {
    const { store, client, ledger } = await opened();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    client.emissionSchedule = async () => { client.scheduleReads++; await gate; return SCHEDULE; };
    store.ledger.open(ACCOUNT);
    await settle();
    client.listener?.({ type: "feed", status: "stale" });
    client.listener?.({ type: "feed", status: "live" });
    await settle();
    expect(client.scheduleReads).toBe(2);
    release();
    await settle();
    expect(ledger().scheduleStatus).toBe("ready");
    expect(ledger().schedule).toEqual(SCHEDULE);
  });

  it("stops reading allocations once the tab closes, and resumes them when it reopens", async () => {
    const { store, client, reads } = await opened({ fill: { "": page([fill("20:0", 2 * PERIOD + 5, usd(-1))]) } });
    const answer = client.historyAnswer;
    client.historyAnswer = (params) => {
      if (params.kind !== "emission_allocated") return answer(params);
      const n = params.before === undefined ? 0 : Number(params.before.split(":")[0]);
      return page([allocated(`${n + 1}:0`, 6 * PERIOD - n - 1, 5, 1n)], `${n + 1}:0`);
    };
    store.ledger.open(ACCOUNT)();
    await settle();
    expect(reads().filter((r) => r.kind === "emission_allocated")).toHaveLength(1);
    store.ledger.open(ACCOUNT);
    await settle();
    expect(reads().filter((r) => r.kind === "emission_allocated")).toHaveLength(6);
  });

  it("does not read allocations on load more when the rows hold their own period's", async () => {
    const { store, reads } = await opened({
      fill: { "": page([fill("20:0", 2 * PERIOD + 5, usd(-1))], "20:0") },
      emission_allocated: { "": page([allocated("21:0", 3 * PERIOD + 1, 2, 1n)], "21:0") },
    });
    store.ledger.open(ACCOUNT);
    await settle();
    await store.ledger.loadMore();
    expect(reads().filter((r) => r.kind === "emission_allocated")).toHaveLength(1);
  });

  it("keeps reading allocations for the rows it holds when the rows have reached their bound", async () => {
    const rows = Array.from({ length: MAX_ROWS }, (_, i) => fill(`${1000 + i}:0`, 2 * PERIOD + 5 + i, usd(-1)));
    const { store, reads, ledger } = await opened({
      fill: { "": page(rows.reverse()) },
      emission_allocated: { "": page([allocated("40:0", 6 * PERIOD, 5, 1n)], "40:0"), "40:0": page([allocated("21:0", 3 * PERIOD + 1, 2, monkey(8n))]) },
    });
    store.ledger.open(ACCOUNT);
    await settle();
    expect(ledger().data.rows).toHaveLength(MAX_ROWS);
    expect(reads().filter((r) => r.kind === "emission_allocated")).toHaveLength(2);
    expect(ledger().data.allocations.map((a) => a.period)).toEqual([5, 2]);
  });

  it("clears an allocation read's error when the resumed read succeeds", async () => {
    const { store, client, ledger } = await opened({ fill: { "": page([fill("20:0", 2 * PERIOD + 5, usd(-1))]) } });
    const answer = client.historyAnswer;
    let failing = true;
    client.historyAnswer = (params) => {
      if (params.kind !== "emission_allocated") return answer(params);
      if (params.before === undefined) return page([allocated("40:0", 6 * PERIOD, 5, 1n)], "40:0");
      if (failing) throw new Error("The node did not answer.");
      return page([allocated("21:0", 3 * PERIOD + 1, 2, monkey(8n))]);
    };
    const close = store.ledger.open(ACCOUNT);
    await settle();
    expect(ledger().error).toBe("The node did not answer.");
    close();
    failing = false;
    store.ledger.open(ACCOUNT);
    await settle();
    expect(ledger().error).toBeNull();
    expect(ledger().data.allocations.map((a) => a.period)).toEqual([5, 2]);
  });

  it("adds stream rows without a read, and keeps the very same state for a message that has none", async () => {
    const { store, client, reads, ledger } = await opened();
    store.ledger.open(ACCOUNT);
    await settle();
    const base = reads().length;
    client.onMessage?.(message(50, 9_000, [fill("x", 0, usd(-4))]));
    expect(ledger().data.rows.map((r) => r.cursor)).toEqual(["50:0"]);
    const held = ledger();
    client.onMessage?.(message(51, 9_500, [{ type: "market_opened", market: 1 }]));
    expect(ledger()).toBe(held);
    expect(reads()).toHaveLength(base);
  });

  it("keeps adding stream rows while the tab is closed once it has read, so reopening it misses none", async () => {
    const { store, client, reads, ledger } = await opened();
    store.ledger.open(ACCOUNT)();
    await settle();
    client.onMessage?.(message(50, 9_000, [fill("x", 0, usd(-4))]));
    store.ledger.open(ACCOUNT);
    await settle();
    expect(ledger().data.rows).toHaveLength(1);
    expect(reads()).toHaveLength(3);
  });

  it("marks a period closed from the stream, turning a pending share into the allocation's", async () => {
    const { store, client, ledger } = await opened({ fill: { "": page([fill("20:0", 5 * PERIOD + 5, usd(-4))]) } });
    store.ledger.open(ACCOUNT);
    await settle();
    expect(sharesOf(ledger().data, ledger().schedule).get("20:0")).toEqual({ kind: "pending" });
    client.onMessage?.(message(60, 6 * PERIOD + 1, [allocated("x", 0, 5, monkey(9n)), { type: "emission_period_closed", period: 5, budget: "1", allocated: "1", cancelled: "0" }]));
    expect(sharesOf(ledger().data, ledger().schedule).get("20:0")).toEqual({ kind: "share", units: monkey(9n) });
  });
});
