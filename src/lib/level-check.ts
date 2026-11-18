/**
 * What the deal ticket and the position editor check of a take profit and stop loss before anything is
 * signed, as the engine's V79 checks them once the request reaches it (`levels/request.rs`): each level
 * a valid price, each one set anew or moved at least the market's minimum distance beyond its reference
 * on its own side, a first pair of levels on a position with a working order slot free, and, on the
 * ticket, an order that leaves a position on its side for them to protect. With each, what the level
 * would realise before the profit fee.
 */

import type { LevelKind, Side } from "./engine/types";
import { absFixed, minFixed, type Fixed } from "./fixed";
import { describeLevelRefusal, EDITOR_LEVELS_NOTE, levelSlotProblem, REDUCING_ORDER_LEVELS, TICKET_LEVELS_NOTES, type EstimateBasis, type LevelBasis } from "./level-words";
import { checkLevel, levelOf, minLevelDistance, movedLevels, NO_LEVELS, noLevels, parseLevel, resultAtLevel, type LevelInput, type Levels } from "./levels";
import type { MarketModel } from "./models";
import type { TicketLimits } from "./tier-view";

/** The text typed in the two fields. */
export interface LevelFields {
  takeProfit: string;
  stopLoss: string;
}

export const EMPTY_FIELDS: LevelFields = { takeProfit: "", stopLoss: "" };

/** What the checks found. */
export interface LevelCheck {
  /** Each field's problem, shown under it; null while it has none. */
  problems: Record<LevelKind, string | null>;
  /** A problem with the levels together: an order that leaves nothing for them to protect, no working order slot free, or no price to measure them from. */
  general: string | null;
  /** What each level would realise before the profit fee, in USD; null with no level or no price to estimate from. */
  estimates: Record<LevelKind, Fixed | null>;
  /** What the estimates cover: the size the order opens, or the whole position. */
  estimatedOn: EstimateBasis;
  /** The levels to send, as typed. */
  named: Levels;
  /** What the levels do to the position the order leaves, by what the order does to the position held; null with none held. */
  note: string | null;
  /** Whether anything above stops the request being signed. */
  blocked: boolean;
}

const KINDS: readonly LevelKind[] = ["take_profit", "stop_loss"];

/** The two fields read, each as typed. */
function readFields(fields: LevelFields): Record<LevelKind, LevelInput> {
  return { take_profit: parseLevel(fields.takeProfit, "take profit"), stop_loss: parseLevel(fields.stopLoss, "stop loss") };
}

/** What the inputs, the reference and the estimate's terms say, for either surface. */
interface Draft {
  market: MarketModel;
  minBps: number;
  inputs: Record<LevelKind, LevelInput>;
  long: boolean;
  /** The levels the engine measures: those set anew or moved. */
  measured: Levels;
  reference: Fixed | null;
  basis: LevelBasis;
  /** Where the closing price may be capped nearer the mark: the mark, which a take profit is measured from instead. */
  capped: Fixed | null;
  general: string | null;
  note: string | null;
  estimatedOn: EstimateBasis;
  /** The estimate's entry and size; null with nothing to estimate from. */
  entry: Fixed | null;
  size: Fixed;
  toUsdDown: ((amount: Fixed) => Fixed) | null;
}

/** The levels the inputs name, a refused input read as none. */
function namedOf(inputs: Record<LevelKind, LevelInput>): Levels {
  const level = (input: LevelInput) => (input.kind === "level" ? input.level : null);
  return { takeProfit: level(inputs.take_profit), stopLoss: level(inputs.stop_loss) };
}

function checked(draft: Draft): LevelCheck {
  const named = namedOf(draft.inputs);
  const problems: Record<LevelKind, string | null> = { take_profit: null, stop_loss: null };
  const estimates: Record<LevelKind, Fixed | null> = { take_profit: null, stop_loss: null };
  for (const kind of KINDS) {
    const input = draft.inputs[kind];
    if (input.kind === "refused") problems[kind] = input.message;
    const measured = levelOf(draft.measured, kind);
    // A cap can only bring the closing price nearer the mark, which leaves a stop loss measured from the uncapped price on the safe side and a take profit not.
    const fromMark = kind === "take_profit" && draft.capped !== null;
    const reference = fromMark ? draft.capped : draft.reference;
    const refusal = measured === null || reference === null ? null : checkLevel(kind, measured, draft.long, reference, draft.minBps);
    if (refusal !== null) problems[kind] = describeLevelRefusal(refusal, draft.long, draft.market.places, fromMark ? "mark" : draft.basis);
    const level = levelOf(named, kind);
    if (level !== null && draft.entry !== null && draft.toUsdDown !== null && draft.size > 0n) estimates[kind] = resultAtLevel(draft.long, draft.entry, draft.size, level, draft.toUsdDown);
  }
  const blocked = draft.general !== null || KINDS.some((kind) => problems[kind] !== null);
  return { problems, general: draft.general, estimates, estimatedOn: draft.estimatedOn, named, blocked, note: draft.note };
}

