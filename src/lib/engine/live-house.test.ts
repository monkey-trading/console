/** Tests for the house log fold's lifecycle and the live client's folds of it. */

import { describe, expect, it } from "vitest";

import { HouseLog, scanHouse } from "./live-house";
import { checkpoint, command, conflict, frame, PARAMS_FIELDS, SET_PARAMS } from "./live-house-kit";
import { acceptAll, FakeScheduler, FakeSocket, settle } from "./test-kit";
import { VECTORS } from "./test-vectors";

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

  it("a superseded run's failure does not mark the fold or re-arm the backoff", async () => {
    let attempts = 0;
    let now = 0;
    let fail = true;
    const log = new HouseLog(async () => {
      attempts++;
      if (fail) throw new Error("refused");
      return { params: PARAMS_FIELDS, paramsSeq: 0, checkpoint: null, complete: true, last: [0, 0] };
    }, () => now);
    log.kick();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(attempts).toBe(1);
    expect(log.freshness).toBe("failed");
    now = 31_000;
    log.kick(); // the retry runs, but its rejection has not settled yet
    log.uncaught(); // supersede it first: the rejection must not mark the fold or re-arm the backoff
    fail = false;
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(attempts).toBe(3); // the superseded run settled silently and the restart ran, succeeding
    expect(log.freshness).toBe("current");
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
    sockets[1]?.receive(frame(3, command(4, { type: "tick" })));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(sockets).toHaveLength(3);
    sockets[2]?.receive(frame(0, command(3, { type: "tick" })));
    sockets[2]?.receive(frame(1, command(4, { type: "admin", ...SET_PARAMS, profit_fee_bps: 750 })));
    sockets[2]?.receive(frame(2, { type: "heartbeat", head: "4:0" }));
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
    expect(sockets[0]?.closed).toBe(true); // the superseded chunk's socket closed instead of idling to its budget
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
