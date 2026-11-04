/** Tests for the Staking page's delegation changes through the connected wallet (monkey-trading/console#279): delegate, move and take back amounts, against the mock node. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MONKEY_UNIT } from "../format";
import { DEMO_ADDRESS } from "../mock/demo";
import { DelegationReads } from "../staking/delegation-reads";
import { changeDelegation, changeText, startUnstake, stakeMonkey } from "./actions";
import { OperatorReads } from "./operators";
import { flush, setup } from "./panel-kit";

/** The page's reads over the mock: the operator list and the chain's delegations, both started. */
async function started() {
  const kit = await setup();
  const operators = new OperatorReads(kit.store);
  const delegations = new DelegationReads(kit.store);
  const stops = [operators.start(() => false), delegations.start(() => false)];
  await flush();
  return { ...kit, operators, delegations, stopReads: () => stops.forEach((stop) => stop()) };
}

const UNVERIFIED = { kind: "unverified", reason: "the node's quote did not verify" } as const;

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());

describe("delegation changes", () => {
  it("delegate, move and take back amounts under a verdict that would refuse a signature, as they use nothing from the node", async () => {
    const { node, store, panel, stop } = await setup();
    store.patch({ attestation: { kind: "attested", release: "r", address: DEMO_ADDRESS, why: "Your wallet did not answer." } });
    const [first, second] = node.client.state.operators.candidates;
    if (first === undefined || second === undefined) throw new Error("the mock lists fewer than two candidates");
    const operators = new OperatorReads(store);
    const reads = new DelegationReads(store);
    expect(await stakeMonkey(panel, 3n * MONKEY_UNIT)).toBe(true);
    expect(await changeDelegation(panel, operators, reads, { kind: "delegate", to: first.address, toLabel: "first", amount: 2n * MONKEY_UNIT })).toBe(true);
    expect(await changeDelegation(panel, operators, reads, { kind: "redelegate", from: first.address, fromLabel: "first", to: second.address, toLabel: "second", amount: MONKEY_UNIT })).toBe(true);
    expect(await changeDelegation(panel, operators, reads, { kind: "undelegate", from: second.address, fromLabel: "second", amount: MONKEY_UNIT })).toBe(true);
    expect(node.client.state.operators.delegations.get(DEMO_ADDRESS.toLowerCase())).toEqual([{ candidate: first.address, amount: MONKEY_UNIT }]);
    expect(await startUnstake(panel, MONKEY_UNIT)).toBe(true);
    stop();
  });

  it("says at the control why a delegation change was refused, and settles busy", async () => {
    const { node, store, panel, stop } = await setup();
    const [first] = node.client.state.operators.candidates;
    if (first === undefined) throw new Error("the mock lists no candidate");
    const held = node.client.state.monkey.staked.get(DEMO_ADDRESS.toLowerCase()) ?? 0n;
    expect(await changeDelegation(panel, new OperatorReads(store), new DelegationReads(store), { kind: "delegate", to: first.address, toLabel: "first", amount: held + MONKEY_UNIT })).toBe(false);
    expect(store.getSnapshot().notices.operator?.text).toBe("Your undelegated stake is less than that.");
    expect(store.getSnapshot().busy).toBe(false);
    stop();
  });

  it("while the node is unverified, keeps the last list verified with when, reads the delegations from the chain, and delegates to a candidate from that list", async () => {
    vi.setSystemTime(1_793_000_000_000);
    const { node, store, panel, operators, delegations, stopReads } = await started();
    const verifiedAt = operators.getSnapshot().held?.verifiedAtMs;
    expect(verifiedAt).toBe(1_793_000_000_000);
    store.patch({ attestation: UNVERIFIED });
    expect(operators.getSnapshot()).toMatchObject({ list: { status: "loading", value: null }, held: { verifiedAtMs: verifiedAt } });
    const bravo = operators.getSnapshot().held?.view.rows.find((row) => row.hostname === "bravo.operators.example");
    if (bravo === undefined) throw new Error("the held list names bravo");
    const before = delegations.getSnapshot().read.value?.delegated ?? 0n;
    expect(await changeDelegation(panel, operators, delegations, { kind: "delegate", to: bravo.address, toLabel: "bravo", amount: MONKEY_UNIT })).toBe(true);
    expect(delegations.getSnapshot().read).toMatchObject({ status: "ready", value: { delegated: before + MONKEY_UNIT } });
    expect(node.client.state.operators.delegations.get(DEMO_ADDRESS.toLowerCase())?.some((d) => d.candidate === bravo.address)).toBe(true);
    stopReads();
  });

  it("while the node is unverified with no list held, delegates to a typed address, which only the chain checks, and takes it back", async () => {
    const { store, panel, operators, delegations, stopReads } = await setup().then(async (kit) => {
      kit.store.patch({ attestation: UNVERIFIED });
      const operatorReads = new OperatorReads(kit.store);
      const delegationReads = new DelegationReads(kit.store);
      const stops = [operatorReads.start(() => false), delegationReads.start(() => false)];
      await flush();
      return { ...kit, operators: operatorReads, delegations: delegationReads, stopReads: () => stops.forEach((stop) => stop()) };
    });
    expect(operators.getSnapshot().held).toBeNull();
    expect(delegations.getSnapshot().read.status).toBe("ready");
    const typed = "0x00000000000000000000000000000000000000fe";
    expect(await changeDelegation(panel, operators, delegations, { kind: "delegate", to: typed, toLabel: typed, amount: MONKEY_UNIT })).toBe(true);
    expect(delegations.getSnapshot().read.value?.delegations).toContainEqual({ candidate: typed, amount: MONKEY_UNIT });
    expect(await changeDelegation(panel, operators, delegations, { kind: "undelegate", from: typed, fromLabel: typed, amount: MONKEY_UNIT })).toBe(true);
    expect(delegations.getSnapshot().read.value?.delegations.some((d) => d.candidate === typed)).toBe(false);
    expect(store.getSnapshot().attestation.kind).toBe("unverified");
    stopReads();
  });

  it("tells the wallet prompt what each change does", () => {
    const amount = 1_234n * MONKEY_UNIT;
    expect(changeText({ kind: "delegate", to: "0xa", toLabel: "alpha.example", amount })).toBe("delegate 1,234 MONKEY to alpha.example");
    expect(changeText({ kind: "undelegate", from: "0xa", fromLabel: "alpha.example", amount })).toBe("take back 1,234 MONKEY from alpha.example");
    expect(changeText({ kind: "redelegate", from: "0xa", fromLabel: "alpha.example", to: "0xb", toLabel: "bravo.example", amount })).toBe("move 1,234 MONKEY from alpha.example to bravo.example");
  });
});
