/** Tests for the account notice a stream message raises: a close-out, a level that closed a position, or orders the node cancelled. */

import { describe, expect, it } from "vitest";

import type { EngineEvent, StreamMessage } from "../engine/types";
import { accountNotice } from "./account-notice";

const ME = "0xAbC0000000000000000000000000000000000001";
const OTHER = "0x0000000000000000000000000000000000000002";
const message = (events: EngineEvent[]): StreamMessage => ({ offset: "9:0", type: "command", seq: 9, ts: 0, cmd: { type: "tick" }, events });
const symbolOf = (id: number) => (id === 1 ? "BTC-USD" : "ETH-USD");
const say = (events: EngineEvent[]) => accountNotice(message(events), ME, null, symbolOf)?.text ?? null;
const tone = (events: EngineEvent[]) => accountNotice(message(events), ME, null, symbolOf)?.tone;

const triggered = (account: string, market: number, level: "take_profit" | "stop_loss", order_id: number): EngineEvent => ({ type: "position_level_triggered", account, market, level, price: level === "take_profit" ? "105000" : "95000", order_id });
const fill = (account: string, order_id: number, price: string): EngineEvent => ({ type: "fill", account, order_id, market: 1, side: "sell", qty: "1", price, index: price, spread_bps: 0, realised_pnl: "0", profit_fee: "0", position: "0", liquidation: false });

describe("accountNotice", () => {
  it("names the level that closed the viewer's position and the price of the fill that closed it", () => {
    expect(say([triggered(ME.toLowerCase(), 1, "stop_loss", 7), fill(ME.toLowerCase(), 7, "94980.5")])).toBe("Your stop loss at 95,000 on BTC-USD was reached, so the entire position was closed at 94,980.5. The details are shown in History.");
  });

  it("names every level that fired in one message, and none of another account's", () => {
    const events = [triggered(ME, 1, "take_profit", 7), fill(ME, 7, "105010"), triggered(OTHER, 1, "stop_loss", 8), triggered(ME, 2, "stop_loss", 9)];
    expect(say(events)).toBe("Your take profit at 105,000 on BTC-USD was reached, so the entire position was closed at 105,010. Your stop loss at 95,000 on ETH-USD was reached, so the entire position was closed. The details are shown in History.");
    expect(say([triggered(OTHER, 1, "stop_loss", 8)])).toBeNull();
  });

  it("puts a close-out first, then a level, then orders the node cancelled", () => {
    const closeOut: EngineEvent = { type: "close_out", account: ME, equity: "1", margin: "10" };
    const cancelled: EngineEvent = { type: "order_cancelled", account: ME, order_id: 4, reason: "unfillable" };
    expect(say([triggered(ME, 1, "stop_loss", 7), closeOut])).toMatch(/^Your positions were closed out/);
    expect(say([cancelled, triggered(ME, 1, "stop_loss", 7)])).toMatch(/^Your stop loss at 95,000/);
    expect(say([cancelled])).toBe("Order 4 could not be filled, so it has been cancelled.");
  });

  it("tells a level's close as a status, and a close-out or a cancelled order as a failure", () => {
    expect([tone([triggered(ME, 1, "stop_loss", 7)]), tone([{ type: "close_out", account: ME, equity: "1", margin: "10" }]), tone([{ type: "order_cancelled", account: ME, order_id: 4, reason: "unfillable" }])]).toEqual(["info", "error", "error"]);
  });
});
