/** Tests for the MONKEY page store's reads of the node: cadence, unavailable routes, trust and lifecycle. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NO_STATS } from "../engine/live-stats";
import { SIM_EPOCH_MS } from "../mock";
import { mockHistory } from "../mock/history";
import { ConsoleStore } from "../store/store";
import { MonkeyPanel } from "./panel";
import { flush, setup } from "./panel-kit";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("MonkeyPanel", () => {
  it("reads the totals, the activity and every chart as it starts", async () => {
    const { node, store } = await setup();
    const fresh = new MonkeyPanel(store);
    const overview = vi.spyOn(node.client.stats, "monkey");
    const activity = vi.spyOn(node.client.stats, "activity");
    const series = vi.spyOn(node.client.stats, "series");
    const stop = fresh.start(() => false);
    await flush();
    expect(overview).toHaveBeenCalledTimes(1);
    expect(activity).toHaveBeenCalledWith({ limit: 25 });
    // Four charts, five metrics between them.
    expect(series.mock.calls.map(([query]) => query.metric).sort()).toEqual(["cumulative_distributed", "distributed_per_epoch", "monkey_per_loss", "total_allocated", "total_staked"]);
    stop();
  });

  it("reads the totals and activity again every thirty seconds and not before", async () => {
    const { node, panel, stop } = await setup();
    const overview = vi.spyOn(node.client.stats, "monkey");
    const activity = vi.spyOn(node.client.stats, "activity");
    await vi.advanceTimersByTimeAsync(25_000);
    expect(overview).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(overview).toHaveBeenCalledTimes(1);
    expect(activity).toHaveBeenCalledWith({ limit: 25 });
    expect(panel.getSnapshot().overview.status).toBe("ready");
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(overview).toHaveBeenCalledTimes(1);
  });

  it("reads a chart again every five seconds only while its Live switch is on", async () => {
    const { node, panel, stop } = await setup();
    await vi.advanceTimersByTimeAsync(0);
    const series = vi.spyOn(node.client.stats, "series");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(series).not.toHaveBeenCalled();
    panel.feeds.rewards.setLive(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(series).toHaveBeenCalledTimes(2);
    stop();
  });

  it("shows a node without the routes as unavailable, with no toast, and stops asking for the totals", async () => {
    const { node } = await setup();
    const quiet = Object.assign(Object.create(Object.getPrototypeOf(node.client)), node.client, { stats: NO_STATS });
    const bare = new ConsoleStore({ client: quiet, wallets: node.wallets, history: mockHistory, initial: { markets: node.client.marketViews(), house: node.client.houseView(), startMs: SIM_EPOCH_MS } });
    const panel = new MonkeyPanel(bare);
    const overview = vi.spyOn(quiet.stats, "monkey");
    const stop = panel.start(() => false);
    await vi.advanceTimersByTimeAsync(0);
    expect(panel.getSnapshot().overview.status).toBe("unavailable");
    expect(panel.getSnapshot().activity.status).toBe("unavailable");
    expect(panel.feeds.supply.getSnapshot().read.status).toBe("unavailable");
    expect(bare.getSnapshot().toasts).toEqual([]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(overview).toHaveBeenCalledTimes(1);
    stop();
  });

  it("does not let a totals read from before the page stopped overwrite the one after it reopened", async () => {
    const { node, panel, stop } = await setup();
    const real = node.client.stats.monkey.bind(node.client.stats);
    let release: () => void = () => {};
    let calls = 0;
    node.client.stats.monkey = async () => {
      calls += 1;
      if (calls > 1) return real();
      await new Promise<void>((resolve) => { release = resolve; });
      return { ...(await real()), seq: 1 };
    };
    stop();
    const stopped = panel.start(() => false);
    await flush();
    stopped();
    const restart = panel.start(() => false);
    await flush();
    release();
    await flush();
    expect(panel.getSnapshot().overview.value?.seq).not.toBe(1);
    restart();
  });

  it("requests nothing for a page that is not open, however late a transaction lands", async () => {
    const { node, panel, stop } = await setup();
    stop();
    const overview = vi.spyOn(node.client.stats, "monkey");
    await panel.refreshNode();
    expect(overview).not.toHaveBeenCalled();
  });

  it("reads nothing on the timer while the tab is hidden", async () => {
    const { node, panel, stop } = await setup();
    stop();
    const overview = vi.spyOn(node.client.stats, "monkey");
    const stopHidden = panel.start(() => true);
    await vi.advanceTimersByTimeAsync(0);
    overview.mockClear();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(overview).not.toHaveBeenCalled();
    stopHidden();
  });

  it("forgets what it read when it stops, so a page that regains trust shows nothing of the last session", async () => {
    const { panel, stop } = await setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(panel.getSnapshot().overview.status).toBe("ready");
    expect(panel.getSnapshot().wallet.address).not.toBeNull();
    stop();
    expect(panel.getSnapshot()).toMatchObject({ overview: { status: "loading" }, activity: { status: "loading" }, wallet: { address: null } });
    expect(panel.feeds.supply.getSnapshot().read.status).toBe("loading");
  });

});
