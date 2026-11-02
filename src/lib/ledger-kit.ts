/** Tests only: history entries and pages for the P&L ledger. */

import type { HistoryEvent, HistoryPage, StreamMessage } from "./engine/types";
import { fixedToWire } from "./fixed";
import { MONKEY_UNIT } from "./format";

export const ME = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
/** Periods of ten minutes from time zero, as the mock serves them. */
export const SCHEDULE = { startMs: 0, periodMs: 600_000, period: 5 } as const;
export const MIN = 60_000;
/** Whole MONKEY in base units. */
export const monkey = (whole: bigint) => whole * MONKEY_UNIT;

/** A fill at `<seq>:<index>` stamped `ts` realising `pnl` (Fixed, nine places), selling to close a long unless `side` says otherwise. */
export function fill(cursor: string, ts: number, pnl: bigint, extra: { fee?: bigint; side?: "buy" | "sell"; liquidation?: boolean; qty?: string; price?: string; position?: string } = {}): HistoryEvent {
  return {
    type: "fill", cursor, ts, account: ME, order_id: 1, market: 1, side: extra.side ?? "sell", qty: extra.qty ?? "1", price: extra.price ?? "100", index: "100", spread_bps: 5,
    realised_pnl: fixedToWire(pnl), profit_fee: fixedToWire(extra.fee ?? 0n), position: extra.position ?? "0", liquidation: extra.liquidation ?? false,
  };
}

export function lieu(cursor: string, ts: number, amount: bigint): HistoryEvent {
  return { type: "corporate_cash_in_lieu", cursor, ts, id: "split-1", market: 1, account: ME, amount: fixedToWire(amount) };
}

export function allocated(cursor: string, ts: number, period: number, amount: bigint): HistoryEvent {
  return { type: "emission_allocated", cursor, ts, account: ME, period, weight: "1", amount: amount.toString() };
}

/** A page of newest-first events with the cursor of the next older page, or none when `next` is null. */
export const page = (events: HistoryEvent[], next: string | null = null): HistoryPage => ({ events, next });

/** A stream message at `seq` stamped `ts` carrying `events` (as the node sequences them). */
export function message(seq: number, ts: number, events: StreamMessage["events"]): StreamMessage {
  return { offset: `${seq}:0`, type: "command", seq, ts, cmd: { type: "tick" }, events };
}