/** What the deal ticket holds of an order. */
export interface TicketLevelsInput {
  market: MarketModel;
  side: Side;
  qty: Fixed;
  /** A limit or stop order, whose levels wait with it and are measured from its own price. */
  resting: boolean;
  /** A working order's trigger price, or the price a market order is sent at: the estimate's entry. */
  price: Fixed | null;
  /** The account's signed position in the market now, and its levels. */
  held: Fixed;
  heldLevels: Levels;
  /** A market order's reference: what closing the whole position it leaves would fill at; null for a working order or with no price. */
  closing: Fixed | null;
  /** The mark, where that closing price may be capped nearer it (`closingExact`); null where it is the engine's. */
  capped: Fixed | null;
  limits: TicketLimits | null;
  fields: LevelFields;
  toUsdDown: ((amount: Fixed) => Fixed) | null;
}

/** The ticket's levels, or null for a market that takes none. With both fields empty nothing is checked. */
export function checkTicketLevels(input: TicketLevelsInput): LevelCheck | null {
  const minBps = minLevelDistance(input.market.view);
  if (minBps === null) return null;
  const inputs = readFields(input.fields);
  const named = namedOf(inputs);
  const base = { market: input.market, minBps, inputs, entry: input.price, toUsdDown: input.toUsdDown, capped: null, estimatedOn: "order" as const };
  const buy = input.side === "buy";
  // Whether the position held is on the other side and at least the order's size: the order then only reduces it.
  const reduces = input.held !== 0n && (input.held > 0n) !== buy && absFixed(input.held) >= input.qty;
  if (input.resting) {
    // A working order's levels are all measured from its own price when it is placed, and attach when it fills.
    const note = input.held === 0n ? null : reduces ? TICKET_LEVELS_NOTES.restsReducing : TICKET_LEVELS_NOTES.rests;
    return checked({ ...base, long: buy, measured: named, reference: input.price, basis: "trigger", general: null, note, size: input.qty });
  }
  const left = input.held + (buy ? input.qty : -input.qty);
  const none = noLevels(named);
  // An empty size leaves the order's shape to the size field's own prompt.
  if (input.qty === 0n) return checked({ ...base, long: buy, measured: NO_LEVELS, reference: null, basis: "closing", general: null, note: null, size: 0n });
  if (!none && reduces) {
    return checked({ ...base, long: buy, measured: NO_LEVELS, reference: null, basis: "closing", general: REDUCING_ORDER_LEVELS, note: null, size: 0n });
  }
  const note = input.held === 0n || reduces ? null : (input.held > 0n) === (left > 0n) ? TICKET_LEVELS_NOTES.adds : TICKET_LEVELS_NOTES.reverses;
  // An add keeps the position's levels, so a level it names unchanged is not measured again; a new position or a reversal takes only the order's.
  const added = input.held !== 0n && (input.held > 0n) === (left > 0n);
  const measured = movedLevels(named, added ? input.heldLevels : NO_LEVELS);
  // A position holding no levels in this market needs a working order slot for its first pair.
  const general = none ? null : levelSlotProblem(input.limits, noLevels(input.heldLevels));
  return checked({ ...base, long: left > 0n, measured, reference: input.closing, capped: input.capped, basis: "closing", general, note, size: minFixed(input.qty, absFixed(left)) });
}

/** What the position editor holds. */
export interface EditorLevelsInput {
  market: MarketModel;
  /** The position's signed size, its entry and its levels. */
  qty: Fixed;
  entry: Fixed;
  held: Levels;
  /** What closing the whole position fills at now, which new or moved levels are measured from; null with no price, with `noClosing` saying why. */
  closing: Fixed | null;
  noClosing: string;
  /** The mark, where that closing price is the console's own and may be capped nearer it; null where it is the engine's. */
  capped: Fixed | null;
  limits: TicketLimits | null;
  fields: LevelFields;
  toUsdDown: ((amount: Fixed) => Fixed) | null;
}

/** The editor's check, and whether the fields change the position's levels: saving is offered only for a change nothing stops. */
export function checkEditorLevels(input: EditorLevelsInput): LevelCheck & { changed: boolean } {
  const minBps = minLevelDistance(input.market.view) ?? 0;
  const inputs = readFields(input.fields);
  const named = namedOf(inputs);
  const measured = movedLevels(named, input.held);
  const unmeasured = input.closing === null && !noLevels(measured) ? input.noClosing : null;
  const general = unmeasured ?? levelSlotProblem(input.limits, noLevels(input.held) && !noLevels(named));
  const check = checked({ market: input.market, minBps, inputs, long: input.qty > 0n, measured, reference: input.closing, capped: input.capped, basis: "closing", general, note: EDITOR_LEVELS_NOTE, estimatedOn: "position", entry: input.entry, size: absFixed(input.qty), toUsdDown: input.toUsdDown });
  const refused = KINDS.some((kind) => inputs[kind].kind === "refused");
  const changed = !refused && (named.takeProfit !== input.held.takeProfit || named.stopLoss !== input.held.stopLoss);
  return { ...check, changed };
}
