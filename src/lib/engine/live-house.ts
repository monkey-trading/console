/**
 * A bounded signed read of the log from a seq for the house's solvency state: the latest
 * `set_params` command and the latest checkpoint, which no REST route serves. Like the withdrawal
 * scan in `live-scan.ts`, the read is bounded and resolves with what it found when it stops short;
 * completion follows the same cursor, so a heartbeat ends the read only once the cursor has
 * reached the head it names. The caller chains chunks from the seq a stopped read reached until
 * one reaches the head.
 */

import { setParamsOf, type HouseParams } from "../house";
import { fixedFromWire } from "../fixed";
import type { SetParams } from "./types";
import { atOrPast, position, type ScanDeps } from "./live-scan";
import { parseFrameMessage, parseSignedFrame, type CheckpointEntry } from "./wire";

/** When a chunk of the read stops: at either of these, whichever comes first. */
export interface HouseScanBudget {
  /** The most log entries read. */
  maxMessages: number;
  /** The most wall-clock time the chunk may take, in milliseconds (the scheduler's clock). */
  maxMs: number;
}

/** One chunk of the catch-up read of the whole log. */
export const HOUSE_SCAN_CHUNK: HouseScanBudget = { maxMessages: 25_000, maxMs: 15_000 };
/** How long a failed catch-up waits before the next read retries it. */
const RETRY_AFTER_FAILURE_MS = 30_000;

/** What a chunk of the read found, and whether it read to the head. */
export interface HouseScanResult {
  /** The latest applied `set_params` the chunk passed, and its seq; null before the first. */
  params: SetParams | null;
  paramsSeq: number | null;
  /** The latest checkpoint the chunk passed; null before the first. */
  checkpoint: CheckpointEntry | null;
  complete: boolean;
  /** The position of the last entry read, where a chunk that stopped short resumes; null before any entry. */
  last: [number, number] | null;
}

/**
 * Reads the signed log from seq `fromSeq` for the latest `set_params` and checkpoint. A chunk that
 * fails or runs out of budget after reading any entry answers with what it found and how far it
 * got, marked incomplete. `skipPast` drops entries at or before a position a previous chunk
 * already folded, so a chunk may resume at the last sequence read without folding it twice; a
 * sequence holds several entries, and the next chunk's first entries may repeat the last one's.
 * Error cases:
 * - before any entry: a frame is out of order or does not verify, or the connection fails
 */
