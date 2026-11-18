/**
 * The operator's status notice for the live client (monkey-trading/console#446): `GET /v1/notice`
 * before the first connection asks for the stream's `notice` frames, which carry it from then on.
 * A read that fails says nothing, so the notice last heard stays until a frame or a read replaces it.
 */

import { EngineError } from "./client";
import { noticeOf, type StatusNotice } from "./notice-types";

export interface NoticeWatchDeps {
  /** `GET /v1/notice`, signed. */
  read(): Promise<unknown>;
  /** The notice now in force, or null for none. */
  report(notice: StatusNotice | null): void;
}

export class NoticeWatch {
  /** Whether the node serves the notice: true once it signs an answer, false once its signed 404 says it predates the route; null before either. */
  private served: boolean | null = null;

  constructor(private readonly deps: NoticeWatchDeps) {}

  /** Whether a connection asks for notice frames, which a node that predates them refuses to be asked for: read from the node until it has said. Never rejects. */
  async frames(): Promise<boolean> {
    if (this.served === null) await this.read();
    return this.served !== false;
  }

  /** Reads the notice once and reports it. */
  async read(): Promise<void> {
    try {
      const notice = noticeOf(await this.deps.read());
      if (notice === undefined) return;
      this.served = true;
      this.deps.report(notice);
    } catch (error) {
      if (error instanceof EngineError && error.status === 404) this.served = false;
      // Any other failure says nothing of the notice.
    }
  }

  /** A notice frame the stream carried. */
  frame(notice: StatusNotice | null): void {
    this.served = true;
    this.deps.report(notice);
  }
}
