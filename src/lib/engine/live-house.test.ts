/** Tests for the one-off signed log scan that reads the house's parameters and the latest checkpoint from the log, and the live client's folds of them. */

import { describe, expect, it } from "vitest";

import { LiveEngineClient } from "./live";
import { HouseLog, scanHouse, type HouseScanBudget } from "./live-house";
import { acceptAll, FakeNode, FakeScheduler, FakeSocket, settle } from "./test-kit";
import { VECTORS, vectorResponse } from "./test-vectors";

const conflict = vectorResponse("nonce conflict");
const frame = (n: number, msg: object) => JSON.stringify({ v: 1, n, time: 1_000, msg: JSON.stringify(msg), sig: "0x00" });

const SET_PARAMS = { action: "set_params", profit_fee_bps: 1000, closeout_level_bps: 5000, house_total_cap_bps: 20000, house_total_cap_floor: "2000000" };
const PARAMS_FIELDS = { profit_fee_bps: 1000, closeout_level_bps: 5000, house_total_cap_bps: 20000, house_total_cap_floor: "2000000" };

const command = (seq: number, cmd: object, events: object[] = []) => ({ offset: `${seq}:0`, type: "command", seq, ts: 1_000, cmd, events });
const checkpoint = (seq: number, index = 1) => ({ type: "checkpoint", offset: `${seq}:${index}`, seq, root: `0x${"ab".repeat(32)}` });

const BUDGET: HouseScanBudget = { maxMessages: 100, maxMs: 30_000 };

function scanning(sockets: FakeSocket[]) {
  const scheduler = new FakeScheduler();
  const deps = {
    origin: "wss://node.test", chainId: 31337, vault: conflict.vault, signer: VECTORS.signer, verifier: acceptAll,
    openSocket: (url: string) => { const socket = new FakeSocket(url); sockets.push(socket); return socket; },
    scheduler, challenge: () => "ab".repeat(32),
  };
  const run = (fromSeq: number, budget: HouseScanBudget = BUDGET, skipPast?: [number, number]) => scanHouse(deps, fromSeq, budget, skipPast);
  return { run, scheduler };
}

