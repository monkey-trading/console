import { describe, expect, it } from "vitest";

import { fixedFromInt } from "../fixed";
import { MONKEY_UNIT } from "../format";
import { commandDetails, commandTitle, lifetimeText, limitDetails, limitTitle, listingsKey, listingsOf, standingText, tallyText, tiersText, type InForce } from "./governance-words";

const BTC = { symbol: "BTC-USD", margin_tiers: [{ up_to: "1000000", bps: 100 }, { up_to: null, bps: 200 }], spread_tiers: [{ up_to: null, bps: 5 }], house_cap_bps: 3000, house_cap_floor: "2000000" };
const IN_FORCE: InForce = {
  params: { profitFeeBps: 1000, closeoutLevelBps: 5000, totalCapBps: 3000, totalCapFloor: fixedFromInt(50_000_000), seq: 3 },
  market: (id) => (id === 1 ? BTC : null),
};
const NOTHING: InForce = { params: null, market: () => null };

describe("commandTitle", () => {
  it("names what each governed and fast-path command does, with the market by its symbol or its id", () => {
    expect(commandTitle({ action: "set_params" }, IN_FORCE)).toBe("New protocol parameters");
    expect(commandTitle({ action: "upsert_market", id: 1 }, IN_FORCE)).toBe("New listing terms for BTC-USD");
    expect(commandTitle({ action: "upsert_market", id: 9 }, IN_FORCE)).toBe("New listing terms for market 9");
    expect(commandTitle({ action: "set_toxicity_notional" }, IN_FORCE)).toBe("Toxicity weighting by notional");
    expect(commandTitle({ action: "adopt_close_spread_ceiling", market: 1, max_close_spread_bps: 12 }, IN_FORCE)).toBe("A close-spread ceiling of 12 bps for BTC-USD");
    expect(commandTitle({ action: "set_access_policy" }, IN_FORCE)).toBe("A new access policy");
    expect(commandTitle({ action: "activate_protocol", version: "V57" }, IN_FORCE)).toBe("Activate protocol V57");
    expect(commandTitle({ action: "set_stress_floor", market: null, level: 2 }, IN_FORCE)).toBe("A stress floor at level 2 in every market");
    expect(commandTitle({ action: "set_reduce_only", market: 1, reduce_only: true }, IN_FORCE)).toBe("Reduce-only in BTC-USD");
    expect(commandTitle({ action: "set_reduce_only", market: null, reduce_only: false }, IN_FORCE)).toBe("Lift reduce-only in every market");
    expect(commandTitle({ action: "rotate_operator" }, IN_FORCE)).toBe("The admin command rotate_operator");
  });

  it("says bytes that are no command are refused if they pass", () => {
    expect(commandTitle(null, IN_FORCE)).toBe("Bytes that are no admin command, which the engine refuses if the proposal passes");
  });
});

describe("commandDetails", () => {
  it("lists the parameters a set_params changes beside those in force, and none it leaves alone", () => {
    const command = { action: "set_params", profit_fee_bps: 1000, closeout_level_bps: 5500, house_total_cap_bps: 2500, house_total_cap_floor: "40000000" };
    expect(commandDetails(command, IN_FORCE)).toEqual(["Close-out level 55.00% (now 50.00%)", "House cap 25.00% (now 30.00%)", "House cap floor $40,000,000.00 (now $50,000,000.00)"]);
  });

  it("states the values alone when the parameters in force are not held, and a left-out floor as zero", () => {
    expect(commandDetails({ action: "set_params", profit_fee_bps: 1000, closeout_level_bps: 5000, house_total_cap_bps: 3000 }, NOTHING)).toEqual([
      "Profit fee 10.00%", "Close-out level 50.00%", "House cap 30.00%", "House cap floor $0.00",
    ]);
  });

  it("lists a relisting's bands and caps that differ from the market in force", () => {
    const command = { action: "upsert_market", id: 1, margin_tiers: [{ up_to: "1000000", bps: 200 }, { up_to: null, bps: 500 }], spread_tiers: [{ up_to: null, bps: 5 }], house_cap_bps: 3000, house_cap_floor: "2000000" };
    expect(commandDetails(command, IN_FORCE)).toEqual(["Margin 2.00% up to $1,000,000.00, then 5.00% (now 1.00% up to $1,000,000.00, then 2.00%)"]);
  });

  it("says when an adopted ceiling takes effect, in UTC, and nothing for bytes that are no command", () => {
    expect(commandDetails({ action: "adopt_close_spread_ceiling", market: 1, max_close_spread_bps: 12, effective_at: Date.UTC(2026, 10, 20, 9, 30) }, IN_FORCE)).toEqual(["In effect from 2026-11-20 09:30 UTC"]);
    expect(commandDetails(null, IN_FORCE)).toEqual([]);
  });
});

