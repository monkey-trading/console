/** Tests only: a fake node's HTTP routes, WebSocket, and timers for the live client. */

import { createHash } from "node:crypto";

import type { Scheduler, Socket } from "./live-stream";
import type { Verifier } from "./verifier";
import { CHALLENGE_HEADER, SEQ_HEADER, SIGNATURE_HEADER, TIME_HEADER } from "./wire";

const hex = (bytes: Buffer | Uint8Array) => `0x${Buffer.from(bytes).toString("hex")}`;

/** A node's mock attestation naming `address`, as `GET /v1/attestation` serves it: the bundle, its binding report data, and the mock quote. */
export function mockAttestation(address: string): string {
  const bundle = Buffer.concat([Buffer.from("engine.attestation.v1"), Buffer.from(address.slice(2), "hex"), Buffer.alloc(32, 1), Buffer.alloc(32, 2)]);
  const reportData = Buffer.concat([createHash("sha256").update(bundle).digest(), Buffer.alloc(32)]);
  return JSON.stringify({
    provider: "mock", enclave_address: address, config_sha256: hex(Buffer.alloc(32, 1)), tls_public_key_sha256: hex(Buffer.alloc(32, 2)),
    bundle: hex(bundle), report_data: hex(reportData), quote: hex(Buffer.concat([Buffer.from("MOCK-ATTESTATION-NOT-A-TEE:"), reportData])),
  });
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
  routes = new Map<string, (challenge: string | null) => Response>();

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname + url.search;
    const headers = new Headers(init?.headers);
    this.requests.push({ path, challenge: headers.get("X-Engine-Challenge") });
    const route = this.routes.get(path);
    return route ? route(headers.get("X-Engine-Challenge")) : new Response('{"error":"not found"}', { status: 404 });
  };

  attestation(address: () => string): void {
    this.routes.set("/v1/attestation", () => new Response(mockAttestation(address())));
  }

  signed(path: string, reply: () => SignedReply): void {
    // The node echoes the request's challenge, or 32 zero bytes when it sent none.
    this.routes.set(path, (challenge) => {
      const { status, body, signature, timeMs, seq } = reply();
      const echoed = challenge ?? "0".repeat(64);
      return new Response(body, { status, headers: { [SIGNATURE_HEADER]: signature, [TIME_HEADER]: String(timeMs), [SEQ_HEADER]: String(seq), [CHALLENGE_HEADER]: echoed } });
    });
  }
}

export class FakeSocket implements Socket {
  onopen: Socket["onopen"] = null;
  onmessage: Socket["onmessage"] = null;
  onclose: Socket["onclose"] = null;
  onerror: Socket["onerror"] = null;
  closed = false;
  /** The text frames the page sent, in order. */
  readonly sent: string[] = [];

  constructor(readonly url: string) {}

  close(): void {
    this.closed = true;
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.sent.push(String(data));
  }

  /** The connection opens, as the browser reports it. */
  open(): void {
    const handler = this.onopen as (() => void) | null;
    handler?.();
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

/** A verifier that accepts every answer, for tests of what the client does with an answer once it verifies. */
export const acceptAll: Verifier = {
  verifyAttestation: () => ({ ok: false, reason: "unused" }),
  verifyMockAttestation: () => ({ ok: true, enclave: { address: "0x0000000000000000000000000000000000000001", release: null, config: null } }),
  verifyResponse: (input) => ({ ok: true, response: { timeMs: Number(input.time) } }),
  openFrames: () => ({ verify: (text) => ({ ok: true, msg: (JSON.parse(text) as { msg: string }).msg }) }),
};
