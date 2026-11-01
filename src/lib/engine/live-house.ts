/**
 * A bounded signed read of the log from a seq for the house's solvency state: the latest
 * `set_params` command and the latest checkpoint, which no REST route serves. Like the withdrawal
 * scan in `live-scan.ts`, the read is bounded and resolves with what it found when it stops short;
 * completion follows the same cursor, so a heartbeat ends the read only once the cursor has
 * reached the head it names. The caller chains chunks from the seq a stopped read reached until
 * one reaches the head.
 */

import { queueTotals, setParamsOf, type HouseParams, type QueueTotals } from "../house";
import { fixedFromWire } from "../fixed";
import type { SetParams, WithdrawalPage } from "./types";
import { atOrPast, position, type ScanDeps } from "./live-scan";
import type { SignedTransport } from "./transport";
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

/** What a chunk of the read found, and whether it read to the head. */
export interface HouseScanResult {
  /** The latest `set_params` the chunk passed, and its seq; null before the first. */
  params: SetParams | null;
  paramsSeq: number | null;
  /** The latest checkpoint the chunk passed; null before the first. */
  checkpoint: CheckpointEntry | null;
  complete: boolean;
  /** The seq of the last entry read, where a chunk that stopped short reads on from; null before any entry. */
  reached: number | null;
}

/**
 * Reads the signed log from seq `fromSeq` for the latest `set_params` and checkpoint. A chunk that
 * fails or runs out of budget after reading any entry answers with what it found and how far it
 * got, marked incomplete.
 * Error cases:
 * - before any entry: a frame is out of order or does not verify, or the connection fails
 */
export function scanHouse(deps: ScanDeps, fromSeq: number, budget: HouseScanBudget): Promise<HouseScanResult> {
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
      else resolve({ params, paramsSeq, checkpoint, complete: error === null, reached: last?.[0] ?? null });
    };
    const timer = deps.scheduler.setTimeout(() => finish(new Error("Reading the log for the house's parameters took too long.")), budget.maxMs);
    socket.onmessage = (event) => {
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
        if (++seen > budget.maxMessages) return finish(new Error("read enough"));
        last = position(message.offset);
      }
      if (message.type === "command") {
        const entry = setParamsOf(message.cmd);
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
  /** The seq the catch-up read has read through; the next chunk continues after it. */
  private through = -1;
  /** The catch-up read in flight; null when none runs. */
  private catchUp: Promise<void> | null = null;

  constructor(private readonly scanFrom: (fromSeq: number) => Promise<HouseScanResult>) {}

  get params(): HouseParams | null {
    return this.paramsFold;
  }

  get checkpoint(): CheckpointEntry | null {
    return this.checkpointFold;
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
    };
  }

  /** Applies a checkpoint read when it is newer than the fold. */
  foldCheckpoint(entry: CheckpointEntry): void {
    if (entry.seq <= this.checkpointSeq) return;
    this.checkpointSeq = entry.seq;
    this.checkpointFold = entry;
  }

  /** Starts the catch-up read if none runs; after a failure the next call starts a fresh chunk. */
  kick(): void {
    if (this.catchUp !== null) return;
    this.catchUp = this.run().then(
      () => {
        this.catchUp = null;
      },
      () => {
        // What the chunks folded is kept; the next read continues from where the read stopped.
        this.catchUp = null;
      },
    );
  }

  /**
   * Reads the log from where the last chunk ended until a chunk reaches the head, folding what it
   * passes. Errors stop the read; the next `kick` starts a fresh chunk from where the read stopped.
   * Error cases:
   * - a chunk fails before reading any entry, twice in a row from the same seq
   */
  private async run(): Promise<void> {
    let idleFailures = 0;
    for (;;) {
      const from = this.through + 1;
      const result = await this.scanFrom(from);
      if (result.params !== null && result.paramsSeq !== null) this.foldParams(result.paramsSeq, result.params);
      if (result.checkpoint !== null) this.foldCheckpoint(result.checkpoint);
      if (result.complete) return;
      if (result.reached === null) {
        // The chunk failed before any entry: without a cursor there is nowhere to continue from.
        if (++idleFailures >= 2) throw new Error("Reading the log for the house's parameters kept failing.");
      } else {
        idleFailures = 0;
        this.through = result.reached;
      }
    }
  }
}

/** The most withdrawal-queue pages a totals walk reads before it reports a lower bound. */
const QUEUE_PAGE_CAP = 25;

/** Walks the public withdrawal queue's signed pages to its end, or to the page cap as a lower bound. */
export async function withdrawalTotals(transport: SignedTransport, pageCap: number = QUEUE_PAGE_CAP): Promise<QueueTotals> {
  const pages: WithdrawalPage[] = [];
  let after: number | null = null;
  for (let i = 0; i < pageCap; i++) {
    const suffix = after === null ? "" : `&after=${after}`;
    const page = (await transport.get(`/v1/withdrawals?limit=200${suffix}`)) as WithdrawalPage;
    pages.push(page);
    if (page.next === null) return queueTotals(pages, false);
    after = page.next;
  }
  return queueTotals(pages, true);
}
