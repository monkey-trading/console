/** What the one-off signed reads of the log share: their dependencies and the order of log offsets. */

import type { Scheduler, Socket } from "./live-stream";
import type { Verifier } from "./verifier";

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
export function position(offset: string): [number, number] {
  const [seq = "", index = ""] = offset.split(":");
  return [Number(seq), Number(index)];
}

export const atOrPast = (a: [number, number], b: [number, number]) => a[0] > b[0] || (a[0] === b[0] && a[1] >= b[1]);
