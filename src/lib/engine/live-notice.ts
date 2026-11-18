/**
 * The operator's status notice for the live client (monkey-trading/console#446): `GET /v1/notice`
 * read before each connection asks for the stream's `notice` frames, which carry it from then on.
 * The read also tells whether the node serves notices, asked again at every connection so a server
 * replaced by another release is asked the right query. A read that fails says nothing about the
 * notice, which stays as last heard until a frame or a read replaces it.
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
  /** Bumped by each read, frame and stop, so a read that answers after something newer is dropped. */
  private generation = 0;

  constructor(private readonly deps: NoticeWatchDeps) {}

  /**
   * Reads the notice and reports it, and says whether a connection asks for notice frames: false for a
   * node that predates them, which refuses to be asked for them. Never rejects.
   */
  async frames(): Promise<boolean> {
    const generation = ++this.generation;
    let notice: StatusNotice | null | undefined;
    try {
      notice = noticeOf(await this.deps.read());
    } catch (error) {
      return !(error instanceof EngineError && error.status === 404);
    }
    if (notice !== undefined && generation === this.generation) this.deps.report(notice);
    return true;
  }

  /** A notice frame the stream carried. */
  frame(notice: StatusNotice | null): void {
    this.generation++;
    this.deps.report(notice);
  }

  /** The stream ended: a read still on its way is dropped. */
  stop(): void {
    this.generation++;
  }
}
