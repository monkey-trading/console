/** Tests for the chart's close-out marker. */

import { describe, expect, it } from "vitest";

import { fixedFromInt } from "./fixed";
import { closeOutMarker } from "./liquidation";
import { decodeMarket, type AccountModel, type CloseoutModel } from "./models";
import { createMockNode } from "./mock";

const START = Date.UTC(2026, 9, 28, 15, 0, 0);

async function btcMarket() {
  const node = createMockNode(START);
  const views = await node.client.markets();
  const view = views.find((m) => m.id === 1);
  if (!view) throw new Error("BTC-USD is listed");
  return decodeMarket(view, undefined, true);
}

const held = (closeout: CloseoutModel | null): AccountModel => ({
  balance: fixedFromInt(1_000), unfinalised: 0n, equity: fixedFromInt(1_000), margin: fixedFromInt(400),
  positions: [{ market: 1, qty: fixedFromInt(1), entry: fixedFromInt(60_000), closeout }], orders: [],
});

describe("closeOutMarker", () => {
  it("draws the position's close-out price for the in-browser node and none for a live one", async () => {
    const btc = await btcMarket();
    const at = held({ reach: "at", price: fixedFromInt(58_000) });
    expect(closeOutMarker("none", at, btc)).toBe(fixedFromInt(58_000));
    expect(closeOutMarker("checked", at, btc)).toBeNull();
  });

  it("draws nothing for Due, None, an unknown close-out or no position", async () => {
    const btc = await btcMarket();
    expect(closeOutMarker("none", held({ reach: "due" }), btc)).toBeNull();
    expect(closeOutMarker("none", held({ reach: "beyond" }), btc)).toBeNull();
    expect(closeOutMarker("none", held(null), btc)).toBeNull();
    expect(closeOutMarker("none", { ...held(null), positions: [] }, btc)).toBeNull();
  });
});
