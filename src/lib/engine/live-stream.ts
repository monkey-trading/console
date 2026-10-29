/** The signed WebSocket stream: verifies each frame in order, tracks staleness, and reconnects where it left off. */

import type { FeedStatus } from "./attestation";
import { CLOCK_TOLERANCE_MS } from "./transport";
import type { NodeTrust } from "./trust";
import type { StreamMessage } from "./types";
import type { Verifier } from "./verifier";
import { parseFrameMessage, parseSignedFrame } from "./wire";

/** The feed is stale after this many heartbeat intervals without a valid frame. */
export const STALE_AFTER_INTERVALS = 3;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;

export interface Scheduler {
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** The part of a WebSocket the stream uses. */
export type Socket = Pick<WebSocket, "onmessage" | "onclose" | "onerror" | "close">;

export interface StreamDeps {
  /** `wss://host[:port]`. */
  origin: string;
  chainId: number;
  vault: string;
  heartbeatMs: number;
  /** The verifier, loaded by the time a connection opens. */
  verifier(): Verifier;
  trust: NodeTrust;
  openSocket(url: string): Socket;
  scheduler: Scheduler;
  nowMs(): number;
  challenge(): string;
  onMessage(message: StreamMessage): void;
  onFeed(status: FeedStatus): void;
  /** Why a connection was dropped, for the log of what the user is told. */
  onProblem(reason: string): void;
}

/** One signed stream that stays open, at most one socket at a time. */
export class LiveStream {
  private socket: Socket | null = null;
  private stopped = true;
  private feed: FeedStatus = "connecting";
  private lastOffset: string | null = null;
  private watchdog: unknown = null;
  private retry: unknown = null;
  private backoff = RECONNECT_MIN_MS;
  /** Bumped on each connection, so a late event from a closed socket is ignored. */
  private generation = 0;

  constructor(private readonly deps: StreamDeps) {}

  start(): void {
    this.stopped = false;
    void this.open();
  }

  stop(): void {
    this.stopped = true;
    this.generation++;
    this.clearTimers();
    this.socket?.close();
    this.socket = null;
  }

  private clearTimers(): void {
    if (this.watchdog !== null) this.deps.scheduler.clearTimeout(this.watchdog);
    if (this.retry !== null) this.deps.scheduler.clearTimeout(this.retry);
    this.watchdog = this.retry = null;
  }

  private setFeed(status: FeedStatus): void {
    if (status === this.feed) return;
    this.feed = status;
    this.deps.onFeed(status);
  }

  private async open(): Promise<void> {
    const generation = ++this.generation;
    this.setFeed("connecting");
    let signer: string;
    try {
      signer = await this.deps.trust.signer();
    } catch (error) {
      if (generation === this.generation) this.fail(error instanceof Error ? error.message : "The node is not verified.", false);
      return;
    }
    if (generation !== this.generation || this.stopped) return;
    const challenge = this.deps.challenge();
    const after = this.lastOffset === null ? "" : `&after=${this.lastOffset}`;
    const path = `/v1/stream?signed=1&challenge=${challenge}${after}`;
    const frames = this.deps.verifier().openFrames({ signer, chainId: this.deps.chainId, vault: this.deps.vault, challenge, pathAndQuery: path });
    let expected = 0;
    const socket = this.deps.openSocket(this.deps.origin + path);
    this.socket = socket;
    this.armWatchdog(generation);
    socket.onmessage = (event) => {
      if (generation !== this.generation) return;
      const text = typeof event.data === "string" ? event.data : null;
      const frame = text === null ? null : parseSignedFrame(text);
      if (text === null || frame === null) return this.fail("The node sent a stream frame that is not a signed envelope.", true);
      if (frame.n !== expected) return this.fail(`The stream skipped from frame ${expected - 1} to ${frame.n}: a frame was dropped, repeated or reordered.`, true);
      const checked = frames.verify(text);
      if (!checked.ok) return this.fail(`A stream frame did not verify: ${checked.reason}.`, true, signer);
      const skewMs = frame.time - this.deps.nowMs();
      if (Math.abs(skewMs) > CLOCK_TOLERANCE_MS) {
        this.deps.trust.clockWrong(skewMs);
        return this.fail("Your device clock differs from the node's signed time, so the stream was dropped.", false);
      }
      const message = parseFrameMessage(checked.msg);
      if (message === null) return this.fail("A signed stream frame carried a message the console does not know.", true);
      expected++;
      this.backoff = RECONNECT_MIN_MS;
      this.deps.trust.clockRight();
      this.setFeed("live");
      this.armWatchdog(generation);
      if (message.type === "command") {
        this.lastOffset = message.offset;
        this.deps.onMessage(message);
      }
    };
    socket.onclose = () => {
      if (generation === this.generation) this.fail("The connection to the node closed.", false);
    };
    socket.onerror = () => {
      if (generation === this.generation) this.fail("The connection to the node failed.", false);
    };
  }

  /** No valid frame or heartbeat for three intervals: stale until the next valid frame, on a fresh connection. */
  private armWatchdog(generation: number): void {
    if (this.watchdog !== null) this.deps.scheduler.clearTimeout(this.watchdog);
    this.watchdog = this.deps.scheduler.setTimeout(() => {
      if (generation === this.generation) this.fail("No data from the node for three heartbeat intervals.", false);
    }, this.deps.heartbeatMs * STALE_AFTER_INTERVALS);
  }

  /**
   * Drops the connection and marks the feed stale. After a frame that fails, the node's attestation
   * is checked again, since an enclave restart changes the signing key; then the stream reopens where
   * it left off, after a delay that doubles to 15 s while it keeps failing.
   */
  private fail(reason: string, checkNode: boolean, signer?: string): void {
    if (this.stopped) return;
    this.generation++;
    this.socket?.close();
    this.socket = null;
    this.clearTimers();
    this.setFeed("stale");
    this.deps.onProblem(reason);
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, RECONNECT_MAX_MS);
    const reopen = () => {
      this.retry = this.deps.scheduler.setTimeout(() => void this.open(), delay);
    };
    if (checkNode && signer !== undefined) void this.deps.trust.recheck(signer).then(reopen, reopen);
    else reopen();
  }
}
