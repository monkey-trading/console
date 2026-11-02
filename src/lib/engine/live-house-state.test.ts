/** Tests for the live client's read of `GET /v1/house/state` and the stream values folded beside it. */

import { describe, expect, it } from "vitest";

import { EngineError } from "./client";
import { LiveEngineClient } from "./live";
import { acceptAll, FakeNode, FakeScheduler, FakeSocket, settle } from "./test-kit";
import { VECTORS, vectorResponse } from "./test-vectors";

const conflict = vectorResponse("nonce conflict");
const ROOT = `0x${"ab".repeat(32)}`;
const WIRE_PARAMS = { seq: 12, profit_fee_bps: 1000, closeout_level_bps: 5000, house_total_cap_bps: 3000, house_total_cap_floor: "50000", stress_levels: [] };
const wireCheckpoint = (seq: number) => ({ offset: `${seq}:1`, type: "checkpoint", seq, root: ROOT, signature: "0x11", signer: "0x22", parent: "0x33", domain: "d", deferred_withdrawals: false });
const frame = (n: number, msg: object) => JSON.stringify({ v: 1, n, time: 1_000, msg: JSON.stringify(msg), sig: "0x00" });
const setParams = (seq: number, profitFeeBps: number) => ({
  offset: `${seq}:0`, type: "command", seq, ts: 1_000, events: [],
  cmd: { type: "admin", action: "set_params", profit_fee_bps: profitFeeBps, closeout_level_bps: 5000, house_total_cap_bps: 3000, house_total_cap_floor: "50000" },
});

/** A client over a node whose `/v1/house/state` answer the test sets, with the stream's socket in `sockets`. */
function house() {
  const node = new FakeNode();
  node.attestation(() => VECTORS.signer);
  const sockets: FakeSocket[] = [];
  const client = new LiveEngineClient({
    origin: "https://node.test", streamOrigin: "wss://node.test", chainId: 31337, vault: conflict.vault, heartbeatMs: 5_000,
    loadVerifier: async () => acceptAll, manifests: [], acceptsMock: true, fetch: node.fetch,
    openSocket: (url) => { const socket = new FakeSocket(url); sockets.push(socket); return socket; },
    scheduler: new FakeScheduler(), nowMs: () => 1_000, challenge: () => "ab".repeat(32),
  });
  const reply = (status: number, body: unknown) => node.signed("/v1/house/state", () => ({ status, body: JSON.stringify(body), signature: "0x00", timeMs: 1_000, seq: 9 }));
  /** Opens the stream and returns a sender of its signed frames. */
  const stream = async () => {
    client.subscribe(() => {});
    await settle();
    const socket = sockets[0];
    if (!socket) throw new Error("no stream socket");
    socket.open();
    await settle();
    let n = 0;
    return (msg: object) => socket.receive(frame(n++, msg));
  };
  return { node, client, reply, stream };
}

describe("reading the house state", () => {
  it("answers the parameters and checkpoint in one read, with the floor as a fixed-point amount", async () => {
    const { node, client, reply } = house();
    reply(200, { seq: 946_000, params: WIRE_PARAMS, checkpoint: wireCheckpoint(945_999) });
    await expect(client.houseState()).resolves.toEqual({
      seq: 946_000,
      params: { profitFeeBps: 1000, closeoutLevelBps: 5000, totalCapBps: 3000, totalCapFloor: 50_000_000_000_000n, seq: 12 },
      checkpoint: wireCheckpoint(945_999),
    });
    expect(node.requests.filter((r) => r.path === "/v1/house/state")).toHaveLength(1);
  });

  it("answers an empty log with no parameters and no checkpoint", async () => {
    const { client, reply } = house();
    reply(200, { seq: null, params: null, checkpoint: null });
    await expect(client.houseState()).resolves.toEqual({ seq: null, params: null, checkpoint: null });
  });

  it("reads a floor the node left out as zero", async () => {
    const { client, reply } = house();
    const noFloor: Record<string, unknown> = { ...WIRE_PARAMS };
    delete noFloor["house_total_cap_floor"];
    reply(200, { seq: 20, params: noFloor, checkpoint: null });
    await expect(client.houseState()).resolves.toMatchObject({ params: { totalCapFloor: 0n, seq: 12 } });
  });

  it("keeps a null params seq, which a restore from an older snapshot leaves", async () => {
    const { client, reply } = house();
    reply(200, { seq: 20, params: { ...WIRE_PARAMS, seq: null }, checkpoint: null });
    await expect(client.houseState()).resolves.toMatchObject({ seq: 20, params: { profitFeeBps: 1000, seq: null } });
  });

  it("answers null from a node that predates the route, and rejects any other failure", async () => {
    const { client, reply } = house();
    reply(404, { error: "not found" });
    await expect(client.houseState()).resolves.toBeNull();
    reply(500, { error: "node down" });
    await expect(client.houseState()).rejects.toBeInstanceOf(EngineError);
  });
});

describe("the stream beside the read", () => {
  it("shows a checkpoint the stream carried after the read, and keeps the read's when the stream's is older", async () => {
    const { client, reply, stream } = house();
    reply(200, { seq: 100, params: WIRE_PARAMS, checkpoint: wireCheckpoint(100) });
    const send = await stream();
    send(wireCheckpoint(110));
    await expect(client.houseState()).resolves.toMatchObject({ checkpoint: { seq: 110 } }); // newer than the read's 100
    send(wireCheckpoint(90));
    await expect(client.houseState()).resolves.toMatchObject({ checkpoint: { seq: 110 } }); // older: never moves it back
    reply(200, { seq: 130, params: WIRE_PARAMS, checkpoint: wireCheckpoint(120) });
    await expect(client.houseState()).resolves.toMatchObject({ checkpoint: { seq: 120 } }); // a newer read replaces the stream's
  });

  it("shows a set_params the stream carried after the read, and keeps the read's when the stream's is older", async () => {
    const { client, reply, stream } = house();
    reply(200, { seq: 100, params: WIRE_PARAMS, checkpoint: null });
    const send = await stream();
    send(setParams(105, 1200));
    await expect(client.houseState()).resolves.toMatchObject({ params: { profitFeeBps: 1200, seq: 105 } });
    send(setParams(8, 900)); // older than both
    await expect(client.houseState()).resolves.toMatchObject({ params: { profitFeeBps: 1200, seq: 105 } });
    // A read at 100 predates the stream's value and does not replace it.
    reply(200, { seq: 104, params: { ...WIRE_PARAMS, profit_fee_bps: 1000 }, checkpoint: null });
    await expect(client.houseState()).resolves.toMatchObject({ params: { profitFeeBps: 1200, seq: 105 } });
  });

  it("compares a null params seq at the read's log head", async () => {
    const { client, reply, stream } = house();
    reply(200, { seq: 100, params: { ...WIRE_PARAMS, seq: null }, checkpoint: null });
    const send = await stream();
    await client.houseState();
    send(setParams(95, 700)); // at or before the head the read already covers
    await expect(client.houseState()).resolves.toMatchObject({ params: { profitFeeBps: 1000, seq: null } });
    send(setParams(101, 800)); // after it
    await expect(client.houseState()).resolves.toMatchObject({ params: { profitFeeBps: 800, seq: 101 } });
  });
});
