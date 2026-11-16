/**
 * The server's operating state for the live client (monkey-trading/console#398): the signed stream's
 * `status` frames while it runs, and `GET /v1/status` before the first connection asks for them and
 * while the stream is stale, which tells a server that cannot currently be verified (it answers
 * unsigned) from one that cannot be reached.
 */

import type { FeedStatus } from "./attestation";
import { EngineError } from "./client";
import type { Scheduler } from "./live-stream";
import type { ServerRead, ServerStatus } from "./status-types";
import { UnsignedAnswer } from "./trust-errors";

/** How often the status is read again while the stream is stale. */
export const STALE_STATUS_READ_MS = 10_000;

export interface StatusWatchDeps {
  /** `GET /v1/status`, signed. */
  read(): Promise<unknown>;
  scheduler: Scheduler;
  /** What the server's state now is; null when nothing current is known. */
  report(server: ServerRead | null): void;
  /** Whether the node's verdict holds a signer, so a read starts no check of the node of its own. */
  trusted(): boolean;
}

export class StatusWatch {
  /** Whether the node serves its operating state: true once it signs one, false once its signed 404 says it predates the route; null before either. */
  private served: boolean | null = null;
  private timer: unknown = null;
  /** Bumped when the feed changes, so a read that answers after the change is dropped. */
  private generation = 0;

  constructor(private readonly deps: StatusWatchDeps) {}

  /** Whether a connection asks for status frames, which a node that predates them refuses to be asked for: read from the node until it has said. */
  async frames(): Promise<boolean> {
    if (this.served === null) await this.read();
    return this.served !== false;
  }

  /** Reads the status once and reports what it says, unless the feed changed meanwhile; never rejects. */
  async read(): Promise<void> {
    const generation = this.generation;
    const server = await this.deps.read().then(
      // The attested enclave signed this answer, so its shape is the engine's.
      (status): ServerRead | null => {
        this.served = true;
        return { kind: "signed", status: status as ServerStatus };
      },
      (error: unknown): ServerRead | null => {
        if (error instanceof UnsignedAnswer) return { kind: "unsigned" };
        if (error instanceof EngineError && error.status === 0) return { kind: "unreachable" };
        if (error instanceof EngineError && error.status === 404) this.served = false;
        // Any other failure says nothing about the server's state.
        return null;
      },
    );
    if (generation === this.generation) this.deps.report(server);
  }

  /** A status frame the stream carried. */
  frame(status: ServerStatus): void {
    this.deps.report({ kind: "signed", status });
  }

  /** The stream went stale, when the status is read now and every `STALE_STATUS_READ_MS` until it is live while the node is trusted, or live again, when its connection's first status frame says what holds. */
  feed(status: FeedStatus): void {
    this.stop();
    if (status === "stale") void this.poll();
  }

  stop(): void {
    this.generation++;
    if (this.timer !== null) this.deps.scheduler.clearTimeout(this.timer);
    this.timer = null;
  }

  private async poll(): Promise<void> {
    const generation = this.generation;
    if (this.deps.trusted()) await this.read();
    if (generation === this.generation) this.timer = this.deps.scheduler.setTimeout(() => void this.poll(), STALE_STATUS_READ_MS);
  }
}
