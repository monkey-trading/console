/** Tests for the Staking page's delegation changes through the connected wallet (monkey-trading/console#279): delegate, move and take back amounts, against the mock node. */

import { describe, expect, it } from "vitest";

import { MONKEY_UNIT } from "../format";
import { DEMO_ADDRESS } from "../mock/demo";
import { changeDelegation, changeText, startUnstake, stakeMonkey } from "./actions";
import { OperatorReads } from "./operators";
import { setup } from "./panel-kit";

describe("delegation changes", () => {
  it("delegate, move and take back amounts under a verdict that would refuse a signature, as they use nothing from the node", async () => {
    const { node, store, panel, stop } = await setup();
    store.patch({ attestation: { kind: "attested", release: "r", address: DEMO_ADDRESS, why: "Your wallet did not answer." } });
    const [first, second] = node.client.state.operators.candidates;
    if (first === undefined || second === undefined) throw new Error("the mock lists fewer than two candidates");
    const operators = new OperatorReads(store);
    expect(await stakeMonkey(panel, 3n * MONKEY_UNIT)).toBe(true);
    expect(await changeDelegation(panel, operators, { kind: "delegate", to: first.address, toLabel: "first", amount: 2n * MONKEY_UNIT })).toBe(true);
    expect(await changeDelegation(panel, operators, { kind: "redelegate", from: first.address, fromLabel: "first", to: second.address, toLabel: "second", amount: MONKEY_UNIT })).toBe(true);
    expect(await changeDelegation(panel, operators, { kind: "undelegate", from: second.address, fromLabel: "second", amount: MONKEY_UNIT })).toBe(true);
    expect(node.client.state.operators.delegations.get(DEMO_ADDRESS.toLowerCase())).toEqual([{ candidate: first.address, amount: MONKEY_UNIT }]);
    expect(await startUnstake(panel, MONKEY_UNIT)).toBe(true);
    stop();
  });

  it("says at the control why a delegation change was refused, and settles busy", async () => {
    const { node, store, panel, stop } = await setup();
    const [first] = node.client.state.operators.candidates;
    if (first === undefined) throw new Error("the mock lists no candidate");
    const held = node.client.state.monkey.staked.get(DEMO_ADDRESS.toLowerCase()) ?? 0n;
    expect(await changeDelegation(panel, new OperatorReads(store), { kind: "delegate", to: first.address, toLabel: "first", amount: held + MONKEY_UNIT })).toBe(false);
    expect(store.getSnapshot().notices.operator?.text).toBe("Your undelegated stake is less than that.");
    expect(store.getSnapshot().busy).toBe(false);
    stop();
  });

  it("tells the wallet prompt what each change does", () => {
    const amount = 1_234n * MONKEY_UNIT;
    expect(changeText({ kind: "delegate", to: "0xa", toLabel: "alpha.example", amount })).toBe("delegate 1,234 MONKEY to alpha.example");
    expect(changeText({ kind: "undelegate", from: "0xa", fromLabel: "alpha.example", amount })).toBe("take back 1,234 MONKEY from alpha.example");
    expect(changeText({ kind: "redelegate", from: "0xa", fromLabel: "alpha.example", to: "0xb", toLabel: "bravo.example", amount })).toBe("move 1,234 MONKEY from alpha.example to bravo.example");
  });
});
