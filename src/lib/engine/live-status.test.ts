/** Tests for the server's operating state in the live client: the reads that tell an unsigned server from an unreachable one, and the stream's status frames. */

import { describe, expect, it } from "vitest";

import { EngineError, type ClientEvent } from "./client";
import { LiveEngineClient } from "./live";
import { STALE_STATUS_READ_MS, StatusWatch } from "./live-status";
import type { ServerRead, ServerStatus } from "./status-types";
import { acceptAll, FakeNode, FakeScheduler, FakeSocket, settle } from "./test-kit";
import { VECTORS } from "./test-vectors";
import { UnsignedAnswer } from "./trust-errors";

const STATUS: ServerStatus = {
  as_of_ms: 1_000, takes_orders: true, holds: [], trusted_time: { state: "sampled", last_sample_ms: 900 },
  venues: [{ venue: "coinbase", state: "down", symbols: [{ symbol: "BTC-USD", market: 1, state: "down" }] }],
  unpriced_markets: [{ market: 1, symbol: "BTC-USD", reason: "too_few_sources", fresh_sources: 1, min_sources: 2 }],
};

/** A watch whose reads answer, in turn, with each of `answers`: a status, or an error to reject with. */
function watching(...answers: (ServerStatus | Error)[]) {
  const scheduler = new FakeScheduler();
  const reports: (ServerRead | null)[] = [];
  let reads = 0;
  const trust = { held: true };
  const watch = new StatusWatch({
    trusted: () => trust.held,
    read: () => {
      const answer = answers[Math.min(reads++, answers.length - 1)];
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
    scheduler, report: (server) => reports.push(server),
  });
  return { watch, scheduler, reports, trust, reads: () => reads };
}

describe("a status read", () => {
  it.each([
    ["a signed answer is the server's state", STATUS, { kind: "signed", status: STATUS }, true],
    ["an unsigned answer says the server cannot currently be verified", new UnsignedAnswer("unsigned"), { kind: "unsigned" }, true],
    ["no answer says the server cannot be reached", new EngineError(0, "The server did not respond."), { kind: "unreachable" }, true],
    ["a signed 404 says the node predates the route, so the stream stops asking for its frames", new EngineError(404, "not found"), null, false],
    ["a signed refusal says nothing of the server's state", new EngineError(503, "busy"), null, true],
  ] as const)("%s", async (_, answer, report, frames) => {
    const t = watching(answer);
    await t.watch.read();
    expect(t.reports).toEqual([report]);
    await expect(t.watch.frames()).resolves.toBe(frames);
  });

  it("is read before each connection until the node has said whether it serves status frames, and not after", async () => {
    const t = watching(new UnsignedAnswer("unsigned"), new EngineError(0, "down"), STATUS, new UnsignedAnswer("unsigned"));
    await expect(t.watch.frames()).resolves.toBe(true);
    await expect(t.watch.frames()).resolves.toBe(true);
    await expect(t.watch.frames()).resolves.toBe(true);
    await expect(t.watch.frames()).resolves.toBe(true);
    expect(t.reads()).toBe(3);
    expect(t.reports).toEqual([{ kind: "unsigned" }, { kind: "unreachable" }, { kind: "signed", status: STATUS }]);
  });
});

describe("the stale stream's reads", () => {
  it("reads at once when the stream goes stale and again every interval, and stops once it is live", async () => {
    const t = watching(new EngineError(0, "down"), new UnsignedAnswer("unsigned"));
    t.watch.feed("stale");
    await settle();
    expect(t.reports).toEqual([{ kind: "unreachable" }]);
    t.scheduler.advance(STALE_STATUS_READ_MS - 1);
    await settle();
    expect(t.reads()).toBe(1);
    t.scheduler.advance(1);
    await settle();
    expect(t.reports).toEqual([{ kind: "unreachable" }, { kind: "unsigned" }]);
    t.watch.feed("live");
    t.scheduler.advance(STALE_STATUS_READ_MS * 3);
    await settle();
    expect(t.reads()).toBe(2);
    expect(t.scheduler.pending()).toBe(0);
  });

  it("reads nothing while the node is not trusted, as a read would start a check of its own", async () => {
    const t = watching(new UnsignedAnswer("unsigned"));
    t.trust.held = false;
    t.watch.feed("stale");
    t.scheduler.advance(STALE_STATUS_READ_MS);
    await settle();
    expect(t.reads()).toBe(0);
    t.trust.held = true;
    t.scheduler.advance(STALE_STATUS_READ_MS);
    await settle();
    expect(t.reports).toEqual([{ kind: "unsigned" }]);
  });

  it("drops a read that answers after the stream came back", async () => {
    const t = watching(new UnsignedAnswer("unsigned"));
    t.watch.feed("stale");
    t.watch.feed("live");
    await settle();
    expect(t.reports).toEqual([]);
    t.watch.frame(STATUS);
    expect(t.reports).toEqual([{ kind: "signed", status: STATUS }]);
  });
});

/** A client over a fake node whose verifier accepts every answer, with `/v1/status` answering `status`. */
function client(status: number, body: unknown) {
  const node = new FakeNode();
  node.attestation(() => VECTORS.signer);
  node.signed("/v1/status", () => ({ status, body: JSON.stringify(body), signature: "0x00", timeMs: 1_000, seq: 9 }));
  const sockets: FakeSocket[] = [];
  const scheduler = new FakeScheduler();
  const live = new LiveEngineClient({
    origin: "https://node.test", streamOrigin: "wss://node.test", chainId: 31337, vault: "0x00000000000000000000000000000000000000bb", heartbeatMs: 5_000,
    loadVerifier: async () => acceptAll, releases: [], acceptsMock: true, fetch: node.fetch,
    openSocket: (url) => { const socket = new FakeSocket(url); sockets.push(socket); return socket; },
    scheduler, nowMs: () => 1_000, challenge: () => "ab".repeat(32),
  });
  const servers: (ServerRead | null)[] = [];
  live.watch((event: ClientEvent) => { if (event.type === "server") servers.push(event.server); });
  return { node, live, sockets, scheduler, servers };
}

describe("the live client", () => {
  it("reads the status before its stream opens, asks the stream for status frames, and reports each one", async () => {
    const t = client(200, STATUS);
    t.live.subscribe(() => {});
    await settle();
    expect(t.servers).toEqual([{ kind: "signed", status: STATUS }]);
    expect(t.sockets[0]?.url).toBe(`wss://node.test/v1/stream?signed=1&status=1&challenge=${"ab".repeat(32)}`);
    const recovered = { ...STATUS, venues: [], unpriced_markets: [] };
    t.sockets[0]?.receive(JSON.stringify({ v: 1, n: 0, time: 1_000, msg: JSON.stringify({ type: "status", ...recovered }), sig: "0x00" }));
    expect(t.servers.at(-1)).toEqual({ kind: "signed", status: { type: "status", ...recovered } });
  });

  it("opens the stream without status frames for a node that predates them, and reads the status again once the stream fails", async () => {
    const t = client(404, { error: "not found" });
    t.live.subscribe(() => {});
    await settle();
    expect(t.sockets[0]?.url).toBe(`wss://node.test/v1/stream?signed=1&challenge=${"ab".repeat(32)}`);
    const reads = () => t.node.requests.filter((r) => r.path === "/v1/status").length;
    expect(reads()).toBe(1);
    t.sockets[0]?.drop("close");
    await settle();
    expect(reads()).toBe(2);
  });
});
