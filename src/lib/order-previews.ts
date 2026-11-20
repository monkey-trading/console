/**
 * The server's previews of exact orders (#916's `GET /v1/accounts/{address}/preview`), asked a moment after the orders last
 * changed, so typing a size asks once, and again whenever `refresh` is called while the surface reading them is shown and no
 * read is on its way. Only the latest read's answers count: one that lands after a newer read began, for orders no longer asked
 * about, or after `stop` is dropped. A failed read publishes `"failed"` and is asked again at the next `refresh`.
 */

import type { OrderPreviewRequest } from "./engine/portfolio-types";
import { requestOfKey, type PreviewAnswer } from "./ticket-portfolio";

/** How long the orders must stay unchanged before they are asked about, in milliseconds. */
export const SETTLE_MS = 250;

/** No answers. */
export const NO_ANSWERS: ReadonlyMap<string, PreviewAnswer> = new Map();

/** What the previews read and tell: the read of one order's preview, where the answers go, and whether the surface is on screen. */
export interface PreviewPorts {
  read: (request: OrderPreviewRequest) => Promise<Exclude<PreviewAnswer, "failed" | undefined>>;
  /** Receives each request's answer by its key, or no answers while no orders are asked about. */
  publish: (answers: ReadonlyMap<string, PreviewAnswer>) => void;
  /** Whether the surface reading the answers and the tab are on screen now. */
  shown: () => boolean;
  /** Calls `changed` whenever the surface or the tab may have been shown or hidden; returns what stops it. */
  watch: (changed: () => void) => () => void;
}

export class OrderPreviews {
  /** The orders asked about now, as newline-joined `previewKey`s; empty for none. */
  private keys = "";
  /** The orders a read is on its way for, and that read's number, the latest started. */
  private pending: string | null = null;
  private latest = 0;
  private settle: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private wasShown: boolean;
  private readonly unwatch: () => void;

  constructor(private readonly ports: PreviewPorts) {
    this.wasShown = ports.shown();
    this.unwatch = ports.watch(() => {
      const now = ports.shown();
      const becameShown = now && !this.wasShown;
      this.wasShown = now;
      // Nothing else changes when a hidden pane or tab is opened, so the orders it skipped are asked about now.
      if (becameShown) this.ask();
    });
  }

  /** The orders now asked about: asked once they have stayed the same for `SETTLE_MS`; with none, the answers held are forgotten. */
  setOrders(keys: string): void {
    this.keys = keys;
    if (this.settle !== null) clearTimeout(this.settle);
    this.settle = setTimeout(() => {
      this.settle = null;
      if (keys === "") this.ports.publish(NO_ANSWERS);
      else this.ask();
    }, SETTLE_MS);
  }

  /** The account or the prices moved: asks again, unless a read of these orders is on its way or the surface is hidden. */
  refresh(): void {
    this.ask();
  }

  /** Drops the wait, the watching and any read on its way. */
  stop(): void {
    this.stopped = true;
    if (this.settle !== null) clearTimeout(this.settle);
    this.settle = null;
    this.unwatch();
  }

  private ask(): void {
    const asked = this.keys;
    if (this.stopped || asked === "" || this.pending === asked || !this.ports.shown()) return;
    this.latest += 1;
    const read = this.latest;
    this.pending = asked;
    const keys = asked.split("\n");
    const reads = keys.map((key) => this.ports.read(requestOfKey(key)).then((answer): PreviewAnswer => answer, (): PreviewAnswer => "failed"));
    void Promise.all(reads).then((results) => {
      if (read !== this.latest) return;
      this.pending = null;
      if (!this.stopped && this.keys === asked) this.ports.publish(new Map(keys.map((key, index) => [key, results[index]])));
    });
  }
}
