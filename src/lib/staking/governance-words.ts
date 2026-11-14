/**
 * What the Governance tab says of a proposal's admin command and of a fast-path restriction's limit
 * (`engine_core::command::AdminCommand`, `engine_core::governance::Limit`): a title, and the values
 * that change beside the ones in force where the page holds them. The full command is shown apart,
 * as the node signed it, so these words never stand in for it.
 */

import type { AdminCommandWire, GovernanceWire, LimitWire } from "../engine/governance-types";
import type { MarketView, Tier } from "../engine/types";
import { formatUsd, parseFixed } from "../fixed";
import { formatMonkey, formatRate, MONKEY_UNIT } from "../format";
import type { HouseParams } from "../house";
import { formatStampWithYear } from "../time";
import { passes, weightToPass, yesShareBps, type Tally } from "./governance";

/** What the page holds of the values in force: the parameters, and each listed market by id. */
export interface InForce {
  params: HouseParams | null;
  market: (id: number) => Pick<MarketView, "symbol" | "margin_tiers" | "spread_tiers" | "house_cap_bps" | "house_cap_floor"> | null;
}

const int = (value: unknown): number | null => (typeof value === "number" && Number.isSafeInteger(value) ? value : null);
const usd = (value: unknown): string | null => {
  const fixed = typeof value === "string" ? parseFixed(value) : null;
  return fixed === null ? null : formatUsd(fixed);
};
const isTiers = (value: unknown): value is Tier[] =>
  Array.isArray(value) && value.every((tier: unknown) => typeof tier === "object" && tier !== null && int((tier as Tier).bps) !== null);

/** A market by its symbol where the page lists it, else by its id. */
function marketName(market: unknown, inForce: InForce): string {
  const id = int(market);
  if (id === null) return "every market";
  return inForce.market(id)?.symbol ?? `market ${id}`;
}

/** A band table as "1.00% up to $1,000,000.00, then 2.00%". */
export function tiersText(tiers: readonly Tier[]): string {
  return tiers.map((tier, i) => {
    const bound = usd(tier.up_to);
    const rate = formatRate(tier.bps);
    if (bound !== null) return i === 0 ? `${rate} up to ${bound}` : `then ${rate} up to ${bound}`;
    return i === 0 ? rate : `then ${rate}`;
  }).join(", ");
}

/** "label value", with what is in force beside it when the page holds it and it differs; null for an unchanged value. */
function change(label: string, proposed: string | null, now: string | null): string | null {
  if (proposed === null || proposed === now) return null;
  return now === null ? `${label} ${proposed}` : `${label} ${proposed} (now ${now})`;
}

/** What `command` does, in one line. */
export function commandTitle(command: AdminCommandWire | null, inForce: InForce): string {
  if (command === null) return "Bytes that are no admin command, which the engine refuses if the proposal passes";
  switch (command.action) {
    case "set_params": return "New protocol parameters";
    case "upsert_market": return `New listing terms for ${marketName(command.id, inForce)}`;
    case "set_toxicity_notional": return "Toxicity weighting by notional";
    case "adopt_close_spread_ceiling": return `A close-spread ceiling of ${int(command.max_close_spread_bps) ?? "?"} bps for ${marketName(command.market, inForce)}`;
    case "set_access_policy": return "A new access policy";
    case "activate_protocol": return `Activate protocol ${typeof command.version === "string" ? command.version : "?"}`;
    case "set_stress_floor": return `A stress floor at level ${int(command.level) ?? "?"} in ${marketName(command.market, inForce)}`;
    case "set_reduce_only": return `${command.reduce_only === false ? "Lift reduce-only" : "Reduce-only"} in ${marketName(command.market, inForce)}`;
    default: return `The admin command ${command.action}`;
  }
}

/** The values `command` sets that the page can name, beside those in force where it holds them; the full command says the rest. */
export function commandDetails(command: AdminCommandWire | null, inForce: InForce): string[] {
  if (command === null) return [];
  const lines: (string | null)[] = [];
  if (command.action === "set_params") {
    const params = inForce.params;
    const rate = (value: unknown) => (int(value) === null ? null : formatRate(int(value) ?? 0));
    lines.push(
      change("Profit fee", rate(command.profit_fee_bps), params === null ? null : formatRate(params.profitFeeBps)),
      change("Close-out level", rate(command.closeout_level_bps), params === null ? null : formatRate(params.closeoutLevelBps)),
      change("House cap", rate(command.house_total_cap_bps), params === null ? null : formatRate(params.totalCapBps)),
      change("House cap floor", usd(command.house_total_cap_floor ?? "0"), params === null ? null : formatUsd(params.totalCapFloor)),
    );
  } else if (command.action === "upsert_market") {
    const market = int(command.id) === null ? null : inForce.market(int(command.id) ?? 0);
    const tiers = (value: unknown) => (isTiers(value) ? tiersText(value) : null);
    lines.push(
      change("Margin", tiers(command.margin_tiers), market === null ? null : tiersText(market.margin_tiers)),
      change("Spread", tiers(command.spread_tiers), market === null ? null : tiersText(market.spread_tiers)),
      change("House cap", int(command.house_cap_bps) === null ? null : formatRate(int(command.house_cap_bps) ?? 0), market === null ? null : formatRate(market.house_cap_bps)),
      change("House cap floor", usd(command.house_cap_floor ?? "0"), market === null ? null : usd(market.house_cap_floor ?? "0")),
    );
  } else if (command.action === "adopt_close_spread_ceiling" && int(command.effective_at) !== null) {
    lines.push(`In effect from ${formatStampWithYear(int(command.effective_at) ?? 0)} UTC`);
  }
  return lines.filter((line): line is string => line !== null);
}

