/** Tests for the operator card's reads and what they let the page show. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EngineError } from "../engine/client";
import { CANDIDATE_LIMIT } from "../engine/staking-reads";
import type { OperatorList } from "../engine/staking-reads";
import type { OperatorRoute } from "../engine/stats-types";
import { DelegationReads } from "../staking/delegation-reads";
import { changeDelegation } from "./actions";
import { hostnameListed, shownHostname } from "../staking/hostnames";
import { mirroredElection, OperatorReads, operatorsShown } from "./operators";
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

describe("operatorsShown", () => {
  it("shows the card with the figures once the node is trusted, and alone once it has failed a check or gone stale, never before the first verdict", () => {
    expect(operatorsShown({ kind: "checking" }, "connecting")).toBe(false);
    expect(operatorsShown({ kind: "mock" }, "connecting")).toBe(false);
    expect(operatorsShown({ kind: "reverifying" }, "live")).toBe(false);
    expect(operatorsShown({ kind: "mock" }, "live")).toBe(true);
    expect(operatorsShown({ kind: "unverified", reason: "the quote did not verify" }, "connecting")).toBe(true);
    expect(operatorsShown({ kind: "clock", skewMs: 90_000 }, "live")).toBe(true);
    expect(operatorsShown({ kind: "mock" }, "stale")).toBe(true);
  });

  it("keeps the card once shown, through a re-verification or a feed reconnecting (monkey-trading/console#302)", () => {
    expect(operatorsShown({ kind: "reverifying" }, "live", true)).toBe(true);
    expect(operatorsShown({ kind: "mock" }, "connecting", true)).toBe(true);
  });
});

describe("OperatorReads", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** The page's store with the card's reads started and counted. */
  async function started(hidden = () => false) {
    const kit = await setup();
    const counts = { route: 0, list: 0 };
    const routeRead = kit.node.client.stats.operator;
    const listRead = kit.node.client.stats.operators;
    kit.node.client.stats.operator = () => { counts.route += 1; return routeRead(); };
    kit.node.client.stats.operators = () => { counts.list += 1; return listRead(); };
    const operators = new OperatorReads(kit.store);
    const stop = operators.start(hidden);
    await flush();
    return { ...kit, operators, stop, counts, listRead };
  }

  it("reads the node's route and its signed operator list on open, never the wallet", async () => {
    const kit = await setup();
    const reads = kit.store.liveWallet?.chainReads;
    if (kit.store.liveWallet === null || reads === undefined) throw new Error("the mock wallet reads a chain");
    const chain = { vault: 0, operator: 0 };
    kit.store.liveWallet.chainReads = { vault: () => { chain.vault += 1; return reads.vault(); }, operator: () => { chain.operator += 1; return reads.operator(); } };
    const operators = new OperatorReads(kit.store);
    const stop = operators.start(() => false);
    await flush();
    const { route, list } = operators.getSnapshot();
    expect([route.status, list.status]).toEqual(["ready", "ready"]);
    expect(list.value?.rows).toHaveLength(CANDIDATE_LIMIT);
    expect(list.value?.block.number).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(NODE_READ_MS * 2);
    expect(chain).toEqual({ vault: 0, operator: 0 });
    stop();
  });

  it("keeps the page's pace, both every 30 seconds, and reads nothing on its timer in a hidden tab", async () => {
    const { counts, stop } = await started();
    await vi.advanceTimersByTimeAsync(FIVE_MINUTES);
    expect(counts).toEqual({ route: 11, list: 11 });
    stop();
    const hidden = await started(() => true);
    await vi.advanceTimersByTimeAsync(FIVE_MINUTES);
    expect(hidden.counts).toEqual({ route: 1, list: 1 });
    hidden.stop();
  });

  it("does not ask again for a route or a list the node answers 404 to, until it is reopened", async () => {
    const { operators, node, counts, stop } = await started();
    node.client.stats.operator = () => { counts.route += 1; return Promise.reject(new EngineError(404, "not found")); };
    node.client.stats.operators = () => { counts.list += 1; return Promise.reject(new EngineError(404, "not found")); };
    await operators.refresh();
    expect([operators.getSnapshot().route.status, operators.getSnapshot().list.status]).toEqual(["unavailable", "unavailable"]);
    await vi.advanceTimersByTimeAsync(NODE_READ_MS * 3);
    expect(counts).toEqual({ route: 2, list: 2 });
    stop();
  });

  it("keeps the last list and says why when the node has no fresh one, or answers one that does not hold together", async () => {
    const { operators, node, stop, listRead } = await started();
    const held = operators.getSnapshot().list.value;
    node.client.stats.operators = () => Promise.reject(new EngineError(503, "the operator list is stale: the last read is too old"));
    await operators.refresh();
    expect(operators.getSnapshot().list).toEqual({ status: "failed", value: held, message: "the operator list is stale: the last read is too old" });
    node.client.stats.operators = async (): Promise<OperatorList> => ({ ...(await listRead()), total_staked: "lots" });
    await operators.refresh();
    expect(operators.getSnapshot().list).toMatchObject({ status: "failed", value: held, message: "The operator list named a total stake that is not a whole amount." });
    stop();
  });

  it("while the node cannot be trusted, drops its figures and reads nothing, and reads at once when it can be again", async () => {
    const { operators, store, counts, stop } = await started();
    const held = operators.getSnapshot().list.value;
    store.patch({ attestation: { kind: "unverified", reason: "gone" } });
    expect(operators.getSnapshot()).toMatchObject({ route: { status: "loading", value: null, message: null }, list: { status: "loading", value: null, message: null }, held: { view: held } });
    await vi.advanceTimersByTimeAsync(NODE_READ_MS * 2);
    expect(counts).toEqual({ route: 1, list: 1 });
    store.patch({ attestation: { kind: "mock" } });
    await flush();
    expect(counts).toEqual({ route: 2, list: 2 });
    expect(operators.getSnapshot().list.status).toBe("ready");
    stop();
  });

  it("drops an answer that lands after trust in the node ended, and an older answer that lands after a newer one", async () => {
    const { operators, store, node, stop } = await started();
    const answers: ((route: OperatorRoute) => void)[] = [];
    const route = (operator: string): OperatorRoute => ({ operator, pending_rotation: null, rotation_enabled: true, last_election: null });
    node.client.stats.operator = () => new Promise((resolve) => { answers.push(resolve); });
    const older = operators.refresh();
    const newer = operators.refresh();
    answers[1]?.(route("0xnewer"));
    await newer;
    answers[0]?.(route("0xolder"));
    await older;
    expect(operators.getSnapshot().route.value?.operator).toBe("0xnewer");
    const pending = operators.refresh();
    store.patch({ attestation: { kind: "unverified", reason: "gone" } });
    answers[2]?.(route("0xretired"));
    await pending;
    expect(operators.getSnapshot().route).toEqual({ status: "loading", value: null, message: null });
    stop();
  });

  it("stops following the node's trust once closed, drops an answer that lands after it closed, and keeps the last list for a tab switch back", async () => {
    const { operators, store, node, counts, stop } = await started();
    let release = () => {};
    const real = node.client.stats.operators;
    node.client.stats.operators = () => new Promise((resolve) => { release = () => { void real().then(resolve); }; });
    const read = operators.refresh();
    stop();
    release();
    await read;
    store.patch({ attestation: { kind: "unverified", reason: "gone" } });
    store.patch({ attestation: { kind: "mock" } });
    await flush();
    expect(counts.route).toBe(2);
    // What was read stays, so a tab switch back shows the last list while a read begun at the restart refreshes it.
    const held = operators.getSnapshot().list.value;
    expect(held?.rows).toHaveLength(CANDIDATE_LIMIT);
    const restart = operators.start(() => false);
    await flush();
    expect(counts.route).toBe(3);
    expect(operators.getSnapshot().list.value).not.toBeNull();
    restart();
  });

  it("reads again at once on an election or rotation event in the stream, and not on other events", async () => {
    const { node, counts, stop } = await started();
    node.client.state.emit({ type: "tick" }, [{ type: "operator_elected", epoch: 1, candidate: "0xb", admin_key: "0xk", effective_at: 1 }]);
    await flush();
    expect(counts).toEqual({ route: 2, list: 2 });
    node.client.state.emit({ type: "tick" }, [{ type: "market_opened", market: 1 }]);
    await flush();
    expect(counts).toEqual({ route: 2, list: 2 });
    stop();
  });

  it("reads the list again after a delegation change, which shows the new votes", async () => {
    const { operators, node, panel, counts, stop, store } = await started();
    const alpha = node.client.state.operators.candidates[0];
    if (alpha === undefined) throw new Error("the mock lists its candidates");
    const before = operators.getSnapshot().list.value?.rows.find((row) => row.address === alpha.address)?.votes ?? 0n;
    expect(await changeDelegation(panel, operators, new DelegationReads(store), { kind: "delegate", to: alpha.address, toLabel: "alpha", amount: 1n })).toBe(true);
    expect(counts.list).toBe(2);
    expect(operators.getSnapshot().list.value?.rows.find((row) => row.address === alpha.address)?.votes).toBe(before + 1n);
    stop();
  });
});
