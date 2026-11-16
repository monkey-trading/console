import { describe, expect, it } from "vitest";

import { fixedFromInt } from "../fixed";
import { MONKEY_UNIT } from "../format";
import { commandDetails, commandTitle, failureLine, lifetimeText, limitDetails, limitTitle, listingsKey, listingsOf, standingText, tallyText, tiersText, walletLine, type InForce } from "./governance-words";

const BTC = { symbol: "BTC-USD", margin_tiers: [{ up_to: "1000000", bps: 100 }, { up_to: null, bps: 200 }], spread_tiers: [{ up_to: null, bps: 5 }], house_cap_bps: 3000, house_cap_floor: "2000000" };
const IN_FORCE: InForce = {
  params: { profitFeeBps: 1000, closeoutLevelBps: 5000, totalCapBps: 3000, totalCapFloor: fixedFromInt(50_000_000), stressLevels: [], profitFeeCurve: [], seq: 3 },
  market: (id) => (id === 1 ? BTC : null),
};
const NOTHING: InForce = { params: null, market: () => null };

describe("commandTitle", () => {
  it("names what each governed and fast-path command does, with the market by its symbol or its id", () => {
    expect(commandTitle({ action: "set_params" }, IN_FORCE)).toBe("New trading terms");
    expect(commandTitle({ action: "upsert_market", id: 1 }, IN_FORCE)).toBe("New terms for BTC-USD");
    expect(commandTitle({ action: "upsert_market", id: 9 }, IN_FORCE)).toBe("New terms for market 9");
    expect(commandTitle({ action: "set_toxicity_notional" }, IN_FORCE)).toBe("How trade size counts towards the extra spread");
    expect(commandTitle({ action: "adopt_close_spread_ceiling", market: 1, max_close_spread_bps: 12 }, IN_FORCE)).toBe("A maximum closing spread of 12 bps for BTC-USD");
    expect(commandTitle({ action: "set_access_policy" }, IN_FORCE)).toBe("New access rules");
    expect(commandTitle({ action: "activate_protocol", version: "V57" }, IN_FORCE)).toBe("Activate a new version of the trading rules");
    expect(commandTitle({ action: "set_stress_floor", market: null, level: 2 }, IN_FORCE)).toBe("Keep every market at stress level 2 or higher");
    expect(commandTitle({ action: "set_reduce_only", market: 1, reduce_only: true }, IN_FORCE)).toBe("Only accept orders that reduce positions in BTC-USD");
    expect(commandTitle({ action: "set_reduce_only", market: null, reduce_only: false }, IN_FORCE)).toBe("Accept all orders in every market again");
    expect(commandTitle({ action: "rotate_operator" }, IN_FORCE)).toBe("A change that this page cannot describe. The full proposal shows its details.");
  });

  it("says bytes that are no command are refused if they pass", () => {
    expect(commandTitle(null, IN_FORCE)).toBe("An invalid proposal, which will be rejected even if it passes");
  });
});

