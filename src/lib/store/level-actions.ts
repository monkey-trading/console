/** Setting, moving or removing a position's take profit and stop loss (engine V79): one session-signed request, never a wallet prompt while the browser holds a key. */

import { EngineError } from "../engine/client";
import { positionLevelsTypedData } from "../engine/eip712";
import type { LevelKind } from "../engine/level-types";
import type { MarketId } from "../engine/types";
import { fixedFromWire } from "../fixed";
import { describeLevelSlotReject, describeNamedLevels } from "../level-words";
import { levelsWire, type Levels } from "../levels";
import { describeReject } from "../messages";
import { sessionSigned } from "./session-signed";
import { domainOf } from "./signing";
import type { NoticeSurface } from "./state";
import type { ConsoleStore } from "./store";

/** What a levels request came to: whether the node took the levels, and which of them a refusal of a level too close to its price named. */
export interface LevelsAnswer {
  saved: boolean;
  refused: LevelKind | null;
}

/**
 * Sets the position in `market` to exactly `levels`, removing a level it leaves out. A refusal says why on
 * `surface`, the editor's own. The position row shows the levels the next read brings, so a success says
 * nothing. A request is idempotent, so a lost nonce signs again.
 */
export async function setPositionLevels(store: ConsoleStore, market: MarketId, levels: Levels, surface: NoticeSurface = "levels"): Promise<LevelsAnswer> {
  const listed = store.getSnapshot().markets.find((m) => m.id === market);
  const symbol = listed?.symbol ?? `market ${market}`;
  const wire = levelsWire(levels);
  const named = describeNamedLevels(levels, listed?.places ?? 2);
  const summary = named === null ? `remove the take profit and stop loss from your ${symbol} position` : `set ${named} on your ${symbol} position`;
  // The account the request went out for: its refusal is matched against it, whichever wallet is connected when the answer lands.
  let sentFor: string | null = null;
  const out = await sessionSigned(store, surface, summary, (t, account) => positionLevelsTypedData(domainOf(store), { account, market, ...wire }, t), async (auth, wallet) => {
    sentFor = wallet.address.toLowerCase();
    try {
      return await store.deps.client.setPositionLevels({ account: wallet.address, market, ...wire, auth });
    } catch (error) {
      // A node that predates the route answers 404, and nothing was sequenced or spent a nonce.
      if (error instanceof EngineError && error.status === 404) throw new EngineError(404, "This server does not support take-profit and stop-loss levels yet.", null, { cause: error });
      throw error;
    }
  }, "sign-again");
  if (!out.ok) return { saved: false, refused: null };
  // The answer can carry other accounts' events of the same moment: the refusal is the sending account's, with `client_id` 0.
  const refused = out.result.events.find((e) => e.type === "order_rejected" && e.client_id === 0 && e.account.toLowerCase() === sentFor);
  if (refused?.type === "order_rejected") {
    const { reason } = refused;
    store.notify(surface, reason.kind === "tier_order_limit" || reason.kind === "too_many_orders" ? describeLevelSlotReject(reason) : describeReject(reason));
  }
  await store.refresh(true);
  if (refused?.type !== "order_rejected") return { saved: true, refused: null };
  if (refused.reason.kind !== "level_too_close") return { saved: false, refused: null };
  const level = fixedFromWire(refused.reason.level);
  return { saved: false, refused: level === levels.takeProfit ? "take_profit" : level === levels.stopLoss ? "stop_loss" : null };
}
