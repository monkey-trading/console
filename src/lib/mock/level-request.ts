/** The mock's `POST /v1/positions/levels`, as the engine's V79 sequences it (`Engine::set_position_levels`). */

import { EngineError, type ActionResult } from "../engine/client";
import type { EngineEvent, PositionLevelsRequest, Reject } from "../engine/types";
import { movedLevels, NO_LEVELS, noLevels } from "../levels";
import { slotRefusal, writeLevels } from "./level-state";
import { closingPrice, distanceRefusal, namedLevels } from "./levels";
import { checkAccess, identifySigner } from "./orders";
import type { AccountState, MockState } from "./state";

/**
 * Sets, moves or removes the levels of the account's position in one market: the position takes exactly
 * the levels the request names. Screened and signed as an order is.
 * Error cases:
 * - a region the node does not serve (403), no eligibility declaration (403), or a signature, expiry or nonce the request fails (401, 400, 409)
 */
export function setPositionLevels(state: MockState, req: PositionLevelsRequest): ActionResult {
  checkAccess(state);
  const account = state.account(req.account);
  if (account.eligibility === null) throw new EngineError(403, "eligibility attestation required", { kind: "access", reason: "eligibility_required" });
  identifySigner(state, req.account, account, req.auth);
  const events = levelEvents(state, req, account);
  return { seq: state.emit({ type: "access_set_position_levels" }, events).seq, events };
}

/**
 * The request's event, or its refusal as a lone `order_rejected` with `client_id` 0: an unknown market,
 * a level out of range, no position, a level set anew or moved short of the minimum distance beyond the
 * position's closing price, or a first level with no working order slot free.
 */
function levelEvents(state: MockState, req: PositionLevelsRequest, account: AccountState): EngineEvent[] {
  const reject = (reason: Reject): EngineEvent[] => [{ type: "order_rejected", account: req.account, client_id: 0, reason }];
  if (!state.markets.has(req.market)) return reject({ kind: "unknown_market" });
  const named = namedLevels(req);
  if (named.kind === "invalid") return reject({ kind: "invalid_order", reason: "level out of range" });
  const levels = named.kind === "levels" ? named.levels : NO_LEVELS;
  const position = account.positions.get(req.market);
  if (position === undefined) return reject({ kind: "invalid_order", reason: "no position to set levels on" });
  const held = account.levels.get(req.market) ?? NO_LEVELS;
  const moved = movedLevels(levels, held);
  if (!noLevels(moved)) {
    // Measured from the whole position's closing price now, or at the last mark while the market is shut.
    const reference = closingPrice(state, req.account, req.market, position.qty);
    if (reference === null) return reject({ kind: "invalid_order", reason: "no price to measure levels from" });
    const refused = distanceRefusal(state, req.market, moved, position.qty > 0n, reference);
    if (refused !== null) return reject(refused);
  }
  const slot = noLevels(held) && !noLevels(levels) ? slotRefusal(state, account) : null;
  return slot !== null ? reject(slot) : [writeLevels(account, req.account, req.market, levels)];
}
