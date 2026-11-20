/** The group credit against the engine's own worked examples (`portfolio-vectors.json`), each from the engine test it names. */

import { describe, expect, it } from "vitest";

import { fixedFromWire, fixedToWire } from "./fixed";
import { closeoutShareOf, groupCredit, type CreditLeg } from "./portfolio-credit";
import vectors from "./portfolio-vectors.json";

/** A vector's leg in the module's terms. */
function leg(wire: (typeof vectors.vectors)[number]["legs"][number]): CreditLeg {
  return {
    qty: fixedFromWire(wire.qty), price: fixedFromWire(wire.price), loading: fixedFromWire(wire.loading), bands: fixedFromWire(wire.bands),
    notional: fixedFromWire(wire.notional), residualShockBps: wire.residual_shock_bps, ceilingBps: wire.ceiling_bps,
  };
}

describe("groupCredit", () => {
  it.each(vectors.vectors.map((vector) => [vector.name, vector] as const))("gives the engine's figures: %s", (_, vector) => {
    const credit = groupCredit(vector.legs.map(leg), vector.floor_share_bps, vector.level_bps);
    const perPosition = vector.per_position === undefined ? null : fixedFromWire(vector.per_position);
    const requirement = perPosition === null ? null : perPosition - credit.offset;
    const maintenance = requirement === null ? null : closeoutShareOf(requirement, vector.level_bps);
    const computed: Record<string, string> = {
      net_notional: fixedToWire(credit.netNotional), matched_notional: fixedToWire(credit.matchedNotional), worst_loss: fixedToWire(credit.worstLoss),
      binding_direction: credit.bindingDirection, offset: fixedToWire(credit.offset),
      ...(requirement === null ? {} : { requirement: fixedToWire(requirement) }), ...(maintenance === null ? {} : { maintenance_margin: fixedToWire(maintenance) }),
    };
    const asserted = Object.fromEntries(Object.keys(vector.expected).map((key) => [key, computed[key]]));
    expect(asserted).toEqual(vector.expected);
  });

  it("names a net long as binding down, and every exposure on one side as matching nothing", () => {
    const btc: CreditLeg = { qty: 10n * 10n ** 9n, price: 100_000n * 10n ** 9n, loading: 10n ** 9n, bands: 10_000n * 10n ** 9n, notional: 10n ** 15n, residualShockBps: 20, ceilingBps: 30 };
    expect(groupCredit([btc], 5_000, 5_000)).toEqual({ netNotional: 10n ** 15n, matchedNotional: 0n, worstLoss: 0n, bindingDirection: "down", offset: 0n });
    expect(groupCredit([], 5_000, 5_000)).toEqual({ netNotional: 0n, matchedNotional: 0n, worstLoss: 0n, bindingDirection: "either", offset: 0n });
  });
});
