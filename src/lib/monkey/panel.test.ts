/** Tests for the MONKEY, Staking and Dashboard pages' store's reads of the node: what each page reads, cadence, unavailable routes, trust and lifecycle. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NO_STATS } from "../engine/live-stats";
import { SIM_EPOCH_MS } from "../mock";
import { mockHistory } from "../mock/history";
import { ConsoleStore } from "../store/store";
import { MonkeyPanel } from "./panel";
import { PAGE_FEEDS } from "./panel-state";
import { flush, setup } from "./panel-kit";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("MonkeyPanel", () => {
  it("reads the totals, the activity and the token's two charts as the MONKEY page starts", async () => {
    const { node, store, stop: stopFirst } = await setup("monkey");
    stopFirst();
    const fresh = new MonkeyPanel(store, "monkey");
    const overview = vi.spyOn(node.client.stats, "monkey");
    const activity = vi.spyOn(node.client.stats, "activity");
    const series = vi.spyOn(node.client.stats, "series");
    const stop = fresh.start(() => false);
    void fresh.feed("perLoss").show();
    void fresh.feed("supply").show();
    await flush();
    expect(overview).toHaveBeenCalledTimes(1);
    expect(activity).toHaveBeenCalledWith({ limit: 25 });
    // Two charts, three metrics between them.
    expect(series.mock.calls.map(([query]) => query.metric).sort()).toEqual(["monkey_per_loss", "total_allocated", "total_staked"]);
    stop();
  });

  it("reads the totals and nothing else as the Staking page starts, its charts having moved to the Dashboard", async () => {
    const { node, store, stop: stopFirst } = await setup();
    stopFirst();
    const fresh = new MonkeyPanel(store, "staking");
    const overview = vi.spyOn(node.client.stats, "monkey");
    const activity = vi.spyOn(node.client.stats, "activity");
    const series = vi.spyOn(node.client.stats, "series");
    const stop = fresh.start(() => false);
    await flush();
    expect(overview).toHaveBeenCalledTimes(1);
    expect(activity).not.toHaveBeenCalled();
    expect(series).not.toHaveBeenCalled();
    expect(fresh.getSnapshot().activity.status).toBe("loading");
    stop();
  });

  it("reads the totals and every chart as the Dashboard starts, and no activity", async () => {
    const { node, store, stop: stopFirst } = await setup("dashboard");
    stopFirst();
    const fresh = new MonkeyPanel(store, "dashboard");
    const overview = vi.spyOn(node.client.stats, "monkey");
    const activity = vi.spyOn(node.client.stats, "activity");
    const series = vi.spyOn(node.client.stats, "series");
    const stop = fresh.start(() => false);
    for (const name of ["epochs", "perLoss", "rewards", "supply"] as const) void fresh.feed(name).show();
    await flush();
    expect(overview).toHaveBeenCalledTimes(1);
    expect(activity).not.toHaveBeenCalled();
    expect(fresh.getSnapshot().activity.status).toBe("loading");
    // Four charts, five metrics between them.
    expect(series.mock.calls.map(([query]) => query.metric).sort()).toEqual(["cumulative_distributed", "distributed_per_epoch", "monkey_per_loss", "total_allocated", "total_staked"]);
    stop();
  });

  it("hands out its own page's charts, and refuses another page's, which only a component on the wrong page asks for", async () => {
    const { store } = await setup();
    expect(new MonkeyPanel(store, "monkey").feed("perLoss").metrics).toEqual(["monkey_per_loss"]);
    expect(new MonkeyPanel(store, "dashboard").feed("rewards").metrics).toEqual(["cumulative_distributed"]);
    expect(() => new MonkeyPanel(store, "staking").feed("supply")).toThrow("The staking page draws no supply chart.");
    expect(() => new MonkeyPanel(store, "staking").feed("epochs")).toThrow("The staking page draws no epochs chart.");
    expect(() => new MonkeyPanel(store, "monkey").feed("epochs")).toThrow("The monkey page draws no epochs chart.");
  });

  it("reads the totals and activity again every thirty seconds and not before", async () => {
    const { node, panel, stop } = await setup("monkey");
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

  it("reads every chart again every five seconds with no switch, as Live did", async () => {
    const { node, panel, stop } = await setup("dashboard");
    await vi.advanceTimersByTimeAsync(0);
    const series = vi.spyOn(node.client.stats, "series");
    await vi.advanceTimersByTimeAsync(10_000);
    // The page draws four charts.
    expect(series.mock.calls.length).toBeGreaterThanOrEqual(4 * 2);
    expect(panel.feed("epochs").getSnapshot().read.status).toBe("ready");
    stop();
  });

  it("shows a node without the routes as unavailable, with no notice, and stops asking for the totals", async () => {
    const { node } = await setup();
    const quiet = Object.assign(Object.create(Object.getPrototypeOf(node.client)), node.client, { stats: NO_STATS });
    const bare = new ConsoleStore({ client: quiet, wallets: node.wallets, history: mockHistory, initial: { markets: node.client.marketViews(), house: node.client.houseView(), startMs: SIM_EPOCH_MS } });
    const overview = vi.spyOn(quiet.stats, "monkey");
    const panel = new MonkeyPanel(bare, "monkey");
    const stop = panel.start(() => false);
    void panel.feed("perLoss").show();
    void panel.feed("supply").show();
    await vi.advanceTimersByTimeAsync(0);
    expect(panel.getSnapshot().overview.status).toBe("unavailable");
    expect(panel.getSnapshot().activity.status).toBe("unavailable");
    expect(panel.feed("supply").getSnapshot().read.status).toBe("unavailable");
    expect(bare.getSnapshot().notices).toEqual({});
    await vi.advanceTimersByTimeAsync(120_000);
    expect(overview).toHaveBeenCalledTimes(1);
    stop();
    // The Staking page reads no activity, so the totals alone decide.
    const staking = new MonkeyPanel(bare, "staking");
    const stopStaking = staking.start(() => false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(staking.getSnapshot().overview.status).toBe("unavailable");
    expect(overview).toHaveBeenCalledTimes(2);
    stopStaking();
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
    const { panel, stop } = await setup("dashboard");
    await vi.advanceTimersByTimeAsync(0);
    expect(panel.getSnapshot().overview.status).toBe("ready");
    expect(panel.getSnapshot().wallet.address).not.toBeNull();
    stop();
    expect(panel.getSnapshot()).toMatchObject({ overview: { status: "loading" }, activity: { status: "loading" }, wallet: { address: null } });
    expect(panel.feed("epochs").getSnapshot().read.status).toBe("loading");
  });

  it("takes nothing from the wallet on the Dashboard, whatever the stream carries", async () => {
    const { node, store, stop } = await setup("dashboard");
    const work = vi.spyOn(store.monkeySession.walletWork, "read");
    const distributions = vi.spyOn(node.client.stats, "distributions");
    const overview = vi.spyOn(node.client.stats, "monkey");
    work.mockClear(); // the rig's own first read is not the page's
    overview.mockClear();
    node.client.state.emit({ type: "stake" } as never, []);
    node.client.state.emit({ type: "close_epoch" } as never, []); // an EVERYONE event asks every connected wallet's reads again
    await vi.advanceTimersByTimeAsync(1_000);
    expect(overview).toHaveBeenCalled(); // the events re-read the node, so the wallet assertions below are about a read that ran
    expect(work).not.toHaveBeenCalled();
    expect(distributions).not.toHaveBeenCalled();
    stop();
  });


  it("re-reads the totals and the wallet's figures at once on a stake event from the stream, and not on a tick", async () => {
    const { node, panel, stop } = await setup();
    const overview = vi.spyOn(node.client.stats, "monkey");
    const proof = vi.spyOn(node.client.stats, "distributions");
    node.client.state.emit({ type: "tick" }, []);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(overview).not.toHaveBeenCalled();
    node.client.state.emit({ type: "stake" } as never, []);
    await vi.advanceTimersByTimeAsync(0);
    expect(overview).toHaveBeenCalledTimes(1);
    expect(proof).toHaveBeenCalledTimes(0); // no account of the wallet's in it, and not a global event
    node.client.state.emit({ type: "close_epoch" } as never, []);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(overview).toHaveBeenCalledTimes(2);
    expect(proof).toHaveBeenCalled();
    expect(panel.getSnapshot().overview.status).toBe("ready");
    stop();
  });

  it("defers initial chart and node reads while hidden, as well as timer and event reads", async () => {
    const { node, store, stop: stopFirst } = await setup("dashboard");
    stopFirst();
    const fresh = new MonkeyPanel(store, "dashboard");
    let hidden = true;
    const overview = vi.spyOn(node.client.stats, "monkey");
    const series = vi.spyOn(node.client.stats, "series");
    const stop = fresh.start(() => hidden);
    for (const name of PAGE_FEEDS.dashboard) void fresh.feed(name).show();
    await flush();
    expect(overview).not.toHaveBeenCalled();
    expect(series).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(120_000);
    node.client.state.emit({ type: "close_epoch" } as never, []);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(overview).not.toHaveBeenCalled();
    expect(series).not.toHaveBeenCalled();
    hidden = false;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(overview).toHaveBeenCalledTimes(1);
    expect(series.mock.calls.map(([query]) => query.metric).sort()).toEqual(["cumulative_distributed", "distributed_per_epoch", "monkey_per_loss", "total_allocated", "total_staked"]);
    stop();
  });

  it("backs a failing totals read off, showing it on the panel with no notice, and reads again by itself once the node answers", async () => {
    const { node, store, panel, stop } = await setup();
    const real = node.client.stats.monkey.bind(node.client.stats);
    const failing = vi.spyOn(node.client.stats, "monkey").mockRejectedValue(new Error("The node did not answer."));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(failing).toHaveBeenCalledTimes(1);
    expect(panel.getSnapshot().overview.status).toBe("failed");
    // The timer's next tries wait: 5 s after the first failure, so the 60 s tick tries, then 10 s.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(failing).toHaveBeenCalledTimes(2);
    failing.mockImplementation(real);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(panel.getSnapshot().overview.status).toBe("ready");
    expect(store.getSnapshot().notices).toEqual({});
    stop();
  });

  it("tries a totals read that keeps failing less and less often, up to every two minutes", async () => {
    const { node, panel, stop } = await setup();
    const failing = vi.spyOn(node.client.stats, "monkey").mockRejectedValue(new Error("The node did not answer."));
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(failing.mock.calls.length).toBeGreaterThanOrEqual(8);
    expect(failing.mock.calls.length).toBeLessThanOrEqual(14); // twenty minutes of thirty-second ticks would be forty tries
    expect(panel.getSnapshot().overview.status).toBe("failed");
    stop();
  });
});
