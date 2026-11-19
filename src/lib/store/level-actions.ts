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

/** Which of `levels` a refusal naming `level`, as the node writes it, concerns; none when it names neither. */
function refusedField(levels: Levels, level: string): LevelKind | undefined {
  const named = fixedFromWire(level);
  return named === levels.takeProfit ? "take_profit" : named === levels.stopLoss ? "stop_loss" : undefined;
}

/**
 * Sets the position in `market` to exactly `levels`, removing a level it leaves out. True when the node
 * took them; a refusal says why on `surface`, the dialog's own, naming the field a level too close concerns.
 * The position row shows the levels the next read brings, so a success says nothing. A request is
 * idempotent, so a lost nonce signs again.
 */
export async function setPositionLevels(store: ConsoleStore, market: MarketId, levels: Levels, surface: NoticeSurface = "levels"): Promise<boolean> {
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
  if (!out.ok) return false;
  // The answer can carry other accounts' events of the same moment: the refusal is the sending account's, with `client_id` 0.
  const refused = out.result.events.find((e) => e.type === "order_rejected" && e.client_id === 0 && e.account.toLowerCase() === sentFor);
  if (refused?.type === "order_rejected") {
    const { reason } = refused;
    store.notify(surface, reason.kind === "tier_order_limit" || reason.kind === "too_many_orders" ? describeLevelSlotReject(reason) : describeReject(reason), "error", reason.kind === "level_too_close" ? refusedField(levels, reason.level) : undefined);
  }
  await store.refresh(true);
  return refused === undefined;
}