export function scanHouse(deps: ScanDeps, fromSeq: number, budget: HouseScanBudget, skipPast?: [number, number], dead?: () => boolean): Promise<HouseScanResult> {
  return new Promise((resolve, reject) => {
    const challenge = deps.challenge();
    const path = `/v1/stream?signed=1&challenge=${challenge}&from=${fromSeq}`;
    const frames = deps.verifier.openFrames({ signer: deps.signer, chainId: deps.chainId, vault: deps.vault, challenge, pathAndQuery: path });
    const socket = deps.openSocket(deps.origin + path);
    let expected = 0;
    let seen = 0;
    let params: SetParams | null = null;
    let paramsSeq: number | null = null;
    let checkpoint: CheckpointEntry | null = null;
    let last: [number, number] | null = null;
    let done = false;
    const finish = (error: Error | null) => {
      if (done) return;
      done = true;
      deps.scheduler.clearTimeout(timer);
      socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close();
      if (error && last === null) reject(error);
      else resolve({ params, paramsSeq, checkpoint, complete: error === null, last });
    };
    const timer = deps.scheduler.setTimeout(() => finish(new Error("Reading the log for the house's parameters took too long.")), budget.maxMs);
    socket.onmessage = (event) => {
      // A stale chunk stands down as soon as the fold moves on, so a reconnect's re-read need not
      // wait out the budget it would otherwise spend.
      if (dead?.()) return finish(new Error("The read was superseded by a newer one."));
      const text = typeof event.data === "string" ? event.data : null;
      const frame = text === null ? null : parseSignedFrame(text);
      if (text === null || frame === null || frame.n !== expected) return finish(new Error("The node's log stream skipped or sent an unsigned frame."));
      const checked = frames.verify(text);
      if (!checked.ok) return finish(new Error(`A log frame did not verify: ${checked.reason}.`));
      expected++;
      const message = parseFrameMessage(checked.msg);
      if (message === null) return finish(new Error("A signed log frame carried a message the console does not know."));
      if (message.type === "heartbeat") {
        // Once the read reaches the head a heartbeat names, the log holds nothing later yet; before
        // any entry, the read stands just before `fromSeq`.
        const reached = last ?? [fromSeq - 1, Number.MAX_SAFE_INTEGER];
        if (message.head === null || atOrPast(reached, position(message.head))) return finish(null);
        return;
      }
      if ("offset" in message) {
        // A resuming chunk re-reads the cursor's sequence; the replayed entries verify and track
        // the cursor but do not spend the new-entry budget, or one long sequence could starve it.
        const at = position(message.offset);
        if (skipPast === undefined || !atOrPast(skipPast, at)) {
          if (++seen > budget.maxMessages) return finish(new Error("The budget for one read of the log was spent."));
        }
        last = at;
      }
      // Entries a previous chunk folded are read again and skipped; a rejected command is
      // sequenced too, and its values never applied, so it folds nothing.
      if (skipPast !== undefined && "offset" in message && atOrPast(skipPast, position(message.offset))) return;
      if (message.type === "command") {
        const entry = setParamsOf(message.cmd, message.events);
        if (entry !== null) {
          params = entry;
          paramsSeq = message.seq;
        }
      } else if (message.type === "checkpoint") {
        checkpoint = message;
      }
    };
    socket.onclose = () => finish(new Error("The connection to the node closed while reading the log."));
    socket.onerror = () => finish(new Error("The connection to the node failed while reading the log."));
  });
}

/**
 * The live client's fold of the log's house state: the latest `set_params` and the latest
 * checkpoint, which no REST route serves. The fold takes values from two in-order streams — the
 * live stream and a catch-up read of the log in bounded chunks from its start — and applies a
 * value only when its seq is newer than the folded one, so neither stream can overwrite a newer
 * read with an older one.
 */
export class HouseLog {
  private paramsFold: HouseParams | null = null;
  private paramsSeq = -1;
  private checkpointFold: CheckpointEntry | null = null;
  private checkpointSeq = -1;
  /** The position the catch-up read has read through; the next chunk resumes there. */
  private last: [number, number] | null = null;
  /** True once a catch-up read has reached the head; the live stream keeps the fold current after it. */
  private caughtUp = false;
  /** True after a catch-up read ended in failure; cleared when a read makes progress or reaches the head. */
  private failed = false;
  /** The catch-up read in flight; null when none runs. */
  private catchUp: Promise<void> | null = null;
  /** Bumped to cancel a running catch-up when the session stops; a cancelled run keeps its folds. */
  private generation = 0;
  /** Set when a read in flight is superseded and a fresh one must start the moment it settles. */
  private restart = false;
  /** The most consecutive chunks that failed without advancing the read, before the read gives up. */
  private stallFailures = 0;
  /** The clock's time before which a failed read is not retried. */
  private retryAt = 0;

  constructor(private readonly scanFrom: (fromSeq: number, skipPast?: [number, number], dead?: () => boolean) => Promise<HouseScanResult>, private readonly nowMs: () => number) {}

  /** The state of the log read feeding the fold. */
  get freshness(): "current" | "reading" | "failed" {
    return this.caughtUp ? "current" : this.failed ? "failed" : "reading";
  }

  /** The latest applied `set_params` folded so far, with the state of the log read feeding the fold. */
  get params(): HouseParams | null {
    if (this.paramsFold === null) return null;
    return { ...this.paramsFold, fresh: this.freshness };
  }

  get checkpoint(): CheckpointEntry | null {
    return this.checkpointFold;
  }

  /**
   * Marks the fold not-current: a new stream connection starts at the live end and can miss log
   * entries, so the next read resumes catch-up from the last position read and re-reads to the
   * head. A read in flight stands down without claiming completion, since the entries it missed
   * while the stream reconnects are exactly what it cannot have seen.
   */
  uncaught(): void {
    this.caughtUp = false;
    this.generation += 1;
    this.restart = true; // a read in flight is superseded: start its successor the moment it settles
  }

