/**
 * The mock node's `GET /v1/accounts/{address}/preview` (V84): what a market order of an exact size would do now, from the same
 * pricing and checks a fill runs, as the engine's `Quoter::preview` and `margin_after` give it (`crates/core/src/execution/quote.rs`,
 * `risk.rs`).
 */

import { EngineError } from "../engine/client";
import type { OrderPreviewRequest, OrderPreviewWire } from "../engine/portfolio-types";
import type { Reject } from "../engine/types";
import { fixedToWire, parseFixed, type Fixed } from "../fixed";
import { closeoutRequirementOf, equityOf, initialMarginOf, marginFloorOf } from "./accounts";
import { bookAfter, checkFill, type FillPlan } from "./execute";
import { MAX_INPUT } from "./orders";
import { closeoutShare, requirementOf } from "./portfolio";
import type { MockState } from "./state";

type Standing = Pick<OrderPreviewWire, "equity" | "initial_margin" | "maintenance_margin">;

/**
 * The order's verdict, priced as an ordinary market order with no slippage bound, which a reducing fill that raises the initial
 * requirement is checked as (D7). A refusal of the order or its pricing leaves no fill and the account as it is; a refusal for
 * margin or the house's capacity keeps the fill and what it would leave.
 * Error cases:
 * - an account the node has never credited (404)
 * - a quantity that is not a decimal (400)
 */
export async function previewOrder(state: MockState, request: OrderPreviewRequest): Promise<OrderPreviewWire> {
  const address = request.account.toLowerCase();
  if (!state.credited.has(address)) throw new EngineError(404, "not found");
  const qty = parseFixed(request.qty);
  if (qty === null) throw new EngineError(400, "qty is not a decimal");
  const base = { seq: state.seq, account: request.account, market: request.market, side: request.side, qty: request.qty, reduce_only: request.reduceOnly };
  const now = (refused: Reject): OrderPreviewWire => ({ ...base, fill: null, ...standingNow(state, address), refused });
  if (qty <= 0n || qty > MAX_INPUT) return now({ kind: "invalid_amount" });
  const checked = checkFill(state, { address, market: request.market, side: request.side, qty, reduceOnly: request.reduceOnly, orderId: 0, closeChecked: true });
  const filled = (plan: FillPlan, refused: Reject | null): OrderPreviewWire => ({
    ...base,
    fill: { qty: fixedToWire(plan.req.qty), price: fixedToWire(plan.priced.price), mid: fixedToWire(plan.mid), spread_bps: Number((plan.priced.spread * 10_000n) / plan.mid), increases: plan.priced.increases },
    ...standingAfter(state, plan),
    refused,
  });
  if (!checked.ok) return checked.plan === null ? now(checked.reject) : filled(checked.plan, checked.reject);
  return filled(checked.plan, null);
}

/** The account's equity and requirements now. */
function standingNow(state: MockState, address: string): Standing {
  const account = state.account(address);
  return wire(equityOf(state, account), initialMarginOf(state, account), closeoutShare(state, closeoutRequirementOf(state, account)));
}

/** What the plan's fill leaves the account at; a fill that leaves it flat with a negative balance leaves it at none, which the house writes off. */
function standingAfter(state: MockState, plan: FillPlan): Standing {
  const after = bookAfter(state, plan);
  const floorBps = marginFloorOf(state, state.account(plan.req.address));
  const market = requirementOf(state, after, { kind: "market" });
  const equity = after.positions.size === 0 && market.equity < 0n ? 0n : market.equity;
  return wire(equity, requirementOf(state, after, { kind: "initial", floorBps, shutCredited: false }).requirement, closeoutShare(state, market.requirement));
}

/** Figures as the route serializes them. */
function wire(equity: Fixed, initial: Fixed, maintenance: Fixed): Standing {
  return { equity: fixedToWire(equity), initial_margin: fixedToWire(initial), maintenance_margin: fixedToWire(maintenance) };
}
