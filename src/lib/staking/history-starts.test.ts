/** The start the distributions card keeps (monkey-trading/console#526, #529): the earliest any read of its pages stated, kept when a page states none. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryPage } from "../engine/types";
import { flush, setup } from "../monkey/panel-kit";
import { DistributionHistoryReads, HISTORY_PAGE, RETRY_TICK_MS } from "./history-reads";

const S = Date.UTC(2026, 9, 26, 13, 52);

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** The card's reads against the mock, each page of its two kinds stated with the start `startOf` names for it. */
async function reading(startOf: (params: { kind?: string; before?: string }) => number | null, pageOf?: (params: { kind?: string; before?: string }) => HistoryPage) {
  const kit = await setup();
  kit.stop();
  const real = kit.node.client.history.bind(kit.node.client);
  vi.spyOn(kit.node.client, "history").mockImplementation(async (address, params) => {
    if (params.kind !== "distribution_allocated" && params.kind !== "operator_share_allocated") return real(address, params);
    const served = pageOf?.(params) ?? (await real(address, params));
    return { ...served, retained_from_ms: startOf(params) };
  });
  const history = new DistributionHistoryReads(kit.store);
  const stop = history.start(() => false);
  await flush();
  return { history, stop };
}

describe("the distributions card's start", () => {
  it("keeps the earliest start across a Load more that states a later one", async () => {
    const events = Array.from({ length: HISTORY_PAGE + 5 }, (_, i) => ({ type: "distribution_allocated" as const, account: "0x0", epoch: HISTORY_PAGE + 5 - i, amount: "1000", cursor: `${10 * (HISTORY_PAGE + 5 - i)}:0`, ts: HISTORY_PAGE + 5 - i }));
    const paged = (params: { kind?: string; before?: string }): HistoryPage => params.kind === "distribution_allocated"
      ? (params.before === undefined ? { events: events.slice(0, HISTORY_PAGE), next: events[HISTORY_PAGE - 1]?.cursor ?? null, retained_from_ms: null } : { events: events.slice(HISTORY_PAGE), next: null, retained_from_ms: null })
      : { events: [], next: null, retained_from_ms: null };
    const { history, stop } = await reading((params) => (params.before === undefined ? S : S + 5 * 60_000), paged);
    expect(history.getSnapshot().begins).toBe(S);
    await history.loadMore();
    expect(history.getSnapshot().begins).toBe(S);
    stop();
  });

  it("keeps the earliest start across the reads of its newest pages again", async () => {
    let reads = 0;
    const { history, stop } = await reading(() => S + reads++ * 60_000);
    expect(history.getSnapshot().begins).toBe(S);
    await vi.advanceTimersByTimeAsync(RETRY_TICK_MS);
    expect(reads).toBeGreaterThan(2);
    expect(history.getSnapshot().begins).toBe(S);
    stop();
  });

  it("keeps the held start when a read's pages state none", async () => {
    let stating = true;
    const { history, stop } = await reading(() => (stating ? S : null));
    expect(history.getSnapshot().begins).toBe(S);
    stating = false;
    await vi.advanceTimersByTimeAsync(RETRY_TICK_MS);
    expect(history.getSnapshot().begins).toBe(S);
    stop();
  });
});
