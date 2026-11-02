/** Tests for the operator card's reads and what they let the page show. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EngineError } from "../engine/client";
import { NO_CANDIDATE, type DeploymentReads } from "../engine/registry";
import { connectWallet, disconnectWallet } from "../store/actions";
import { delegateStake } from "./actions";
import { hostnameListed, mirroredElection, OperatorReads, shownHostname } from "./operators";
import { NODE_READ_MS } from "./panel";
import { flush, setup } from "./panel-kit";

const DEPLOY = { origin: "https://build.example", candidateOrigins: ["https://b.example"] };
const FIVE_MINUTES = 300_000;

describe("shownHostname", () => {
  it("shows a plain host, lowercased, and nothing a lookalike or markup could hide behind", () => {
    expect(shownHostname("B.Example:8443")).toBe("b.example:8443");
    expect(shownHostname(null)).toBeNull();
    for (const hostile of ["аpi.example", "<b>x</b>", "https://b.example", "", "b.example/path"]) expect(shownHostname(hostile), hostile).toBeNull();
  });
});

describe("hostnameListed", () => {
  it("says whether the build could connect there", () => {
    expect(hostnameListed(DEPLOY, "b.example")).toBe(true);
    expect(hostnameListed(DEPLOY, "build.example")).toBe(true);
    expect(hostnameListed(DEPLOY, "evil.example")).toBe(false);
    expect(hostnameListed(DEPLOY, "not a host")).toBe(false);
  });
});

describe("mirroredElection", () => {
  const route = (election: Partial<NonNullable<Parameters<typeof mirroredElection>[0]>["last_election"]> | null) => ({
    operator: "0xk", pending_rotation: null, rotation_enabled: true, last_election: election === null ? null : { epoch: 1, candidate: "0xb", admin_key: "0xk", effective_at: 100, registry_effective_at: 100, ...election },
  });

  it("names an election still ahead of the node's clock", () => {
    expect(mirroredElection(route({}), 99)).toEqual({ candidate: "0xb", effectiveAtMs: 100 });
  });

  it("names none on a clock no frame has set, against which any election would look ahead", () => {
    expect(mirroredElection(route({}), 0)).toBeNull();
  });

  it("names none that has applied, was cancelled, or does not exist", () => {
    expect(mirroredElection(route({}), 100)).toBeNull();
    expect(mirroredElection(route({ cancelled: true }), 99)).toBeNull();
    expect(mirroredElection(route(null), 0)).toBeNull();
    expect(mirroredElection(null, 0)).toBeNull();
  });
});

describe("OperatorReads", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** The page's store with the card's reads started and counted. */
  async function started(hidden = () => false) {
    const kit = await setup();
    const wallet = kit.store.liveWallet;
    const reads = wallet?.chainReads;
    if (wallet === null || reads === undefined) throw new Error("the mock wallet reads a chain");
    const counts = { operator: 0, candidates: 0, route: 0 };
    wallet.chainReads = { ...reads, operator: () => { counts.operator += 1; return reads.operator(); }, candidates: () => { counts.candidates += 1; return reads.candidates(); } };
    const routeRead = kit.node.client.stats.operator;
    kit.node.client.stats.operator = () => { counts.route += 1; return routeRead(); };
    const operators = new OperatorReads(kit.store);
    const stop = operators.start(hidden);
    await flush();
    return { ...kit, operators, stop, counts, wallet };
  }

  it("reads the node's route and the registry on open", async () => {
    const { operators, counts, stop } = await started();
    const { route, named, table } = operators.getSnapshot();
    expect([route.status, named.status, table.status]).toEqual(["ready", "ready", "ready"]);
    expect(named.value?.hostname).toBe("alpha.operators.example");
    expect(table.value?.candidates).toHaveLength(4);
    expect(counts).toEqual({ route: 1, operator: 1, candidates: 1 });
    stop();
  });

  it("keeps the page's pace: the route every 30 seconds, the registry only every five minutes", async () => {
    const { counts, stop } = await started();
    await vi.advanceTimersByTimeAsync(NODE_READ_MS);
    expect(counts).toEqual({ route: 2, operator: 1, candidates: 1 });
    await vi.advanceTimersByTimeAsync(FIVE_MINUTES - NODE_READ_MS);
    expect(counts).toEqual({ route: 11, operator: 2, candidates: 2 });
    stop();
  });

  it("reads nothing on its timer in a hidden tab", async () => {
    const { counts, stop } = await started(() => true);
    await vi.advanceTimersByTimeAsync(FIVE_MINUTES * 2);
    expect(counts).toEqual({ route: 1, operator: 1, candidates: 1 });
    stop();
  });

  it("does not ask again for a route the node answers 404 to, until it is reopened", async () => {
    const { operators, node, counts, stop } = await started();
    node.client.stats.operator = () => { counts.route += 1; return Promise.reject(new EngineError(404, "not found")); };
    await operators.refreshNode();
    expect(operators.getSnapshot().route.status).toBe("unavailable");
    const before = counts.route;
    await vi.advanceTimersByTimeAsync(NODE_READ_MS * 3);
    expect(counts.route).toBe(before);
    stop();
  });

  it("reads once for the wallet it opened with, once for a new wallet, and joins a read already running", async () => {
    const { operators, counts, stop, store, wallet } = await started();
    operators.walletChanged();
    await flush();
    expect(counts.operator).toBe(1);
    const running = operators.refreshChain();
    const joined = operators.refreshChain();
    expect(joined).toBe(running);
    await running;
    expect(counts.operator).toBe(2);
    store.liveWallet = { ...wallet };
    operators.walletChanged();
    await flush();
    expect(counts.operator).toBe(3);
    stop();
  });

  it("reads afresh for a wallet that arrives during another's read, and drops the other's figures", async () => {
    const { operators, store, wallet, counts, stop } = await started();
    const reads = wallet.chainReads as DeploymentReads;
    let release = () => {};
    wallet.chainReads = { ...reads, operator: () => new Promise((resolve) => { release = () => { void reads.operator().then(resolve); }; }) };
    const stuck = operators.refreshChain();
    await flush();
    const other = { ...wallet, address: "0x00000000000000000000000000000000000000bb", chainReads: reads };
    store.liveWallet = other;
    const fresh = operators.refreshChain();
    expect(fresh).not.toBe(stuck);
    expect(operators.getSnapshot().table.status).toBe("loading");
    release();
    await Promise.all([stuck, fresh]);
    await flush();
    expect(operators.getSnapshot().table.status).toBe("ready");
    expect(counts.candidates).toBe(2);
    stop();
  });

  it("while the node cannot be trusted, drops its figures and reads the registry alone, and reads the node at once when it can be again", async () => {
    const { operators, store, counts, stop } = await started();
    expect(operators.getSnapshot().route.status).toBe("ready");
    store.patch({ attestation: { kind: "unverified", reason: "gone" } });
    expect(operators.getSnapshot().route).toEqual({ status: "loading", value: null, message: null });
    await operators.refreshNode();
    await operators.refreshChain();
    expect(counts).toEqual({ route: 1, operator: 2, candidates: 2 });
    expect(operators.getSnapshot().table.status).toBe("ready");
    store.patch({ attestation: { kind: "mock" } });
    await flush();
    expect(counts.route).toBe(2);
    expect(operators.getSnapshot().route.status).toBe("ready");
    stop();
  });

  it("stops following the node's trust once closed", async () => {
    const { operators, store, counts, stop } = await started();
    stop();
    store.patch({ attestation: { kind: "unverified", reason: "gone" } });
    store.patch({ attestation: { kind: "mock" } });
    await flush();
    expect(counts.route).toBe(1);
    expect(operators.getSnapshot().route.status).toBe("loading");
  });

  it("reads again at once on an election event in the stream, and not on other events", async () => {
    const { node, counts, stop } = await started();
    node.client.state.emit({ type: "tick" }, [{ type: "operator_elected", epoch: 1, candidate: "0xb", admin_key: "0xk", effective_at: 1 }]);
    await flush();
    expect(counts).toEqual({ route: 2, operator: 2, candidates: 2 });
    node.client.state.emit({ type: "tick" }, [{ type: "market_opened", market: 1 }]);
    await flush();
    expect(counts).toEqual({ route: 2, operator: 2, candidates: 2 });
    stop();
  });

  it("keeps the last answer and says why when a chain read fails", async () => {
    const { operators, wallet, stop } = await started();
    const reads = wallet.chainReads as DeploymentReads;
    const held = operators.getSnapshot().table.value;
    wallet.chainReads = { ...reads, operator: () => Promise.reject(new Error("no answer")), candidates: () => Promise.reject(new Error("still no answer")) };
    await operators.refreshChain();
    expect(operators.getSnapshot().named).toMatchObject({ status: "failed", message: "no answer" });
    expect(operators.getSnapshot().table).toEqual({ status: "failed", value: held, message: "still no answer" });
    stop();
  });

  it("has nothing to read with no wallet, and a new wallet's reads replace it", async () => {
    const { operators, store, stop } = await started();
    disconnectWallet(store);
    await operators.refreshChain();
    expect(operators.getSnapshot().named.status).toBe("unavailable");
    await connectWallet(store, "browser");
    await operators.refreshChain();
    expect(operators.getSnapshot().named.status).toBe("ready");
    stop();
  });

  it("drops an answer that lands after the card closed, and forgets what it read", async () => {
    const { operators, wallet, stop } = await started();
    const reads = wallet.chainReads as DeploymentReads;
    let release = () => {};
    wallet.chainReads = { ...reads, operator: () => new Promise((resolve) => { release = () => { void reads.operator().then(resolve); }; }) };
    const read = operators.refreshChain();
    await flush();
    stop();
    release();
    await read;
    expect(operators.getSnapshot().named.status).toBe("loading");
  });

  it("delegates through the staking wallet, and reads the votes and the choice again", async () => {
    const { operators, panel, store, stop } = await started();
    const staked = panel.getSnapshot().wallet.position.value?.staked ?? 0n;
    expect(staked).toBeGreaterThan(0n);
    const before = operators.getSnapshot().table.value?.candidates[0];
    if (before === undefined) throw new Error("the mock lists its candidates");
    expect(await delegateStake(panel, operators, before.address, "alpha")).toBe(true);
    await flush();
    expect(operators.getSnapshot().table.value?.candidates[0]?.votes).toBe(before.votes + staked);
    expect(operators.getSnapshot().chosen).toEqual({ status: "ready", value: before.address, message: null });
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("Your stake votes for alpha from the next close.");
    expect(await delegateStake(panel, operators, NO_CANDIDATE, "")).toBe(true);
    await flush();
    expect(operators.getSnapshot().chosen.value).toBeNull();
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("Your stake abstains from now on.");
    stop();
  });

  it("delegates nothing for a read-only account", async () => {
    const { operators, panel, store, stop } = await started();
    const wallet = store.liveWallet;
    if (wallet === null) throw new Error("the kit connects a wallet");
    wallet.readOnly = true;
    expect(await delegateStake(panel, operators, NO_CANDIDATE, "")).toBe(false);
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("This wallet cannot send transactions.");
    stop();
  });
});