describe("commandDetails", () => {
  it("lists the parameters a set_params changes beside those in force, and none it leaves alone", () => {
    const command = { action: "set_params", profit_fee_bps: 1000, closeout_level_bps: 5500, house_total_cap_bps: 2500, house_total_cap_floor: "40000000" };
    expect(commandDetails(command, IN_FORCE)).toEqual(["Close-out level 55.00% (now 50.00%)", "Total limit 25.00% (now 30.00%)", "Total limit minimum $40,000,000.00 (now $50,000,000.00)"]);
  });

  it("states the values alone when the parameters in force are not held, and a left-out floor as zero", () => {
    expect(commandDetails({ action: "set_params", profit_fee_bps: 1000, closeout_level_bps: 5000, house_total_cap_bps: 3000 }, NOTHING)).toEqual([
      "Profit fee 10.00%", "Close-out level 50.00%", "Total limit 30.00%", "Total limit minimum $0.00",
    ]);
  });

  it("lists a relisting's bands and caps that differ from the market in force", () => {
    const command = { action: "upsert_market", id: 1, margin_tiers: [{ up_to: "1000000", bps: 200 }, { up_to: null, bps: 500 }], spread_tiers: [{ up_to: null, bps: 5 }], house_cap_bps: 3000, house_cap_floor: "2000000" };
    expect(commandDetails(command, IN_FORCE)).toEqual(["Margin 2.00% up to $1,000,000.00, then 5.00% (now 1.00% up to $1,000,000.00, then 2.00%)"]);
    // From V52 a relisting names its spread bands in tenths of a bp, against bands in force however written.
    const tenths = { ...command, margin_tiers: BTC.margin_tiers, spread_tiers: [{ up_to: "1000000", tenth_bps: 4 }, { up_to: null, tenth_bps: 55 }] };
    expect(commandDetails(tenths, IN_FORCE)).toEqual(["Spread 0.4 bps up to $1,000,000.00, then 5.5 bps (now 5 bps)"]);
  });

  it("says when an adopted ceiling takes effect, in UTC, and nothing for bytes that are no command", () => {
    expect(commandDetails({ action: "adopt_close_spread_ceiling", market: 1, max_close_spread_bps: 12, effective_at: Date.UTC(2026, 10, 20, 9, 30) }, IN_FORCE)).toEqual(["In effect from 2026-11-20 09:30 UTC"]);
    expect(commandDetails({ action: "activate_protocol", version: "V57" }, IN_FORCE)).toEqual(["Trading rules version V57"]);
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
    expect(limitTitle({ kind: "stress_floor", market: 1, level: 3 }, IN_FORCE)).toBe("Keep BTC-USD at stress level 3 or higher");
    expect(limitTitle({ kind: "reduce_only", market: null }, IN_FORCE)).toBe("Only accept orders that reduce positions in every market");
    expect(limitTitle({ kind: "unknown", name: "spread_floor" }, IN_FORCE)).toBe("A limit that this page cannot describe.");
    expect(limitDetails({ kind: "unknown", name: "spread_floor" }, {})).toEqual([]);
  });

  it("states each bound beside the baseline it holds the value from, and only the bounds it carries", () => {
    expect(limitDetails({ kind: "params", closeout_level_bps: 5500, house_total_cap_floor: "40000000" }, baselines)).toEqual([
      "Close-out level at least 55.00% (normally 50.00%)", "Total limit minimum at most $40,000,000.00 (normally $50,000,000.00)",
    ]);
    expect(limitDetails({ kind: "market", market: 1, margin_tiers: [{ up_to: null, bps: 300 }], house_cap_bps: 2000 }, baselines)).toEqual([
      "Margin at least 3.00% (normally 1.00%)", "Market limit at most 20.00% (normally 30.00%)",
    ]);
    expect(limitDetails({ kind: "market", market: 2, house_cap_bps: 2000 }, baselines)).toEqual(["Market limit at most 20.00%"]);
    expect(limitDetails({ kind: "stress_floor", market: null, level: 1 }, baselines)).toEqual([]);
  });
});

describe("standingText", () => {
  it("says a member that has not voted may still vote on an open proposal and did not on a passed one", () => {
    expect(standingText("yes", true)).toBe("voted yes");
    expect(standingText("no", true)).toBe("has not voted yet");
    expect(standingText("no", false)).toBe("did not vote");
    expect(standingText("outside", false)).toBe("cannot vote on this proposal");
    expect(standingText("unknown", true)).toBe("loading…");
  });
});

describe("tallyText", () => {
  const units = (whole: bigint) => whole * MONKEY_UNIT;

  it("rounds the weight an open proposal still needs up to what the page shows, so it never reads short", () => {
    expect(tallyText({ yes: units(400_000n), total: units(1_000_000n) }, true)).toBe("Yes votes: 400,000 MONKEY of 1,000,000 MONKEY (40.00%). A further 266,666.67 MONKEY in yes votes would pass the proposal.");
    expect(tallyText({ yes: units(600n), total: units(900n) }, true)).toBe("Yes votes: 600 MONKEY of 900 MONKEY (66.66%). A further 0.01 MONKEY in yes votes would pass the proposal.");
  });

  it("says a passed proposal passed, and one that closed below two thirds fell short", () => {
    expect(tallyText({ yes: units(700n), total: units(900n) }, false)).toBe("Yes votes: 700 MONKEY of 900 MONKEY (77.77%), which is more than two thirds, so the proposal has passed.");
    expect(tallyText({ yes: units(600n), total: units(900n) }, false)).toBe("Yes votes: 600 MONKEY of 900 MONKEY (66.66%), which is less than two thirds, so the proposal did not pass.");
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

describe("walletLine and failureLine", () => {
  it("says why the members' votes are not shown by the kind of wallet, and nothing when they are", () => {
    expect(walletLine(null, false)).toBe("Connect a wallet to see how the operators you delegate to have voted, or to vote if you are one of them.");
    expect(walletLine({ readOnly: true }, false)).toBe("The votes of the operators you delegate to are not shown while you are viewing this account in read-only mode.");
    expect(walletLine({}, false)).toBe("This wallet cannot read on-chain data, so the votes of the operators you delegate to cannot be shown.");
    expect(walletLine({}, true)).toBeNull();
  });

  it("gives a failed read in one sentence, trimming the wallet's own full stop", () => {
    expect(failureLine("the votes", "Your wallet did not answer in time.")).toBe("The votes could not be loaded from your wallet. Your wallet did not answer in time. The app will try again shortly.");
    expect(failureLine("your delegations", null)).toBe("Your delegations could not be loaded from your wallet. The app will try again shortly.");
  });
});
