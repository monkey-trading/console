/** Tests for the demo account's backstory. */

import { describe, expect, it } from "vitest";

import { fixedToNumber, parseFixed } from "../fixed";
import { DEMO_ADDRESS } from "./demo";
import { createMockNode, SIM_EPOCH_MS } from "./index";

describe("the demo account", () => {
  const node = createMockNode(SIM_EPOCH_MS, true);

  it("ends with positions both ways across markets, resting orders, and a request waiting in the queue", async () => {
    const view = await node.client.account(DEMO_ADDRESS);
    const sides = Object.values(view.positions).map((p) => (parseFixed(p.qty) ?? 0n) > 0n);
    expect(Object.keys(view.positions).length).toBeGreaterThanOrEqual(4);
    expect(sides).toContain(true);
    expect(sides).toContain(false);
    expect(Object.keys(view.orders)).toHaveLength(3);
    expect((await node.client.withdrawalQueue(DEMO_ADDRESS)).queue).toHaveLength(1);
    expect(node.client.state.now).toBe(SIM_EPOCH_MS);
  });

  it("leaves winners and losers, and an account close to but not past its close-out threshold", async () => {
    const view = await node.client.account(DEMO_ADDRESS);
    const equity = parseFixed(view.equity) ?? 0n;
    const margin = parseFixed(view.margin) ?? 0n;
    const ratio = fixedToNumber(equity) / fixedToNumber(margin);
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(0.8);
    const markets = await node.client.markets();
    const pnl = Object.entries(view.positions).map(([id, p]) => {
      const mark = parseFixed(markets.find((m) => m.id === Number(id))?.mark ?? "0") ?? 0n;
      return (parseFixed(p.qty) ?? 0n) * (mark - (parseFixed(p.entry) ?? 0n));
    });
    expect(pnl.some((v) => v > 0n)).toBe(true);
    expect(pnl.some((v) => v < 0n)).toBe(true);
  });

  it("has a history with fills, deposits, a close-out, financing and a queued withdrawal", async () => {
    const kinds = new Set<string>();
    let before: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = await node.client.history(DEMO_ADDRESS, { limit: 200, before });
      for (const item of result.events) kinds.add(item.type);
      if (!result.next) break;
      before = result.next;
    }
    for (const kind of ["fill", "deposited", "close_out", "financing", "withdrawal_queued", "eligibility_attested"]) expect(kinds).toContain(kind);
  });

  it("is deterministic and can be reset to an empty account", async () => {
    const again = createMockNode(SIM_EPOCH_MS, true);
    expect(await again.client.account(DEMO_ADDRESS)).toEqual(await node.client.account(DEMO_ADDRESS));
    again.controls.resetAccount(DEMO_ADDRESS);
    await expect(again.client.account(DEMO_ADDRESS)).rejects.toMatchObject({ status: 404 });
    expect((await again.client.withdrawalQueue(DEMO_ADDRESS)).queue).toEqual([]);
  });
});
