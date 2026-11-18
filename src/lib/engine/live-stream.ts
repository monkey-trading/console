/** The signed WebSocket stream: verifies each frame in order, tracks staleness, and reconnects at the live end. */

import type { FeedStatus } from "./attestation";
import { NoticeWatch } from "./live-notice";
import type { StatusNotice } from "./notice-types";
import type { ServerStatus } from "./status-types";
import { CLOCK_TOLERANCE_MS } from "./transport";
import type { NodeTrust } from "./trust";
import type { Address, MarketId, MarketQuote, SignedWithdrawal, StreamMessage } from "./types";
import type { Verifier } from "./verifier";
import { parseFrameMessage, parseSignedFrame, type CheckpointEntry } from "./wire";

/** The feed is stale after this many heartbeat intervals without a valid frame. */
export const STALE_AFTER_INTERVALS = 3;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;

export interface Scheduler {
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** The part of a WebSocket the stream uses. */
export type Socket = Pick<WebSocket, "onopen" | "onmessage" | "onclose" | "onerror" | "close" | "send">;

/** The account and markets whose executable quotes the connection asks for. */
export interface QuoteRequest {
  account: Address;
  markets: MarketId[];
}

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
  /** An executable quote for the account the connection asked about. */
  onQuote(quote: MarketQuote): void;
  /** The node refused the connection's quote request. */
  onQuoteError(error: string): void;
  /** A signed withdrawal authorization, for any account. */
  onWithdrawal(withdrawal: SignedWithdrawal): void;
  /** A signed checkpoint the stream carried: the state root the enclave committed at `seq`. */
  onCheckpoint(checkpoint: CheckpointEntry): void;
  /** Whether a connection asks for the server's operating state, once the node is trusted: false for a node that predates it, which refuses the query. Never rejects. */
  statusFrames(): Promise<boolean>;
  /** The server's operating state, when a connection opens and each time it changes. */
  onStatus(status: ServerStatus): void;
  /** `GET /v1/notice`, signed. */
  readNotice(): Promise<unknown>;
  /** The operator's status notice, or null for none: read before a connection opens, then when it opens and each time it changes. */
  onNotice(notice: StatusNotice | null): void;
  /** `time` is the signed time of the frame that made the feed live. */
  onFeed(status: FeedStatus, time?: number): void;
  /** Why a connection was dropped, for the log of what the user is told. */
  onProblem(reason: string): void;
}

/** One signed stream that stays open, at most one socket at a time. */
export class LiveStream {
  private socket: Socket | null = null;
  private stopped = true;
  private feed: FeedStatus = "connecting";
  private watchdog: unknown = null;
  private retry: unknown = null;
  private backoff = RECONNECT_MIN_MS;
  /** Whether the outage in progress has been reported, so it is reported once however many attempts it takes. */
  private reported = false;
  /** Bumped on each connection, so a late event from a closed socket is ignored. */
  private generation = 0;
  /** The quotes the page wants, sent on each connection once it opens. */
  private quotes: QuoteRequest | null = null;
  /**
   * The quote request sent on the open connection, as sent; whether the node refused it; and whether
   * the page asked for it again before the answer came, so a refusal that arrives later is retried once.
   */
  private sent: { account: Address; op: string; refused: boolean; again: boolean } | null = null;
  /** Whether the socket has opened, so it can carry the quote request. */
  private connected = false;

  /** The operator's status notice, read before each connection asks for its frames, which a node that predates the route is not asked for. */
  private readonly notice = new NoticeWatch({ read: () => this.deps.readNotice(), report: (notice) => this.deps.onNotice(notice) });

  constructor(private readonly deps: StreamDeps) {}

  start(): void {
    this.stopped = false;
    void this.open();
  }

  /**
   * Asks for `request`'s quotes, or for none. Sent at once on an open connection, unless the node is
   * already serving the same request; a request it refused, such as for an account not yet credited,
   * is sent again, since the account may have been credited since.
   */
  setQuotes(request: QuoteRequest | null): void {
    this.quotes = request;
    if (this.connected) this.sendQuotes();
  }

  /** Sends the wanted quote request; no request after one was sent ends it with an empty market list. */
  private sendQuotes(): void {
    const request = this.quotes ?? (this.sent === null ? null : { account: this.sent.account, markets: [] });
    if (request === null) return;
    const op = JSON.stringify({ op: "quotes", account: request.account, markets: request.markets });
    if (this.sent?.op === op && !this.sent.refused) {
      this.sent.again = true;
      return;
    }
    this.sent = { account: request.account, op, refused: false, again: false };
    this.socket?.send(op);
  }

  /** The node's verdict ended: an open connection stops, marks the feed stale and comes back only through the next verdict, since its frames are checked against the signer it opened with. */
  distrust(reason: string): void {
    if (!this.stopped && this.socket !== null) this.fail(reason);
  }

  stop(): void {
    this.stopped = true;
    this.generation++;
    this.notice.stop();
    this.connected = false;
    this.clearTimers();
    this.socket?.close();
    this.socket = null;
  }

  private clearTimers(): void {
    if (this.watchdog !== null) this.deps.scheduler.clearTimeout(this.watchdog);
    if (this.retry !== null) this.deps.scheduler.clearTimeout(this.retry);
    this.watchdog = this.retry = null;
  }

