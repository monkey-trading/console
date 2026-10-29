/** Tests only: a fake node's HTTP routes, WebSocket, and timers for the live client. */

import type { Scheduler, Socket } from "./live-stream";
import type { Attestation } from "./types";
import { SEQ_HEADER, SIGNATURE_HEADER, TIME_HEADER } from "./wire";

const toHex = (text: string) => Array.from(text, (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");

/** A node's mock attestation naming `address`, as `GET /v1/attestation` serves it. */
export function mockAttestation(address: string): Attestation {
  return {
    provider: "mock", enclave_address: address, config_sha256: "0x1", tls_public_key_sha256: "0x2", bundle: "0x3", report_data: "0x4",
    quote: `0x${toHex("MOCK-ATTESTATION-NOT-A-TEE:")}00`,
  };
}

export interface SignedReply {
  status: number;
  body: string;
  signature: string;
  timeMs: number;
  seq: number;
}

/** A fake `fetch`: each route's handler answers one request, and the log records the paths and headers requested. */
export class FakeNode {
  readonly requests: { path: string; challenge: string | null }[] = [];
  routes = new Map<string, () => Response>();

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname + url.search;
    const headers = new Headers(init?.headers);
    this.requests.push({ path, challenge: headers.get("X-Engine-Challenge") });
    const route = this.routes.get(path);
    return route ? route() : new Response('{"error":"not found"}', { status: 404 });
  };

  attestation(address: () => string): void {
    this.routes.set("/v1/attestation", () => Response.json(mockAttestation(address())));
  }

  signed(path: string, reply: () => SignedReply): void {
    this.routes.set(path, () => {
      const { status, body, signature, timeMs, seq } = reply();
      return new Response(body, { status, headers: { [SIGNATURE_HEADER]: signature, [TIME_HEADER]: String(timeMs), [SEQ_HEADER]: String(seq) } });
    });
  }
}

export class FakeSocket implements Socket {
  onmessage: Socket["onmessage"] = null;
  onclose: Socket["onclose"] = null;
  onerror: Socket["onerror"] = null;
  closed = false;

  constructor(readonly url: string) {}

  close(): void {
    this.closed = true;
  }

  /** The connection closes or fails, as the browser reports it. */
  drop(event: "close" | "error"): void {
    const handler = (event === "close" ? this.onclose : this.onerror) as (() => void) | null;
    handler?.();
  }

  /** Delivers one text frame, as the browser would. */
  receive(data: string): void {
    // The page only reads `data`; a full MessageEvent adds nothing here.
    const handler = this.onmessage as ((event: { data: string }) => void) | null;
    handler?.({ data });
  }
}

/** Timers that run when the test advances the clock. */
export class FakeScheduler implements Scheduler {
  now = 0;
  private next = 1;
  private readonly timers = new Map<number, { at: number; run: () => void }>();

  setTimeout(run: () => void, ms: number): unknown {
    const id = this.next++;
    this.timers.set(id, { at: this.now + ms, run });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  /** Moves the clock forward, running each timer that falls due in order. */
  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.now = due[1].at;
      due[1].run();
    }
    this.now = end;
  }
}

/** Lets pending promise callbacks run. */
export const settle = async (): Promise<void> => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};
