/** Tests for the live client's folds of the log's house state and the withdrawal queue's walked totals. */

import { describe, expect, it } from "vitest";

import { LiveEngineClient } from "./live";
import { checkpoint, command, frame, SET_PARAMS } from "./live-house-kit";
import { acceptAll, FakeNode, FakeScheduler, FakeSocket, settle } from "./test-kit";
import { VECTORS, vectorResponse } from "./test-vectors";

describe("the live client's house folds", () => {
  it("folds the set_params and checkpoint the stream carries, and walks the withdrawal queue's pages for their totals", async () => {
    const markets = vectorResponse("markets");
    const node = new FakeNode();
    node.attestation(() => VECTORS.signer);
    const page = (queue: object[], next: number | null, seq = 5) => ({ status: 200, body: JSON.stringify({ seq, queue, next }), signature: "0x", timeMs: 1, seq });
    const queueA = [{ position: 1, account: "0x00a1", amount: "10", remaining: "6", requested_seq: 2 }];
    const queueB = [{ position: 2, account: "0x00b2", amount: "3", remaining: "3", requested_seq: 4 }];
    node.signed("/v1/withdrawals?limit=200", () => page(queueA, 7));
    node.signed("/v1/withdrawals?limit=200&after=7", () => page(queueB, null));
    const sockets: FakeSocket[] = [];
    const live = new LiveEngineClient({
      origin: "https://node.test", streamOrigin: "wss://node.test", chainId: 31337, vault: markets.vault, heartbeatMs: 5_000,
      loadVerifier: async () => acceptAll, manifests: [], acceptsMock: true, fetch: node.fetch,
      openSocket: (url) => { const socket = new FakeSocket(url); sockets.push(socket); return socket; },
      scheduler: new FakeScheduler(), nowMs: () => 1, challenge: () => "ab".repeat(32),
    });
    const stop = live.subscribe(() => {});
    await settle();
    const stream = sockets[0];
    if (!stream) throw new Error("no stream socket");
    stream.open();
    await settle();
    stream.receive(frame(0, { type: "heartbeat", head: "2:0" }));
    stream.receive(frame(1, command(1, { type: "admin", ...SET_PARAMS })));
    stream.receive(frame(2, checkpoint(2)));
    await expect(live.houseParams()).resolves.toEqual({
      profitFeeBps: 1000, closeoutLevelBps: 5000, totalCapBps: 20000, totalCapFloor: 2_000_000_000_000_000n, seq: 1, fresh: "reading",
    });
    await expect(live.latestCheckpoint()).resolves.toEqual({ type: "checkpoint", offset: "2:1", seq: 2, root: `0x${"ab".repeat(32)}` });
    await expect(live.withdrawalTotals()).resolves.toEqual({ count: 2, remaining: 9_000_000_000n, seq: 5, complete: true, stable: true });
    // A second read within the walk's TTL reuses the answer instead of re-walking the queue's pages.
    await expect(live.withdrawalTotals()).resolves.toEqual({ count: 2, remaining: 9_000_000_000n, seq: 5, complete: true, stable: true });
    expect(node.requests.filter((r) => r.path.startsWith("/v1/withdrawals?limit=200"))).toHaveLength(2);
    stop();
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
    expect(capped).toEqual({ count: 25, remaining: 25_000_000_000n, seq: 29, complete: false, stable: false });
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
    await expect(live.withdrawalTotals()).rejects.toThrow("waiting to retry");
    expect(walked()).toBe(3);
    // Past the backoff the next read walks again.
    now = 63_000;
    fail = false;
    await expect(live.withdrawalTotals()).resolves.toEqual({ count: 0, remaining: 0n, seq: 1, complete: true, stable: true });
    expect(walked()).toBe(4);
  });
});