  private setFeed(status: FeedStatus, time?: number): void {
    if (status === this.feed) return;
    this.feed = status;
    this.deps.onFeed(status, time);
  }

  private async open(): Promise<void> {
    if (this.stopped) return;
    const generation = ++this.generation;
    let signer: string;
    try {
      signer = await this.deps.trust.signer();
    } catch (error) {
      if (generation === this.generation) this.fail(error instanceof Error ? error.message : "The server has not yet been verified.");
      return;
    }
    // Stopped while the node was being verified: nothing is asked of it, since a late answer would reach the page after a newer stream's.
    if (generation !== this.generation || this.stopped) return;
    const [status, notice] = await Promise.all([this.deps.statusFrames(), this.notice.frames()]);
    if (generation !== this.generation || this.stopped) return;
    const challenge = this.deps.challenge();
    // Every connection starts at the live end of the log; the store reads what an outage missed.
    const path = `/v1/stream?signed=1${status ? "&status=1" : ""}${notice ? "&notice=1" : ""}&challenge=${challenge}`;
    const frames = this.deps.verifier().openFrames({ signer, chainId: this.deps.chainId, vault: this.deps.vault, challenge, pathAndQuery: path });
    let expected = 0;
    const socket = this.deps.openSocket(this.deps.origin + path);
    this.socket = socket;
    this.connected = false;
    this.sent = null;
    this.armWatchdog(generation);
    socket.onopen = () => {
      if (generation !== this.generation) return;
      this.connected = true;
      this.sendQuotes();
    };
    socket.onmessage = (event) => {
      if (generation !== this.generation) return;
      const text = typeof event.data === "string" ? event.data : null;
      const frame = text === null ? null : parseSignedFrame(text);
      if (text === null || frame === null) return this.fail("The server sent an update that was not signed.");
      if (frame.n !== expected) return this.fail("An update from the server was missed, repeated or received out of order.");
      const checked = frames.verify(text);
      if (!checked.ok) return this.fail(`An update from the server failed verification: ${checked.reason}.`, signer);
      // The vault named another signer since this connection opened: its frames are refused, valid as their signatures are.
      if (this.deps.trust.refuses(signer)) return this.fail(this.deps.trust.whyRefused(signer));
      const skewMs = frame.time - this.deps.nowMs();
      if (Math.abs(skewMs) > CLOCK_TOLERANCE_MS) {
        this.deps.trust.clockWrong(skewMs);
        return this.fail("Your device clock is incorrect, so live updates have stopped.");
      }
      const message = parseFrameMessage(checked.msg);
      if (message === null) return this.fail("The server sent an update that this version of the app does not recognise.");
      expected++;
      this.backoff = RECONNECT_MIN_MS;
      this.reported = false;
      this.deps.trust.clockRight();
      this.setFeed("live", frame.time);
      this.armWatchdog(generation);
      if (message.type === "command") this.deps.onMessage(message);
      else if (message.type === "quote") this.deps.onQuote(message);
      else if (message.type === "withdrawal") this.deps.onWithdrawal(message);
      else if (message.type === "checkpoint") this.deps.onCheckpoint(message);
      else if (message.type === "status") this.deps.onStatus(message);
      else if (message.type === "notice") this.notice.frame(message.notice);
      else if (message.type === "quote_error") {
        this.deps.onQuoteError(message.error);
        if (this.sent !== null) {
          // Asked again while this answer was on its way, such as once the account was credited: ask once more.
          const retry = this.sent.again;
          this.sent.refused = true;
          if (retry) this.sendQuotes();
        }
      }
    };
    socket.onclose = () => {
      if (generation === this.generation) this.fail("The connection to the server was closed.");
    };
    socket.onerror = () => {
      if (generation === this.generation) this.fail("The connection to the server failed.");
    };
  }

  /** No valid frame or heartbeat for three intervals: stale until the next valid frame, on a fresh connection. */
  private armWatchdog(generation: number): void {
    if (this.watchdog !== null) this.deps.scheduler.clearTimeout(this.watchdog);
    this.watchdog = this.deps.scheduler.setTimeout(() => {
      if (generation === this.generation) this.fail("The server has stopped sending updates.");
    }, this.deps.heartbeatMs * STALE_AFTER_INTERVALS);
  }

  /**
   * Drops the connection and marks the feed stale. After a frame that fails, the node's attestation
   * is checked again, since an enclave restart changes the signing key; then the stream reopens at
   * the live end, after a delay that doubles to 15 s while it keeps failing.
   */
  private fail(reason: string, signer?: string): void {
    if (this.stopped) return;
    this.generation++;
    this.connected = false;
    this.socket?.close();
    this.socket = null;
    this.clearTimers();
    // The feed stays stale through the reconnect attempts, until a verified frame arrives.
    this.setFeed("stale");
    if (!this.reported) this.deps.onProblem(reason);
    this.reported = true;
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, RECONNECT_MAX_MS);
    const reopen = () => {
      if (this.stopped) return;
      this.retry = this.deps.scheduler.setTimeout(() => void this.open(), delay);
    };
    if (signer !== undefined) void this.deps.trust.recheck(signer).then(reopen, reopen);
    else reopen();
  }
}