/** What a restriction holds, in one line. */
export function limitTitle(limit: LimitWire, inForce: InForce): string {
  switch (limit.kind) {
    case "params": return "Tighter house limits";
    case "market": return `Tighter terms for ${marketName(limit.market, inForce)}`;
    case "stress_floor": return `A stress floor at level ${limit.level} in ${marketName(limit.market, inForce)}`;
    case "reduce_only": return `Reduce-only in ${marketName(limit.market, inForce)}`;
    default: {
      const never: never = limit;
      throw new Error(`Unknown restriction ${String(never)}.`);
    }
  }
}

/** Each bound a restriction holds, beside the baseline it sits over where the log keeps one. */
export function limitDetails(limit: LimitWire, baselines: Pick<GovernanceWire, "params_baseline" | "market_baselines">): string[] {
  const bound = (label: string, value: string | null, baseline: string | null) => (value === null ? null : baseline === null ? `${label} ${value}` : `${label} ${value} (baseline ${baseline})`);
  const rate = (bps: number | undefined) => (bps === undefined ? null : formatRate(bps));
  let lines: (string | null)[] = [];
  if (limit.kind === "params") {
    const base = baselines.params_baseline;
    lines = [
      bound("Close-out level at least", rate(limit.closeout_level_bps), base === undefined ? null : formatRate(base.closeout_level_bps)),
      bound("House cap at most", rate(limit.house_total_cap_bps), base === undefined ? null : formatRate(base.house_total_cap_bps)),
      bound("House cap floor at most", usd(limit.house_total_cap_floor), base === undefined ? null : usd(base.house_total_cap_floor)),
    ];
  } else if (limit.kind === "market") {
    const base = baselines.market_baselines?.[String(limit.market)];
    lines = [
      bound("Margin at least", limit.margin_tiers === undefined ? null : tiersText(limit.margin_tiers), base === undefined ? null : tiersText(base.margin_tiers)),
      bound("House cap at most", rate(limit.house_cap_bps), base === undefined ? null : formatRate(base.house_cap_bps)),
      bound("House cap floor at most", usd(limit.house_cap_floor), base === undefined ? null : usd(base.house_cap_floor)),
    ];
  }
  return lines.filter((line): line is string => line !== null);
}

/** How a member stands on a proposal, in words: an open proposal's member may still vote, a passed one's may not. */
export function standingText(standing: "yes" | "no" | "outside" | "unknown", open: boolean): string {
  switch (standing) {
    case "yes": return "voted yes";
    case "no": return open ? "has not voted yet" : "did not vote";
    case "outside": return "is not in this proposal's set";
    case "unknown": return "reading…";
    default: {
      const never: never = standing;
      throw new Error(`Unknown standing ${String(never)}.`);
    }
  }
}

/** The smallest MONKEY amount `formatMonkey` shows: two places. */
const CENT = MONKEY_UNIT / 100n;

/**
 * The tally in words: the yes weight of the set's, its share, and where it stands against two thirds.
 * A weight still needed is rounded up to what the page shows, so it never reads short of passing.
 */
export function tallyText(tally: Tally, open: boolean): string {
  const head = `Yes ${formatMonkey(tally.yes)} of ${formatMonkey(tally.total)} (${formatRate(yesShareBps(tally))})`;
  if (passes(tally)) return `${head}: more than two thirds, so it ${open ? "passes" : "passed"}.`;
  if (!open) return `${head}: short of two thirds.`;
  const needed = weightToPass(tally);
  return `${head}: ${formatMonkey(((needed + CENT - 1n) / CENT) * CENT)} more passes it.`;
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/** A lifetime in words, to the minute: "1 day", "2 days 4 hours", "90 minutes" reads "1 hour 30 minutes". */
export function lifetimeText(ms: number): string {
  const minutes = Math.floor(Math.max(ms, 0) / 60_000);
  const [days, hours, rest] = [Math.floor(minutes / 1440), Math.floor((minutes % 1440) / 60), minutes % 60];
  const parts = [days > 0 ? plural(days, "day") : null, hours > 0 ? plural(hours, "hour") : null, rest > 0 ? plural(rest, "minute") : null].filter((part) => part !== null);
  return parts.length === 0 ? "under a minute" : parts.join(" ");
}