describe("tiersText", () => {
  it("reads each band's rate and bound in order, the last unbounded", () => {
    expect(tiersText([{ up_to: "250000", bps: 50 }, { up_to: "1000000", bps: 100 }, { up_to: null, bps: 250 }])).toBe("0.50% up to $250,000.00, then 1.00% up to $1,000,000.00, then 2.50%");
    expect(tiersText([{ up_to: null, bps: 100 }])).toBe("1.00%");
  });
});

describe("restrictions", () => {
  const baselines = {
    params_baseline: { closeout_level_bps: 5000, house_total_cap_bps: 3000, house_total_cap_floor: "50000000" },
    market_baselines: { "1": { margin_tiers: [{ up_to: null, bps: 100 }], house_cap_bps: 3000, house_cap_floor: "2000000" } },
  };

  it("titles each kind of restriction", () => {
    expect(limitTitle({ kind: "params", closeout_level_bps: 5500 }, IN_FORCE)).toBe("Tighter house limits");
    expect(limitTitle({ kind: "market", market: 1 }, IN_FORCE)).toBe("Tighter terms for BTC-USD");
    expect(limitTitle({ kind: "stress_floor", market: 1, level: 3 }, IN_FORCE)).toBe("A stress floor at level 3 in BTC-USD");
    expect(limitTitle({ kind: "reduce_only", market: null }, IN_FORCE)).toBe("Reduce-only in every market");
  });

  it("states each bound beside the baseline it holds the value from, and only the bounds it carries", () => {
    expect(limitDetails({ kind: "params", closeout_level_bps: 5500, house_total_cap_floor: "40000000" }, baselines)).toEqual([
      "Close-out level at least 55.00% (baseline 50.00%)", "House cap floor at most $40,000,000.00 (baseline $50,000,000.00)",
    ]);
    expect(limitDetails({ kind: "market", market: 1, margin_tiers: [{ up_to: null, bps: 300 }], house_cap_bps: 2000 }, baselines)).toEqual([
      "Margin at least 3.00% (baseline 1.00%)", "House cap at most 20.00% (baseline 30.00%)",
    ]);
    expect(limitDetails({ kind: "market", market: 2, house_cap_bps: 2000 }, baselines)).toEqual(["House cap at most 20.00%"]);
    expect(limitDetails({ kind: "stress_floor", market: null, level: 1 }, baselines)).toEqual([]);
  });
});

describe("standingText", () => {
  it("says a member that has not voted may still vote on an open proposal and did not on a passed one", () => {
    expect(standingText("yes", true)).toBe("voted yes");
    expect(standingText("no", true)).toBe("has not voted yet");
    expect(standingText("no", false)).toBe("did not vote");
    expect(standingText("outside", false)).toBe("is not in this proposal's set");
    expect(standingText("unknown", true)).toBe("reading…");
  });
});

describe("tallyText", () => {
  const units = (whole: bigint) => whole * MONKEY_UNIT;

  it("rounds the weight an open proposal still needs up to what the page shows, so it never reads short", () => {
    expect(tallyText({ yes: units(400_000n), total: units(1_000_000n) }, true)).toBe("Yes 400,000 MONKEY of 1,000,000 MONKEY (40.00%): 266,666.67 MONKEY more passes it.");
    expect(tallyText({ yes: units(600n), total: units(900n) }, true)).toBe("Yes 600 MONKEY of 900 MONKEY (66.66%): 0.01 MONKEY more passes it.");
  });

  it("says a passed proposal passed, and one that closed below two thirds fell short", () => {
    expect(tallyText({ yes: units(700n), total: units(900n) }, false)).toBe("Yes 700 MONKEY of 900 MONKEY (77.77%): more than two thirds, so it passed.");
    expect(tallyText({ yes: units(600n), total: units(900n) }, false)).toBe("Yes 600 MONKEY of 900 MONKEY (66.66%): short of two thirds.");
  });
});

describe("lifetimeText", () => {
  it("names days, hours and minutes, each only when there are any", () => {
    expect(lifetimeText(86_400_000)).toBe("1 day");
    expect(lifetimeText(2 * 86_400_000 + 4 * 3_600_000)).toBe("2 days 4 hours");
    expect(lifetimeText(90 * 60_000)).toBe("1 hour 30 minutes");
    expect(lifetimeText(180_000)).toBe("3 minutes");
    expect(lifetimeText(30_000)).toBe("under a minute");
  });
});

describe("listingsKey", () => {
  const market = (id: number, mark: string) => ({ id, view: { ...BTC, mark } });

  it("changes with a listing's terms and not with its price, and looks each market up by id", () => {
    expect(listingsKey([market(1, "100")])).toBe(listingsKey([market(1, "101")]));
    expect(listingsKey([market(1, "100")])).not.toBe(listingsKey([{ id: 1, view: { ...BTC, house_cap_bps: 2000 } }]));
    const lookup = listingsOf(listingsKey([market(1, "100")]));
    expect(lookup(1)).toEqual(BTC);
    expect(lookup(2)).toBeNull();
  });
});
