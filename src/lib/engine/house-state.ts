/** `GET /v1/house/state`: the house's latest parameters and checkpoint, and what keeps them current between reads. */

import { fixedFromWire } from "../fixed";
import type { HouseParams } from "../house";
import type { SetParams } from "./types";
import type { CheckpointEntry } from "./wire";

/** What the node answers: the log head and the latest parameters and checkpoint its log holds. */
export interface HouseState {
  /** The log head the answer was taken at; null on an empty log. */
  seq: number | null;
  /** The latest applied `set_params`; null before the first. */
  params: HouseParams | null;
  /** The latest checkpoint; null before the log holds one. */
  checkpoint: CheckpointEntry | null;
}

/** The route's body, with the floor the engine leaves out when zero and the `seq` a restored snapshot may not know. */
export interface HouseStateWire {
  seq: number | null;
  params: (Omit<SetParams, "house_total_cap_floor"> & { house_total_cap_floor?: string; seq: number | null }) | null;
  checkpoint: CheckpointEntry | null;
}

/** The house parameters a `set_params` sets, from the log's seq or null when the node does not know it. */
export function houseParamsOf(entry: Omit<SetParams, "house_total_cap_floor"> & { house_total_cap_floor?: string }, seq: number | null): HouseParams {
  return {
    profitFeeBps: entry.profit_fee_bps,
    closeoutLevelBps: entry.closeout_level_bps,
    totalCapBps: entry.house_total_cap_bps,
    totalCapFloor: fixedFromWire(entry.house_total_cap_floor ?? "0"),
    seq,
  };
}

/**
 * Reads the route's body. The attested enclave signed it for this request, so its shape is the
 * engine's; a floor that is not a decimal throws.
 */
export function decodeHouseState(wire: HouseStateWire): HouseState {
  return { seq: wire.seq, params: wire.params === null ? null : houseParamsOf(wire.params, wire.params.seq), checkpoint: wire.checkpoint };
}

/**
 * The newest parameters and checkpoint seen, from reads of the route and from the stream. A value
 * replaces the held one only when its seq is newer, so a read that raced a stream message, or the
 * stream's replay of what a read already holds, never moves the page back.
 */
export class HouseFold {
  private params: HouseParams | null = null;
  private paramsAt = -1;
  private checkpoint: CheckpointEntry | null = null;

  /** Folds a read; parameters with no seq (a restore from an older snapshot) stand at the read's log head. */
  foldRead(state: HouseState): void {
    if (state.params !== null) this.foldParams(state.params, state.params.seq ?? state.seq ?? 0);
    if (state.checkpoint !== null) this.foldCheckpoint(state.checkpoint);
  }

  /** Folds a `set_params` the stream carried at `seq`. */
  foldStreamParams(seq: number, entry: SetParams): void {
    this.foldParams(houseParamsOf(entry, seq), seq);
  }

  foldCheckpoint(entry: CheckpointEntry): void {
    if (this.checkpoint === null || entry.seq > this.checkpoint.seq) this.checkpoint = entry;
  }

  /** The newest values folded so far. */
  current(): { params: HouseParams | null; checkpoint: CheckpointEntry | null } {
    return { params: this.params, checkpoint: this.checkpoint };
  }

  private foldParams(params: HouseParams, at: number): void {
    if (at <= this.paramsAt) return;
    this.params = params;
    this.paramsAt = at;
  }
}