describe("scanning the log for the house's state", () => {
  it("opens from the seq given, folds the latest applied set_params of either log shape and the latest checkpoint, and ends at the head a heartbeat names", async () => {
    const sockets: FakeSocket[] = [];
    const { run } = scanning(sockets);
    const found = run(40);
    await Promise.resolve();
    const socket = sockets[0];
    if (!socket) throw new Error("no socket");
    expect(socket.url).toBe(`wss://node.test/v1/stream?signed=1&challenge=${"ab".repeat(32)}&from=40`);
    socket.receive(frame(0, { type: "heartbeat", head: "45:0" }));
    socket.receive(frame(1, command(40, { type: "admin", ...SET_PARAMS, profit_fee_bps: 1500 })));
    socket.receive(frame(2, checkpoint(41)));
    socket.receive(frame(3, command(42, { type: "signed_admin", command: SET_PARAMS })));
    socket.receive(frame(4, checkpoint(43)));
    let settled = false;
    void found.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    socket.receive(frame(5, command(45, { type: "tick" })));
    socket.receive(frame(6, { type: "heartbeat", head: "45:0" }));
    await expect(found).resolves.toEqual({
      params: PARAMS_FIELDS,
      paramsSeq: 42,
      checkpoint: checkpoint(43),
      complete: true,
      last: [45, 0],
    });
    expect(socket.closed).toBe(true);
  });

  it("ignores a set_params the engine rejected, whose values never applied", async () => {
    const sockets: FakeSocket[] = [];
    const { run } = scanning(sockets);
    const found = run(40);
    await Promise.resolve();
    const socket = sockets[0];
    if (!socket) throw new Error("no socket");
    socket.receive(frame(0, command(40, { type: "admin", ...SET_PARAMS, profit_fee_bps: 1500 })));
    socket.receive(frame(1, command(41, { type: "signed_admin", command: SET_PARAMS }, [{ type: "admin_rejected", reason: "out of bounds" }])));
    socket.receive(frame(2, { type: "heartbeat", head: "41:0" }));
    await expect(found).resolves.toMatchObject({ params: { ...PARAMS_FIELDS, profit_fee_bps: 1500 }, paramsSeq: 40, complete: true });
  });

  it("stops at the message budget and answers with what it found, marked incomplete from the last entry read", async () => {
    const sockets: FakeSocket[] = [];
    const { run } = scanning(sockets);
    const found = run(40, { ...BUDGET, maxMessages: 2 });
    await Promise.resolve();
    sockets[0]?.receive(frame(0, command(40, { type: "admin", ...SET_PARAMS })));
    sockets[0]?.receive(frame(1, checkpoint(41)));
    sockets[0]?.receive(frame(2, command(42, { type: "tick" })));
    await expect(found).resolves.toEqual({
      params: PARAMS_FIELDS,
      paramsSeq: 40,
      checkpoint: checkpoint(41),
      complete: false,
      last: [41, 1],
    });
  });

  it("resuming at the last sequence with skipPast re-reads it but folds only what follows, so a command's checkpoint is never skipped", async () => {
    const sockets: FakeSocket[] = [];
    const { run } = scanning(sockets);
    const first = run(40, { ...BUDGET, maxMessages: 1 });
    await Promise.resolve();
    sockets[0]?.receive(frame(0, command(40, { type: "tick" })));
    sockets[0]?.receive(frame(1, command(41, { type: "tick" })));
    await expect(first).resolves.toMatchObject({ complete: false, last: [40, 0] });
    const second = run(40, BUDGET, [40, 0]);
    await Promise.resolve();
    sockets[1]?.receive(frame(0, command(40, { type: "tick" })));
    sockets[1]?.receive(frame(1, command(41, { type: "admin", ...SET_PARAMS })));
    sockets[1]?.receive(frame(2, checkpoint(41, 1)));
    sockets[1]?.receive(frame(3, { type: "heartbeat", head: "41:1" }));
    await expect(second).resolves.toEqual({ params: PARAMS_FIELDS, paramsSeq: 41, checkpoint: checkpoint(41, 1), complete: true, last: [41, 1] });
  });

  it("rejects an out-of-order frame, and gives up when the budget's time runs out", async () => {
    const sockets: FakeSocket[] = [];
    const { run, scheduler } = scanning(sockets);
    const broken = run(40);
    await Promise.resolve();
    sockets[0]?.receive(frame(1, { type: "heartbeat", head: "45:0" }));
    await expect(broken).rejects.toThrow("skipped");
    const slow = run(40);
    await Promise.resolve();
    sockets[1]?.receive(frame(0, command(40, { type: "admin", ...SET_PARAMS })));
    sockets[1]?.receive(frame(1, checkpoint(41)));
    scheduler.advance(30_000);
    await expect(slow).resolves.toEqual({ params: PARAMS_FIELDS, paramsSeq: 40, checkpoint: checkpoint(41), complete: false, last: [41, 1] });
  });

  it("rejects a frame whose checkpoint or command the console does not know", async () => {
    const sockets: FakeSocket[] = [];
    const { run } = scanning(sockets);
    const found = run(40);
    await Promise.resolve();
    sockets[0]?.receive(frame(0, { type: "mystery", offset: "40:0" }));
    await expect(found).rejects.toThrow("does not know");
  });
});

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

  it("marks the parameters failed after a read that fails, and keeps what the stream folded", async () => {
    const sockets: FakeSocket[] = [];
    let attempts = 0;
    const log = new HouseLog(async () => {
      attempts++;
      throw new Error("refused");
    });
    log.kick();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(attempts).toBe(1);
    expect(log.params).toBeNull();
    expect(sockets).toHaveLength(0);
    // A fold from the live stream is still surfaced, marked failed since catch-up never completed.
    log.foldParams(1, PARAMS_FIELDS);
    expect(log.params?.fresh).toBe("failed");
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
