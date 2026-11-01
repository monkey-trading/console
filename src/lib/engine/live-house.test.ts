/** Tests for the house log fold's lifecycle and the live client's folds of it. */

import { describe, expect, it } from "vitest";

import { LiveEngineClient } from "./live";
import { HouseLog, scanHouse } from "./live-house";
import { checkpoint, command, conflict, frame, PARAMS_FIELDS, SET_PARAMS } from "./live-house-kit";
import { acceptAll, FakeNode, FakeScheduler, FakeSocket, settle } from "./test-kit";
import { VECTORS, vectorResponse } from "./test-vectors";

describe("the house log fold", () => {
  it("reads in chunks to the head, then stops kicking: a completed catch-up is not restarted by the next read", async () => {
    const sockets: FakeSocket[] = [];
    const scheduler = new FakeScheduler();
    const log = new HouseLog((fromSeq, skipPast) =>
      scanHouse({
        origin: "wss://node.test", chainId: 31337, vault: conflict.vault, signer: VECTORS.signer, verifier: acceptAll,
        openSocket: (url: string) => { const socket = new FakeSocket(url); sockets.push(socket); return socket; },
        scheduler, challenge: () => "ab".repeat(32),
      }, fromSeq, { maxMessages: 2, maxMs: 30_000 }, skipPast),
      () => 0,
    );
    log.kick();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    // Chunk 1 reads two entries and stops at its budget; chunk 2 resumes at the same sequence.
    sockets[0]?.receive(frame(0, command(0, { type: "admin", ...SET_PARAMS })));
    sockets[0]?.receive(frame(1, command(1, { type: "tick" })));
    sockets[0]?.receive(frame(2, command(2, { type: "tick" })));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    sockets[1]?.receive(frame(0, command(1, { type: "tick" })));
    sockets[1]?.receive(frame(1, checkpoint(2, 1)));
    sockets[1]?.receive(frame(2, { type: "heartbeat", head: "2:1" }));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(log.params?.fresh).toBe("current");
    expect(log.checkpoint).toEqual(checkpoint(2, 1));
    expect(sockets).toHaveLength(2);
    // Reads after the catch-up completed do not restart it.
    log.kick();
    await settle();
    expect(sockets).toHaveLength(2);
  });

  it("gives up on a position that keeps failing, marks the fold failed, and waits before retrying", async () => {
    let attempts = 0;
    let now = 0;
    const log = new HouseLog(async () => {
      attempts++;
      return { params: null, paramsSeq: null, checkpoint: null, complete: false, last: [0, 0] };
    }, () => now);
    log.kick();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(attempts).toBe(4); // the first read counts as progress; three stalled tries follow
    expect(log.params).toBeNull();
    expect(log.freshness).toBe("failed");
    // The retry wait holds further kicks until the clock passes it.
    log.kick();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(attempts).toBe(4);
    now = 31_000;
    log.kick();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(attempts).toBe(7);
  });

  it("marks the parameters failed after a read that fails, and keeps what the stream folded", async () => {
    const sockets: FakeSocket[] = [];
    let attempts = 0;
    const log = new HouseLog(async () => {
      attempts++;
      throw new Error("refused");
    }, () => 0);
    log.kick();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(attempts).toBe(1);
    expect(log.params).toBeNull();
    expect(log.freshness).toBe("failed");
    expect(sockets).toHaveLength(0);
    // A fold from the live stream is still surfaced, marked failed since catch-up never completed.
    log.foldParams(1, PARAMS_FIELDS);
    expect(log.params?.fresh).toBe("failed");
  });

  it("advances the cursor on every incomplete chunk that made progress, across many chunks", async () => {
    const sockets: FakeSocket[] = [];
    const scheduler = new FakeScheduler();
    const log = new HouseLog((fromSeq, skipPast) =>
      scanHouse({
        origin: "wss://node.test", chainId: 31337, vault: conflict.vault, signer: VECTORS.signer, verifier: acceptAll,
        openSocket: (url: string) => { const socket = new FakeSocket(url); sockets.push(socket); return socket; },
        scheduler, challenge: () => "ab".repeat(32),
      }, fromSeq, { maxMessages: 2, maxMs: 30_000 }, skipPast),
      () => 0,
    );
    log.kick();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    // Three advancing chunks: each re-reads the cursor's entry, reads one past it, then its budget cuts it short.
    sockets[0]?.receive(frame(0, command(0, { type: "admin", ...SET_PARAMS, profit_fee_bps: 500 })));
    sockets[0]?.receive(frame(1, command(1, { type: "tick" })));
    sockets[0]?.receive(frame(2, command(2, { type: "tick" })));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    sockets[1]?.receive(frame(0, command(1, { type: "tick" })));
    sockets[1]?.receive(frame(1, command(2, { type: "tick" })));
    sockets[1]?.receive(frame(2, command(3, { type: "tick" })));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(sockets).toHaveLength(3);
    sockets[2]?.receive(frame(0, command(2, { type: "tick" })));
    sockets[2]?.receive(frame(1, command(3, { type: "admin", ...SET_PARAMS, profit_fee_bps: 750 })));
    sockets[2]?.receive(frame(2, { type: "heartbeat", head: "3:0" }));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(log.params?.fresh).toBe("current");
    expect(log.params?.profitFeeBps).toBe(750);
  });

  it("an uncaught during a read keeps the fold not-current: the read in flight cannot claim completion", async () => {
    const sockets: FakeSocket[] = [];
    const scheduler = new FakeScheduler();
    const log = new HouseLog((fromSeq, skipPast) =>
      scanHouse({
        origin: "wss://node.test", chainId: 31337, vault: conflict.vault, signer: VECTORS.signer, verifier: acceptAll,
        openSocket: (url: string) => { const socket = new FakeSocket(url); sockets.push(socket); return socket; },
        scheduler, challenge: () => "ab".repeat(32),
      }, fromSeq, { maxMessages: 50, maxMs: 30_000 }, skipPast),
      () => 0,
    );
    log.kick();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    sockets[0]?.receive(frame(0, command(0, { type: "admin", ...SET_PARAMS })));
    log.uncaught(); // as a stream failure does: the chunk in flight must not restore "current"
    sockets[0]?.receive(frame(1, { type: "heartbeat", head: "0:0" }));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(log.freshness).toBe("reading");
    // The next read resumes catch-up and only then counts the fold current.
    log.kick();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    sockets[1]?.receive(frame(0, command(0, { type: "admin", ...SET_PARAMS })));
    sockets[1]?.receive(frame(1, { type: "heartbeat", head: "0:0" }));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(log.params?.fresh).toBe("current");
  });

  it("stands a running catch-up down when cancelled: the read in flight claims nothing, and the next read resumes it", async () => {
    const sockets: FakeSocket[] = [];
    const scheduler = new FakeScheduler();
    const log = new HouseLog((fromSeq, skipPast) =>
      scanHouse({
        origin: "wss://node.test", chainId: 31337, vault: conflict.vault, signer: VECTORS.signer, verifier: acceptAll,
        openSocket: (url: string) => { const socket = new FakeSocket(url); sockets.push(socket); return socket; },
        scheduler, challenge: () => "ab".repeat(32),
      }, fromSeq, { maxMessages: 2, maxMs: 30_000 }, skipPast),
      () => 0,
    );
    log.kick();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    sockets[0]?.receive(frame(0, command(0, { type: "admin", ...SET_PARAMS })));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    log.cancel();
    sockets[0]?.receive(frame(1, command(1, { type: "tick" })));
    sockets[0]?.receive(frame(2, command(2, { type: "tick" }))); // the budget cut ends the chunk incomplete
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(sockets[0]?.closed).toBe(true);
    expect(sockets).toHaveLength(1);
    // The cancelled chunk claimed nothing; the next read resumes from where the read stood.
    expect(log.params).toBeNull();
    log.kick();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(sockets).toHaveLength(2);
    sockets[1]?.receive(frame(0, command(0, { type: "admin", ...SET_PARAMS })));
    sockets[1]?.receive(frame(1, { type: "heartbeat", head: "0:0" }));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(log.params?.profitFeeBps).toBe(1000);
  });
});

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
});
