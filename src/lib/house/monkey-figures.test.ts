/** The House page's MONKEY card rows (monkey-trading/console#269). */

import { describe, expect, it } from "vitest";

import { formatUsdc } from "../chart-format";
import type { MonkeyView } from "../engine/stats-types";
import { formatMonkey } from "../format";
import { monkeyFigureRows } from "./monkey-figures";

const UNIT = 10n ** 18n;

const viewWith = (over: Partial<NonNullable<MonkeyView["emissions"]>> = {}, staked = 2n * UNIT, distributed = "3000"): MonkeyView => ({
  seq: 1,
  time_ms: 0,
  begins_ms: null,
  begins_seq: null,
  from_genesis: true,
  emissions: { start_ms: 0, period_ms: 600_000, period_budget: "1", halving_periods: 1, period: 7, current_budget: "1", next_halving_ms: null, max_supply: "1", allocated: (5n * UNIT).toString(), cancelled: "0", ...over },
  staking: { total_staked: staked.toString(), stakers: 1, cooldown_ms: 1 },
  distribution: { start_ms: 0, epoch_ms: 1, liquidity_floor: "0", nav: "0", excess_usd: null, excess_seq: null, epoch: 3, last_closed_epoch: 2, last_closed_ms: 1, next_close_ms: 2, distributed_usdc_units: distributed, last_distribution: null },
});

describe("monkeyFigureRows", () => {
  it("labels the emissions row Emitted and reads the cumulative entitlement, not the token's supply", () => {
    const rows = monkeyFigureRows(viewWith());
    expect(rows.map((row) => row.label)).toEqual(["Emitted", "Staked", "USDC distributed"]);
    expect(rows[0]?.value).toBe(formatMonkey(5n * UNIT));
    expect(rows[0]?.tip).toContain("minted only when claimed");
  });

  it("reads the stake and reward totals from their own fields", () => {
    const rows = monkeyFigureRows(viewWith({}, 7n * UNIT, "42"));
    expect(rows[1]?.value).toBe(formatMonkey(7n * UNIT));
    expect(rows[2]?.value).toBe(formatUsdc(42n));
  });

  it("shows the em dash for a group the node has not configured", () => {
    const view = viewWith();
    view.emissions = null;
    expect(monkeyFigureRows(view)[0]?.value).toBe("—");
    expect(monkeyFigureRows(null).map((row) => row.value)).toEqual(["—", "—", "—"]);
  });
});
