/** Tests for the live client's walk of the public withdrawal queue's totals. */

import { describe, expect, it } from "vitest";

import { LiveEngineClient } from "./live";
import { QueueTotalsRetrying } from "./live-queue";
import { acceptAll, FakeNode, FakeScheduler, FakeSocket } from "./test-kit";
import { VECTORS, vectorResponse } from "./test-vectors";

describe("the live client's queue totals", () => {
  it("walks the withdrawal queue's pages for their totals", async () => {
    const markets = vectorResponse("markets");
    const node = new FakeNode();
    node.attestation(() => VECTORS.signer);
    const page = (queue: object[], next: number | null, seq = 5) => ({ status: 200, body: JSON.stringify({ seq, queue, next }), signature: "0x", timeMs: 1, seq });
    const queueA = [{ position: 1, account: "0x00a1", amount: "10", remaining: "3", requested_seq: 2 }];
    const queueB = [{ position: 2, account: "0x00b2", amount: "3", remaining: "6", requested_seq: 4 }];
    node.signed("/v1/withdrawals?limit=200", () => page(queueA, 7));
    node.signed("/v1/withdrawals?limit=200&after=7", () => page(queueB, null));
    const live = new LiveEngineClient({
      origin: "https://node.test", streamOrigin: "wss://node.test", chainId: 31337, vault: markets.vault, heartbeatMs: 5_000,
      loadVerifier: async () => acceptAll, manifests: [], acceptsMock: true, fetch: node.fetch,
      openSocket: (url) => new FakeSocket(url), scheduler: new FakeScheduler(), nowMs: () => 1, challenge: () => "ab".repeat(32),
    });
    await expect(live.withdrawalTotals()).resolves.toEqual({ count: 2, remaining: 9_000_000_000n, largest: 6_000_000_000n, head: 3_000_000_000n, seq: 5, complete: true, stable: true });
    // A second read within the walk's TTL reuses the answer instead of re-walking the queue's pages.
    await expect(live.withdrawalTotals()).resolves.toEqual({ count: 2, remaining: 9_000_000_000n, largest: 6_000_000_000n, head: 3_000_000_000n, seq: 5, complete: true, stable: true });
    expect(node.requests.filter((r) => r.path.startsWith("/v1/withdrawals?limit=200"))).toHaveLength(2);
  });

  it("reports a lower bound at the walk's page cap, flags pages from different log seqs, and re-walks after the cache expires", async () => {
    const markets = vectorResponse("markets");
    const node = new FakeNode();
    node.attestation(() => VECTORS.signer);
    const entry = [{ position: 1, account: "0x00a1", amount: "1", remaining: "1", requested_seq: 1 }];
    let now = 0;
    let seq = 5;
    const page = (next: number | null) => ({ status: 200, body: JSON.stringify({ seq: seq++, queue: entry, next }), signature: "0x", timeMs: 1, seq: 0 });
    const walkRequests = () => node.requests.filter((r) => r.path.startsWith("/v1/withdrawals?limit=200"));
    const live = new LiveEngineClient({
      origin: "https://node.test", streamOrigin: "wss://node.test", chainId: 31337, vault: markets.vault, heartbeatMs: 5_000,
      loadVerifier: async () => acceptAll, manifests: [], acceptsMock: true, fetch: node.fetch,
      openSocket: (url) => new FakeSocket(url), scheduler: new FakeScheduler(), nowMs: () => now, challenge: () => "ab".repeat(32),
    });
    // A queue longer than the walk's page cap reports a lower bound.
    node.signed("/v1/withdrawals?limit=200", () => page(1));
    for (let after = 1; after <= 24; after++) node.signed(`/v1/withdrawals?limit=200&after=${after}`, () => page(after + 1));
    const capped = await live.withdrawalTotals();
    expect(capped).toEqual({ count: 25, remaining: 25_000_000_000n, largest: 1_000_000_000n, head: 1_000_000_000n, seq: 29, complete: false, stable: false });
    // Pages answered at different log seqs are not one snapshot, which the walk says so.
    expect(capped.stable).toBe(false);
    expect(walkRequests()).toHaveLength(25);
    // Within the cache's TTL the answer is reused; at its expiry the next read walks again.
    node.routes.clear();
    seq = 5;
    node.signed("/v1/withdrawals?limit=200", () => page(null));
    const walked = walkRequests().length;
    await live.withdrawalTotals();
    expect(walkRequests()).toHaveLength(walked);
    now = 15_000;
    await live.withdrawalTotals();
    expect(walkRequests()).toHaveLength(walked + 1);
  });

  it("keeps failing through the backoff instead of serving an expired cache as success", async () => {
    const markets = vectorResponse("markets");
    const node = new FakeNode();
    node.attestation(() => VECTORS.signer);
    let now = 0;
    let fail = false;
    node.signed("/v1/withdrawals?limit=200", () =>
      fail
        ? { status: 500, body: '{"error":"queue down"}', signature: "0x", timeMs: now, seq: 1 }
        : { status: 200, body: JSON.stringify({ seq: 1, queue: [], next: null }), signature: "0x", timeMs: now, seq: 1 },
    );
    const live = new LiveEngineClient({
      origin: "https://node.test", streamOrigin: "wss://node.test", chainId: 31337, vault: markets.vault, heartbeatMs: 5_000,
      loadVerifier: async () => acceptAll, manifests: [], acceptsMock: true, fetch: node.fetch,
      openSocket: (url) => new FakeSocket(url), scheduler: new FakeScheduler(), nowMs: () => now, challenge: () => "ab".repeat(32),
    });
    const walked = () => node.requests.filter((r) => r.path.startsWith("/v1/withdrawals?limit=200")).length;
    // A walk succeeds and caches its answer; past the cache's TTL the next read walks again.
    await expect(live.withdrawalTotals()).resolves.toMatchObject({ complete: true });
    now = 16_000;
    await expect(live.withdrawalTotals()).resolves.toMatchObject({ complete: true });
    expect(walked()).toBe(2);
    // Past that cache's TTL the next read walks into a failure: through the backoff every read
    // rejects, though the earlier answer is retained, so retained figures keep their failure warning.
    now = 32_000;
    fail = true;
    await expect(live.withdrawalTotals()).rejects.toThrow("queue down");
    now = 33_000;
    // The backoff wait rejects with its own marker, not a fresh failure, so a caller can keep the
    // original failure latched instead of alternating the two messages.
    await expect(live.withdrawalTotals()).rejects.toBeInstanceOf(QueueTotalsRetrying);
    await expect(live.withdrawalTotals()).rejects.toThrow("waiting to retry");
    expect(walked()).toBe(3);
    // Past the backoff the next read walks again.
    now = 63_000;
    fail = false;
    await expect(live.withdrawalTotals()).resolves.toEqual({ count: 0, remaining: 0n, largest: null, head: null, seq: 1, complete: true, stable: true });
    expect(walked()).toBe(4);
  });
});
