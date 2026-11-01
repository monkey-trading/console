/** The public withdrawal queue's size: walked in signed pages to its end or a page cap, cached for its TTL, and backed off after a failure. */

import { queueTotals, type QueueTotals } from "../house";
import type { SignedTransport } from "./transport";
import type { WithdrawalPage } from "./types";

/** The most withdrawal-queue pages a totals walk reads before it reports a lower bound. */
const QUEUE_PAGE_CAP = 25;
/** How long a walk's answer is reused before the next read walks the queue again. */
const TOTALS_TTL_MS = 15_000;
/** How long a failed walk waits before the next read retries it. */
const TOTALS_RETRY_AFTER_FAILURE_MS = 30_000;

/**
 * Walks the public withdrawal queue's signed pages to its end, or to the page cap as a lower
 * bound; a fresh walk's answer is reused for its TTL, so a tick's refresh does not re-walk an
 * unchanged queue. Each page is signed alone, so pages answered at different log seqs are not one
 * snapshot of the queue; the totals then mix a changing queue's states, which the caller says so.
 */
export class QueueTotalsWalk {
  private cache: { at: number; totals: QueueTotals } | null = null;
  /** The clock's time before which a failed walk is not retried, so a failing node is not re-walked every tick. */
  private retryAt = 0;

  constructor(private readonly transport: SignedTransport, private readonly nowMs: () => number) {}

  async totals(): Promise<QueueTotals> {
    const cached = this.cache;
    if (cached !== null && this.nowMs() - cached.at < TOTALS_TTL_MS) return cached.totals;
    // During backoff the walk keeps failing, so the store's retained figures keep their failure
    // warning; only a fresh cache (no failure yet) is served without walking.
    if (this.nowMs() < this.retryAt) throw new Error("The queue read failed and is waiting to retry.");
    try {
      const totals = await this.walk();
      this.cache = { at: this.nowMs(), totals };
      return totals;
    } catch (error) {
      this.retryAt = this.nowMs() + TOTALS_RETRY_AFTER_FAILURE_MS;
      throw error;
    }
  }

  private async walk(): Promise<QueueTotals> {
    const pages: WithdrawalPage[] = [];
    const finish = (complete: boolean) => queueTotals(pages, complete, pages.every((p) => p.seq === (pages[0]?.seq ?? null)));
    let after: number | null = null;
    for (let i = 0; i < QUEUE_PAGE_CAP; i++) {
      const suffix = after === null ? "" : `&after=${after}`;
      const page = (await this.transport.get(`/v1/withdrawals?limit=200${suffix}`)) as WithdrawalPage;
      pages.push(page);
      if (page.next === null) return finish(true);
      after = page.next;
    }
    return finish(false);
  }
}
