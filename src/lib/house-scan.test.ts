import { describe, expect, it } from "vitest";

import { decodeHouse } from "./models";

const base = { cash: "100", nav: "90", gross_exposure: "10" };

describe("decodeHouse's scan figures", () => {
  it("is null from a node that predates them, so the page falls back to what it has", () => {
    expect(decodeHouse(base).scan).toBeNull();
  });

  it("keeps a figure null until the node's first scan", () => {
    const { scan } = decodeHouse({ ...base, seq: null, snapshot_ms: null, open_interest: null, open_margin: null, open_positions: null, unrealised: "-10", volume: "0", volume_since_ms: 5, markets: [] });
    expect(scan).toMatchObject({ snapshotMs: null, openInterest: null, openPositions: null, unrealised: -10_000_000_000n, volumeSinceMs: 5, markets: [] });
  });

  it("decodes each market's long, short and net", () => {
    const { scan } = decodeHouse({
      ...base, snapshot_ms: 9, open_interest: "30", open_margin: "3", open_positions: 4, unrealised: "-10", volume: "7.5", volume_since_ms: 1,
      markets: [{ market: 1, symbol: "BTC-USD", mark: "100", long: "20", short: "10", net: "10", long_positions: 3, short_positions: 1, unrealised: "-2", volume: "7.5" }],
    });
    expect(scan?.openInterest).toBe(30_000_000_000n);
    expect(scan?.markets[0]).toMatchObject({ symbol: "BTC-USD", long: 20_000_000_000n, short: 10_000_000_000n, net: 10_000_000_000n, longPositions: 3, shortPositions: 1 });
  });

  it("refuses a malformed amount, which the engine never sends", () => {
    expect(() => decodeHouse({ ...base, unrealised: "x", volume: "0", volume_since_ms: 1, markets: [] })).toThrow("malformed decimal");
  });
});