  /** Stops a running catch-up: its chunks stand down as they finish; the folds are kept. */
  cancel(): void {
    this.generation += 1;
    this.restart = false; // no one reads the fold after a stop: nothing restarts
  }

  /** Applies a `set_params` read at `seq` when it is newer than the fold, whatever stream it came from. */
  foldParams(seq: number, entry: SetParams): void {
    if (seq <= this.paramsSeq) return;
    this.paramsSeq = seq;
    this.paramsFold = {
      profitFeeBps: entry.profit_fee_bps,
      closeoutLevelBps: entry.closeout_level_bps,
      totalCapBps: entry.house_total_cap_bps,
      totalCapFloor: fixedFromWire(entry.house_total_cap_floor),
      seq,
      fresh: "reading",
    };
  }

  /** Applies a checkpoint read when it is newer than the fold. */
  foldCheckpoint(entry: CheckpointEntry): void {
    if (entry.seq <= this.checkpointSeq) return;
    this.checkpointSeq = entry.seq;
    this.checkpointFold = entry;
  }

  /**
   * Starts the catch-up read if none runs, none has reached the head, and no recent failure is
   * still waiting to retry. A read already in flight blocks only while it is current: one a
   * reconnect or stop has superseded settles on its own, and the fresh read starts the moment it
   * does.
   */
  kick(): void {
    if (this.caughtUp || this.nowMs() < this.retryAt) return;
    if (this.catchUp !== null) return;
    this.startRun();
  }

  /** Runs the catch-up loop; a restart pending when it settles starts the fresh read. */
  private startRun(): void {
    this.stallFailures = 0;
    this.restart = false;
    this.catchUp = this.run().then(
      () => {
        this.catchUp = null;
        if (this.restart) {
          this.restart = false;
          this.kick();
        }
      },
      () => {
        // What the chunks folded is kept; the next read continues from where the read stopped.
        this.failed = true;
        this.retryAt = this.nowMs() + RETRY_AFTER_FAILURE_MS;
        this.catchUp = null;
        if (this.restart) {
          this.restart = false;
          this.kick();
        }
      },
    );
  }

  /**
   * Reads the log from where the last chunk ended until a chunk reaches the head, folding what it
   * passes. A chunk resumes at the last position read, so a sequence's later entries — a command's
   * checkpoint among them — are never skipped. A chunk that fails where the last made no progress
   * is a poisoned position: after a few tries the read gives up, marks itself failed, and waits
   * before retrying, instead of looping on the node. `cancel` and `uncaught` bump a generation the
   * loop checks between chunks: a read in flight stands down without claiming completion, and the
   * next read resumes from the cursor.
   * Error cases:
   * - a chunk fails where the read has made no progress, three chunks in a row
   */
  private async run(): Promise<void> {
    const generation = this.generation;
    for (;;) {
      const from = this.last?.[0] ?? 0;
      const result = await this.scanFrom(from, this.last ?? undefined, () => generation !== this.generation);
      if (generation !== this.generation) return; // invalidated or cancelled mid-read: the next read resumes from `last`
      if (result.params !== null && result.paramsSeq !== null) this.foldParams(result.paramsSeq, result.params);
      if (result.checkpoint !== null) this.foldCheckpoint(result.checkpoint);
      if (result.complete) {
        this.failed = false;
        this.stallFailures = 0;
        if (result.last !== null) this.last = result.last;
        this.caughtUp = true;
        return;
      }
      // Strictly forward: `result.last` must be past, not at or before, the cursor — the chunk
      // resumes at the cursor's sequence, so its first entry repeats it.
      const advanced = result.last !== null && (this.last === null || !atOrPast(this.last, result.last));
      if (!advanced) {
        if (++this.stallFailures >= 3) throw new Error("Reading the log kept failing at one position.");
      } else {
        this.failed = false;
        this.stallFailures = 0;
        this.last = result.last;
      }
    }
  }
}
