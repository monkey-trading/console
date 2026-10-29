/** Tests for the liquidation estimate. */

import { describe, expect, it } from "vitest";

import { fixedFromInt } from "./fixed";
import { liquidationPrice } from "./liquidation";
import { decodeMarket, type AccountModel } from "./models";
import { createMockNode } from "./mock";

const START = Date.UTC(2026, 9, 28, 15, 0, 0);

async function markets() {
  const node = createMockNode(START);
  return (await node.client.markets()).map((v) => decodeMarket(v, undefined, true));
}

const account = (balance: number, margin: number, qty: bigint, entry: number): AccountModel => ({
  balance: fixedFromInt(balance), unfinalised: 0n, equity: fixedFromInt(balance), margin: fixedFromInt(margin),
  positions: [{ market: 1, qty, entry: fixedFromInt(entry) }], orders: [],
});

describe("liquidationPrice", () => {
  it("sits below a long's entry by what equity can lose above the threshold", async () => {
    const all = await markets();
    const btc = all.find((m) => m.id === 1);
    if (!btc) throw new Error("BTC-USD is listed");
    // Balance 1,000, margin 400 (threshold 200): 800 of loss on one unit leaves a price 800 under entry.
    expect(liquidationPrice(account(1_000, 400, fixedFromInt(1), 60_000), btc, all)).toBe(fixedFromInt(59_200));
  });

  it("sits above a short's entry, and there is none without a position", async () => {
    const all = await markets();
    const btc = all.find((m) => m.id === 1);
    if (!btc) throw new Error("BTC-USD is listed");
    expect(liquidationPrice(account(1_000, 400, fixedFromInt(-1), 60_000), btc, all)).toBe(fixedFromInt(60_800));
    expect(liquidationPrice({ ...account(1_000, 0, 0n, 0), positions: [] }, btc, all)).toBeNull();
  });

  it("counts the other positions' profit and loss, and has no price at or below zero", async () => {
    const all = await markets();
    const btc = all.find((m) => m.id === 1);
    const eth = all.find((m) => m.id === 2);
    if (!btc || !eth) throw new Error("BTC-USD and ETH-USD are listed");
    const ethMark = eth.mark ?? 0n;
    const withOther = { ...account(1_000, 400, fixedFromInt(1), 60_000), positions: [{ market: 1, qty: fixedFromInt(1), entry: fixedFromInt(60_000) }, { market: 2, qty: fixedFromInt(1), entry: ethMark + fixedFromInt(100) }] };
    // ETH is 100 under its entry, so BTC has 100 less to lose before the threshold.
    expect(liquidationPrice(withOther, btc, all)).toBe(fixedFromInt(59_300));
    expect(liquidationPrice(account(1_000_000, 400, fixedFromInt(1), 1_000), btc, all)).toBeNull();
  });
});
