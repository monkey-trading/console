/**
 * The demo account's backstory, played through the node's own rules so every screen has data to read:
 * a first small account closed out, a fresh deposit, longs and shorts across markets (winners and
 * losers), overnight financing, a withdrawal waiting in the queue, resting orders, and an account
 * close to its close-out threshold. Deterministic: the same clock and seeds give the same history.
 */

import type { EngineEvent, Side } from "../engine/types";
import { fixedFromInt, fixedToWire, divFixed, SCALE, type Fixed } from "../fixed";
import { equityOf, marginOf } from "./accounts";
import { advance } from "./step";
import { mockHex } from "./client";
import { chainDeposit, withdraw, withdrawable } from "./funds";
import { liveQuote } from "./execute";
import { attestEligibility, placeOrder } from "./orders";
import type { MockState } from "./state";

/** The address the "Browser wallet" option connects, so the demo account is the one a user sees first. */
export const DEMO_ADDRESS = `0x${mockHex("account-browser", 20)}`;

const HOUR = 3_600_000;
const SIGNATURE = `0x${"ab".repeat(65)}`;
/** How long the backstory runs before the node's clock starts, in milliseconds. */
export const DEMO_SPAN_MS = 72 * HOUR;

const BTC = 1;
const ETH = 2;
const EUR = 3;
const US500 = 4;
const XAU = 5;

/** A tiny scripted client for the demo account. */
class Script {
  constructor(private readonly state: MockState) {}

  private auth() {
    return { nonce: this.state.account(DEMO_ADDRESS).nextNonce, expires_at: this.state.now + 60_000, signature: SIGNATURE };
  }

  /** Moves the clock to `ms`; the vault's liquidity stays as it is. */
  at(ms: number): void {
    advance(this.state, ms, { liquidity: false });
  }

  /** Runs the clock forward `seconds` in five-second steps. */
  wait(seconds: number): void {
    for (let i = 0; i < seconds / 5; i++) this.at(this.state.now + 5_000);
  }

  attest(): void {
    attestEligibility(this.state, { account: DEMO_ADDRESS, class: "professional", auth: this.auth() });
  }

  deposit(dollars: number): void {
    chainDeposit(this.state, DEMO_ADDRESS, fixedFromInt(dollars));
    this.wait(10);
  }

  /** A market order of `dollars` notional at the live quote. */
  trade(market: number, side: Side, dollars: number): EngineEvent[] {
    const mid = this.state.markets.get(market)?.mid ?? 1n;
    const qty = (divFixed(fixedFromInt(dollars), mid) / 1_000n) * 1_000n;
    const quote = liveQuote(this.state, DEMO_ADDRESS, market, side, qty);
    if (!quote) throw new Error("demo: no quote");
    return placeOrder(this.state, {
      account: DEMO_ADDRESS, client_id: this.state.seq, market, side, qty: fixedToWire(qty),
      kind: { kind: "market", quoted: fixedToWire(quote.price), max_slippage_bps: 50 }, auth: this.auth(),
    }).events;
  }

  /** A resting order `percent` away from the index. */
  rest(market: number, side: Side, kind: "limit" | "stop", dollars: number, percentFromIndex: number): void {
    const mid = this.state.markets.get(market)?.mid ?? 1n;
    const price = mid + (mid * BigInt(Math.round(percentFromIndex * 100))) / 10_000n;
    const qty = (divFixed(fixedFromInt(dollars), mid) / 1_000n) * 1_000n;
    placeOrder(this.state, {
      account: DEMO_ADDRESS, client_id: this.state.seq, market, side, qty: fixedToWire(qty),
      kind: { kind, price: fixedToWire(price) }, auth: this.auth(),
    });
  }

  /** Moves a market's index by `bps` at the next step, then lets one step pass. */
  shock(market: number, bps: number): void {
    const runtime = this.state.markets.get(market);
    if (runtime) runtime.shockBps += bps;
    this.at(this.state.now + 5_000);
  }

  withdraw(dollars: Fixed): void {
    withdraw(this.state, { account: DEMO_ADDRESS, amount: fixedToWire(dollars), auth: this.auth() });
  }

  /** Equity over margin, in basis points; null with no positions. */
  health(): number | null {
    const account = this.state.account(DEMO_ADDRESS);
    const margin = marginOf(this.state, account);
    return margin === 0n ? null : Number((equityOf(this.state, account) * 10_000n) / margin);
  }

  hasPositions(): boolean {
    return this.state.account(DEMO_ADDRESS).positions.size > 0;
  }

  withdrawable(): Fixed {
    return withdrawable(this.state, DEMO_ADDRESS);
  }
}

/**
 * Plays the backstory on a state whose clock starts `DEMO_SPAN_MS` before `endMs`, and leaves the
 * clock at `endMs`. The vault's queue already holds the other accounts' requests.
 */
export function seedDemoAccount(state: MockState, endMs: number): void {
  state.quietPrices = true;
  const s = new Script(state);
  const t0 = endMs - DEMO_SPAN_MS; // Sunday afternoon: only crypto is open
  s.at(t0 + 1_000);
  // A first account, opened small and closed out when BTC fell hard.
  s.attest();
  s.deposit(5_000);
  s.trade(BTC, "buy", 45_000);
  for (let i = 0; i < 400 && s.hasPositions(); i++) s.shock(BTC, -80);
  // Monday: a proper deposit and four positions.
  s.at(t0 + 24 * HOUR);
  s.deposit(100_000);
  s.trade(BTC, "buy", 55_000);
  s.at(t0 + 25 * HOUR);
  s.trade(ETH, "sell", 30_000);
  s.at(t0 + 26 * HOUR);
  s.trade(XAU, "buy", 20_000);
  s.at(t0 + 27 * HOUR);
  s.trade(US500, "sell", 25_000);
  // Overnight: financing is charged at 22:00.
  s.at(t0 + 35 * HOUR);
  s.at(t0 + 42 * HOUR);
  s.deposit(25_000);
  s.trade(EUR, "buy", 120_000);
  s.wait(10);
  // Moves that leave winners and losers.
  s.shock(BTC, 150);
  s.shock(ETH, 250);
  s.shock(XAU, -90);
  s.shock(EUR, -40);
  s.at(t0 + 48 * HOUR);
  s.shock(US500, -60);
  s.at(t0 + 58 * HOUR); // across Tuesday's 22:00
  s.at(t0 + 66 * HOUR);
  // Resting orders, and a withdrawal that joins the queue.
  s.rest(BTC, "buy", "limit", 20_000, -5);
  s.rest(ETH, "sell", "stop", 15_000, -7);
  s.rest(XAU, "sell", "limit", 10_000, 4);
  s.at(t0 + 69 * HOUR);
  const out = s.withdrawable() - fixedFromInt(1_000);
  if (out > 0n) s.withdraw((out / SCALE) * SCALE);
  // Bring the account close to its close-out threshold without crossing it.
  for (let i = 0; i < 400; i++) {
    const health = s.health();
    if (health === null || health < 6_500) break;
    s.shock(EUR, -4);
  }
  s.at(endMs);
  state.quietPrices = false;
}
