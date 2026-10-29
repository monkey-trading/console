/**
 * Finds one payout's signed withdrawal authorization in the log: a one-off signed stream connection
 * from a seq, read until the log's head, for an authorization the page's own stream did not carry,
 * such as one issued before the page loaded.
 */

import type { Scheduler, Socket } from "./live-stream";
import type { Address, SignedWithdrawal } from "./types";
import type { Verifier } from "./verifier";
import { parseFrameMessage, parseSignedFrame } from "./wire";

/** How long a search may take before it gives up, in milliseconds. */
const SCAN_TIMEOUT_MS = 30_000;

export interface ScanDeps {
  /** `wss://host[:port]`. */
  origin: string;
  chainId: number;
  vault: string;
  signer: string;
  verifier: Verifier;
  openSocket(url: string): Socket;
  scheduler: Scheduler;
  challenge(): string;
}

/** A log offset `<seq>:<index>` as a pair that orders like the log. */
function position(offset: string): [number, number] {
  const [seq = "", index = ""] = offset.split(":");
  return [Number(seq), Number(index)];
}

const atOrPast = (a: [number, number], b: [number, number]) => a[0] > b[0] || (a[0] === b[0] && a[1] >= b[1]);

/** What a search of the log found, and whether it read to the head, so nothing later can be missing. */
export interface ScanResult {
  /** The latest authorization of the payout the read passed, or null. */
  withdrawal: SignedWithdrawal | null;
  complete: boolean;
  /** The seq of the last entry read, where a search that stopped short reads on from; null before any entry. */
  reached: number | null;
}

/**
 * Reads the log from seq `fromSeq` to the head a heartbeat names, for the latest authorization of
 * `account`'s payout `nonce`. The read goes to the head, since the node also signs a payout again,
 * unexpired, when the vault's signer rotates. A read that fails or runs out of time after reading any
 * entry answers with what it found and how far it got, marked incomplete.
 * Error cases:
 * - before any entry: a frame is out of order or does not verify, the connection fails, or the search takes over 30 s
 */
export function scanForWithdrawal(deps: ScanDeps, account: Address, nonce: number, fromSeq: number): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    const challenge = deps.challenge();
    const path = `/v1/stream?signed=1&challenge=${challenge}&from=${fromSeq}`;
    const frames = deps.verifier.openFrames({ signer: deps.signer, chainId: deps.chainId, vault: deps.vault, challenge, pathAndQuery: path });
    const socket = deps.openSocket(deps.origin + path);
    let expected = 0;
    let found: SignedWithdrawal | null = null;
    let last: [number, number] | null = null;
    let done = false;
    const finish = (error: Error | null) => {
      if (done) return;
      done = true;
      deps.scheduler.clearTimeout(timer);
      socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close();
      if (error && last === null) reject(error);
      else resolve({ withdrawal: found, complete: error === null, reached: last?.[0] ?? null });
    };
    const timer = deps.scheduler.setTimeout(() => finish(new Error("Looking for the withdrawal's authorization in the log took too long.")), SCAN_TIMEOUT_MS);
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
        if (message.head === null || atOrPast(reached, position(message.head))) finish(null);
        return;
      }
      if ("offset" in message) last = position(message.offset);
      if (message.type === "withdrawal" && message.account.toLowerCase() === account.toLowerCase() && message.nonce === nonce) found = message;
    };
    socket.onclose = () => finish(new Error("The connection to the node closed while reading the log."));
    socket.onerror = () => finish(new Error("The connection to the node failed while reading the log."));
  });
}
