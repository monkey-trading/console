/** The mock build's operator and test controls: nothing the real node exposes to a client. */

import { fixedFromInt, type Fixed } from "../fixed";
import type { EngineEvent, MarketId } from "../engine/types";
import type { AttestationMode, MockEngineClient } from "./client";
import { chainDeposit, payQueue } from "./funds";
import { MAX_STRESS } from "../pricing";
import type { Region } from "./state";

/** Lets the mock be pushed into each state the screens must handle. */
export class MockControls {
  constructor(private readonly client: MockEngineClient) {}

  get region(): Region {
    return this.client.state.region;
  }

  setRegion(region: Region): void {
    this.client.state.region = region;
  }

  get attestationMode(): AttestationMode {
    return this.client.attestationMode;
  }

  setAttestationMode(mode: AttestationMode): void {
    this.client.attestationMode = mode;
  }

  /** Raises one market's stress floor (or every market's when `market` is null). */
  setStressFloor(market: MarketId | null, level: number): void {
    const floor = Math.min(Math.max(Math.trunc(level), 0), MAX_STRESS);
    for (const [id, runtime] of this.client.state.markets) if (market === null || id === market) runtime.floor = floor;
  }

  /** Halts or resumes a market on top of its schedule. */
  setHalted(market: MarketId, halted: boolean): void {
    const runtime = this.client.state.markets.get(market);
    if (runtime) runtime.halted = halted;
  }

  /** Moves a market's index by `bps` at the next step. */
  shock(market: MarketId, bps: number): void {
    const runtime = this.client.state.markets.get(market);
    if (runtime) runtime.shockBps += bps;
  }

  /** Gives the vault liquidity, paying the queue from its head. */
  addLiquidity(amount: Fixed): EngineEvent[] {
    const events = payQueue(this.client.state, amount);
    this.client.state.emit({ type: "tick" }, events);
    return events;
  }

  /** Stands in for a transaction to the vault, as the real wallet sends; see `chainDeposit`. */
  deposit(address: string, amount: Fixed): void {
    chainDeposit(this.client.state, address, amount);
  }
}

/** Requests ahead of the user's in the withdrawal queue, so a new request starts behind others. */
export const SEEDED_QUEUE = [
  { account: "0x1111111111111111111111111111111111111111", amount: fixedFromInt(40_000) },
  { account: "0x2222222222222222222222222222222222222222", amount: fixedFromInt(120_000) },
  { account: "0x3333333333333333333333333333333333333333", amount: fixedFromInt(65_000) },
] as const;
