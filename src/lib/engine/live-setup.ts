/** Tests only: a live client over a fake node, with the real verifier and the engine's known-answer vectors. */

import { type ClientEvent } from "./client";
import { LiveEngineClient } from "./live";
import { FakeNode, FakeScheduler, type SignedReply } from "./test-kit";
import { realVerifier, VECTORS, vectorResponse } from "./test-vectors";
import type { Verifier } from "./verifier";

export const OTHER = "0x00000000000000000000000000000000000000aa";
export const markets = vectorResponse("markets");
export const replyOf = (v: typeof markets, overrides: Partial<SignedReply> = {}): SignedReply => ({
  status: v.status, body: v.body, signature: v.signature, timeMs: v.time_ms, seq: v.head_seq, ...overrides,
});

/** The real verifier with, and without, the dev-only mock entry point. */
export const dev: Verifier = await realVerifier(true);
export const production: Verifier = await realVerifier(false);

const constant = (value: number) => () => value;

export function setup(options: { verifier?: Verifier; acceptsMock?: boolean; address?: () => string; challenge?: string; nowMs?: number | (() => number); chainId?: number } = {}) {
  const node = new FakeNode();
  node.attestation(options.address ?? (() => VECTORS.signer));
  node.signed("/v1/markets", () => replyOf(markets));
  const events: ClientEvent[] = [];
  const verifier = options.verifier ?? dev;
  const client = new LiveEngineClient({
    origin: "https://node.test", streamOrigin: "wss://node.test", chainId: options.chainId ?? 31337, vault: markets.vault, heartbeatMs: 5_000,
    loadVerifier: async () => verifier, manifests: [], acceptsMock: options.acceptsMock ?? true,
    fetch: node.fetch, openSocket: () => { throw new Error("no stream in these tests"); }, scheduler: new FakeScheduler(),
    nowMs: typeof options.nowMs === "function" ? options.nowMs : constant(options.nowMs ?? markets.time_ms), challenge: () => options.challenge ?? markets.challenge,
  });
  client.watch((event) => events.push(event));
  return { node, client, events };
}
