/** Tests only: a live client over a fake node, with the real verifier and the engine's known-answer vectors. */

import type { Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";

import { type ClientEvent } from "./client";
import { LiveEngineClient } from "./live";
import { enclaveSigning, FakeNode, FakeScheduler, MOCK_ENCLAVE_KEY, type FakeSigning, type SignedReply } from "./test-kit";
import { realVerifier, VECTORS, vectorResponse } from "./test-vectors";
import type { Verifier } from "./verifier";

/** Another enclave's key, for a node that attests and signs as another enclave than the vectors' signer. */
const OTHER_KEY: Hex = `0x${"44".repeat(32)}`;
export const OTHER = privateKeyToAddress(OTHER_KEY).toLowerCase();
export const markets = vectorResponse("markets");
export const replyOf = (v: typeof markets, overrides: Partial<SignedReply> = {}): SignedReply => ({
  status: v.status, body: v.body, signature: v.signature, timeMs: v.time_ms, seq: v.head_seq, ...overrides,
});

/** The real verifier with, and without, the dev-only mock entry point. */
export const dev: Verifier = await realVerifier(true);
export const production: Verifier = await realVerifier(false);

const constant = (value: number) => () => value;

/** How the vectors' node signs the answers it makes up: for its own deployment, at the vectors' time, with the key of the enclave it attests. */
export const vectorSigning = (key: () => Hex = () => MOCK_ENCLAVE_KEY): FakeSigning => enclaveSigning({ chainId: markets.chain_id, vault: markets.vault }, () => markets.time_ms, key);

export function setup(options: { verifier?: Verifier; acceptsMock?: boolean; address?: () => string; challenge?: string; nowMs?: number | (() => number); chainId?: number } = {}) {
  const address = options.address ?? (() => VECTORS.signer);
  const node = new FakeNode(vectorSigning(() => (address() === OTHER ? OTHER_KEY : MOCK_ENCLAVE_KEY)));
  node.attestation(address);
  node.signed("/v1/markets", () => replyOf(markets));
  const events: ClientEvent[] = [];
  const verifier = options.verifier ?? dev;
  const client = new LiveEngineClient({
    origin: "https://node.test", streamOrigin: "wss://node.test", chainId: options.chainId ?? 31337, vault: markets.vault, heartbeatMs: 5_000,
    loadVerifier: async () => verifier, releases: [], acceptsMock: options.acceptsMock ?? true,
    fetch: node.fetch, openSocket: () => { throw new Error("no stream in these tests"); }, scheduler: new FakeScheduler(),
    nowMs: typeof options.nowMs === "function" ? options.nowMs : constant(options.nowMs ?? markets.time_ms), challenge: () => options.challenge ?? markets.challenge,
  });
  client.watch((event) => events.push(event));
  return { node, client, events };
}
