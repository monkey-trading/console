/** Tests for the mock node's dashboard routes: they answer the real node's shapes, consistently with one another and with the node's figures. */

import { describe, expect, it } from "vitest";

import { EngineError } from "../engine/client";
import { decodeHouse } from "../models";
import { createMockNode, SIM_EPOCH_MS } from "./index";
import { numberOf } from "./stats-model";

const node = () => createMockNode(SIM_EPOCH_MS, true);
const query = { metric: "nav", market: null, resolution: "1m", fromMs: SIM_EPOCH_MS - 3_600_000, toMs: SIM_EPOCH_MS, limit: 100 } as const;

describe("the mock node's dashboard routes", () => {
  it("serves /v1/house's scan figures, which decode and reconcile with its markets", async () => {
    const { client } = node();
    const house = decodeHouse(await client.house());
    const scan = house.scan;
    expect(scan?.markets).toHaveLength(5);
    expect(scan?.openPositions).toBe(scan?.markets.reduce((n, m) => n + (m.longPositions ?? 0) + (m.shortPositions ?? 0), 0));
    for (const m of scan?.markets ?? []) expect(m.net).toBe((m.long ?? 0n) - (m.short ?? 0n));
  });

  it("answers a gross exposure that is the sum of the markets' absolute nets", async () => {
    const house = await node().client.house();
    const sum = (house.markets ?? []).reduce((total, m) => total + Math.abs(numberOf(m.net ?? "0")), 0);
    expect(numberOf(house.gross_exposure)).toBeCloseTo(sum, 2);
    expect(sum).toBeGreaterThan(0);
  });

  it("ends a level series on the figure the node answers now, from the log's first command", async () => {
    const { client } = node();
    const page = await client.stats.series(query);
    const last = page.entries[page.entries.length - 1];
    expect(page).toMatchObject({ kind: "level", unit: "usd", from_genesis: true, next: null });
    expect(last && "close" in last ? numberOf(last.close) : null).toBeCloseTo(numberOf((await client.house()).nav), 2);
    expect(page.entries.length).toBeLessThanOrEqual(100);
  });

  it("serves the same series for the same clock", async () => {
    const a = await node().client.stats.series(query);
    const b = await node().client.stats.series(query);
    expect(a).toEqual(b);
    expect(new Set(a.entries.map((e) => ("close" in e ? e.close : ""))).size).toBeGreaterThan(10);
  });

  it("moves with the node's clock: a later read holds newer buckets", async () => {
    const { client } = node();
    const before = await client.stats.series(query);
    client.tick(SIM_EPOCH_MS + 10 * 60_000);
    const later = await client.stats.series({ ...query, fromMs: query.fromMs, toMs: SIM_EPOCH_MS + 10 * 60_000, limit: 200 });
    const lastTs = (page: typeof before) => page.entries[page.entries.length - 1]?.ts ?? 0;
    expect(lastTs(later)).toBeGreaterThan(lastTs(before));
    expect(later.entries.length).toBeGreaterThan(before.entries.length);
  });

  it("counts a held account as one position however large it grows", async () => {
    const { client } = node();
    const count = async () => (await client.stats.positions(1)).long.count + (await client.stats.positions(1)).short.count;
    const baseline = await count();
    const account = client.state.account("0x" + "ab".repeat(20));
    account.positions.set(1, { qty: 5_000_000_000n, entry: 1n });
    const withOne = await count();
    account.positions.set(1, { qty: 500_000_000_000n, entry: 1n });
    expect(await count()).toBe(withOne);
    expect(withOne).toBe(baseline + 1);
  });

  it("pages by its limit and names where the next page starts", async () => {
    const page = await node().client.stats.series({ ...query, limit: 10 });
    expect(page.entries).toHaveLength(10);
    expect(page.next).toBe(SIM_EPOCH_MS - 3_600_000 + 10 * 60_000);
  });

  it("serves volume as a flow of values and refuses what the node refuses", async () => {
    const { client } = node();
    const volume = await client.stats.series({ ...query, metric: "volume" });
    expect(volume.kind).toBe("flow");
    expect(volume.entries.every((e) => "value" in e && numberOf(e.value) > 0)).toBe(true);
    await expect(client.stats.series({ ...query, metric: "long" })).rejects.toBeInstanceOf(EngineError);
    await expect(client.stats.series({ ...query, metric: "nav", market: 1 })).rejects.toBeInstanceOf(EngineError);
    await expect(client.stats.series({ ...query, metric: "long", market: 99 })).rejects.toBeInstanceOf(EngineError);
  });

  it("holds each market's notional in its close-out and profit buckets, and none for an unlisted market", async () => {
    const { client } = node();
    const view = await client.stats.positions(1);
    const sum = (buckets: readonly { long_usd: string; short_usd: string }[], side: "long_usd" | "short_usd") => buckets.reduce((n, b) => n + numberOf(b[side]), 0);
    const closeoutLong = sum(view.closeout, "long_usd") + numberOf(view.beyond_range.long_usd) + numberOf(view.due_now.long_usd);
    expect(closeoutLong).toBeCloseTo(numberOf(view.long.usd), 0);
    expect(sum(view.profit, "short_usd")).toBeCloseTo(numberOf(view.short.usd), 0);
    expect(view.closeout[0]?.from_bps).toBe(-view.closeout_range_bps);
    expect(view.profit[0]?.from_bps).toBeNull();
    expect(view.profit[view.profit.length - 1]?.to_bps).toBeNull();
    expect(Number(numberOf(view.closeout[0]?.from_price ?? "0"))).toBeLessThan(numberOf(view.mark ?? "0"));
    await expect(client.stats.positions(99)).rejects.toBeInstanceOf(EngineError);
  });

  it("serves the MONKEY totals and the distribution's liquidity floor", async () => {
    const monkey = await node().client.stats.monkey();
    expect(monkey.emissions?.period_ms).toBe(600_000);
    expect(monkey.distribution?.liquidity_floor).toBe("8000000");
    expect(monkey.staking?.stakers).toBeGreaterThan(0);
  });

  it("derives the ledger's emission schedule from the same /v1/monkey answer", async () => {
    const { client } = node();
    const monkey = await client.stats.monkey();
    expect(await client.emissionSchedule()).toEqual({ startMs: monkey.emissions?.start_ms, periodMs: monkey.emissions?.period_ms, period: monkey.emissions?.period });
  });

  it("serves index candles for the close-out map that end at the mark", async () => {
    const { client } = node();
    const page = await client.marks(1, "1m", SIM_EPOCH_MS - 3_600_000, SIM_EPOCH_MS);
    const last = page.entries[page.entries.length - 1];
    expect(page.entries.length).toBeGreaterThan(30);
    expect(page.entries.every((e) => e.ts >= SIM_EPOCH_MS - 3_600_000 && e.ts <= SIM_EPOCH_MS)).toBe(true);
    expect(numberOf(last?.close ?? "0")).toBeCloseTo(numberOf((await client.markets())[0]?.mark ?? "0"), 1);
  });
});
