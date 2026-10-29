/** Tests for the signed stream: ordering, tampering, staleness, resumption and a changed enclave. */

import { beforeAll, describe, expect, it } from "vitest";

import type { FeedStatus } from "./attestation";
import { LiveStream, STALE_AFTER_INTERVALS } from "./live-stream";
import { acceptAll, FakeScheduler, FakeSocket, mockAttestation, settle } from "./test-kit";
import { NodeTrust } from "./trust";
import type { MarketQuote, SignedWithdrawal, StreamMessage } from "./types";
import type { FrameConnection, Verifier } from "./verifier";
import { realVerifier, VECTORS, vectorConnection } from "./test-vectors";

const connection = vectorConnection("three frames");
const HEARTBEAT_MS = 5_000;
let real: Verifier;
beforeAll(async () => {
  real = await realVerifier();
});
const OTHER = "0x00000000000000000000000000000000000000aa";

function setup(options: { address?: () => string; clockMs?: number; accept?: boolean } = {}) {
  const scheduler = new FakeScheduler();
  const sockets: FakeSocket[] = [];
  const messages: StreamMessage[] = [];
  const feeds: FeedStatus[] = [];
  const problems: string[] = [];
  const opened: FrameConnection[] = [];
  const quotes: MarketQuote[] = [];
  const quoteErrors: string[] = [];
  const withdrawals: SignedWithdrawal[] = [];
  // The vectors were opened with `after` first in the query; the client's own path is checked below, and the real verifier checks the vector's.
  const verifier: Verifier = options.accept
    ? acceptAll
    : { ...real, openFrames: (c) => { opened.push(c); return real.openFrames({ ...c, pathAndQuery: connection.path_and_query }); } };
  const address = options.address ?? (() => VECTORS.signer);
  const trust = new NodeTrust({
    attestation: async () => mockAttestation(address()), collateral: async () => null, verifier: async () => verifier, manifests: [], acceptsMock: true, nowMs: () => 0, onStatus: () => {}, onEnclaveChanged: () => {},
  });
  const stream = new LiveStream({
    origin: "wss://node.test", chainId: connection.chain_id, vault: connection.vault, heartbeatMs: HEARTBEAT_MS, verifier: () => verifier, trust,
    openSocket: (url) => { const socket = new FakeSocket(url); sockets.push(socket); return socket; },
    scheduler, nowMs: () => options.clockMs ?? connection.frames[0]?.time ?? 0, challenge: () => connection.challenge,
    onMessage: (m) => messages.push(m), onFeed: (f) => feeds.push(f), onProblem: (p) => problems.push(p),
    onQuote: (q) => quotes.push(q), onQuoteError: (e) => quoteErrors.push(e), onWithdrawal: (w) => withdrawals.push(w),
  });
  return { stream, sockets, messages, feeds, problems, scheduler, opened, quotes, quoteErrors, withdrawals };
}

const send = (socket: FakeSocket | undefined, ...indexes: number[]) => {
  for (const i of indexes) socket?.receive(JSON.stringify(connection.frames[i]));
};

async function started(options?: Parameters<typeof setup>[0]) {
  const t = setup(options);
  t.stream.start();
  await settle();
  return t;
}

describe("a signed stream", () => {
  it("opens with signed=1 and a fresh challenge, delivers each verified command once, and goes live on the first frame", async () => {
    const t = await started();
    expect(t.sockets[0]?.url).toBe(`wss://node.test/v1/stream?signed=1&challenge=${connection.challenge}`);
    expect(t.opened[0]).toMatchObject({ signer: VECTORS.signer, pathAndQuery: `/v1/stream?signed=1&challenge=${connection.challenge}` });
    expect(t.feeds).toEqual([]);
    send(t.sockets[0], 0, 1, 2);
    expect(t.messages.map((m) => m.offset)).toEqual(["1205:0", "1206:0"]);
    expect(t.feeds).toEqual(["live"]);
  });

  it("drops the connection at a gap in n, delivering nothing past it", async () => {
    const t = await started();
    send(t.sockets[0], 0, 2);
    expect(t.messages).toEqual([]);
    expect(t.sockets[0]?.closed).toBe(true);
    expect(t.problems[0]).toContain("expected frame 1 but received 2");
    expect(t.feeds.at(-1)).toBe("stale");
  });

  it("drops the connection on a repeated frame", async () => {
    const t = await started();
    send(t.sockets[0], 0, 1, 1);
    expect(t.messages).toHaveLength(1);
    expect(t.sockets[0]?.closed).toBe(true);
  });

  it("drops the connection on a frame whose message was altered, and delivers nothing from it", async () => {
    const t = await started();
    const altered = { ...connection.frames[1], msg: (connection.frames[1]?.msg ?? "").replace("1205", "1999") };
    send(t.sockets[0], 0);
    t.sockets[0]?.receive(JSON.stringify(altered));
    expect(t.messages).toEqual([]);
    expect(t.problems[0]).toContain("did not verify");
    expect(t.feeds.at(-1)).toBe("stale");
  });

  it("drops the connection on a frame that is not a signed envelope", async () => {
    const t = await started();
    t.sockets[0]?.receive('{"type":"command"}');
    expect(t.problems[0]).toContain("not a signed envelope");
    t.sockets[0]?.receive("");
    expect(t.messages).toEqual([]);
  });

  it("drops the connection when the device clock is far from the frames' signed time", async () => {
    const t = await started({ clockMs: (connection.frames[0]?.time ?? 0) + 31_000 });
    send(t.sockets[0], 0);
    expect(t.problems[0]).toContain("clock");
    expect(t.feeds.at(-1)).toBe("stale");
  });
});

describe("a stale feed", () => {
  it("goes stale after three heartbeat intervals without a valid frame, and recovers on a fresh connection", async () => {
    const t = await started();
    send(t.sockets[0], 0);
    expect(t.feeds.at(-1)).toBe("live");
    t.scheduler.advance(HEARTBEAT_MS * STALE_AFTER_INTERVALS - 1);
    expect(t.feeds.at(-1)).toBe("live");
    t.scheduler.advance(1);
    expect(t.feeds.at(-1)).toBe("stale");
    expect(t.sockets[0]?.closed).toBe(true);
    t.scheduler.advance(1_000);
    await settle();
    expect(t.sockets).toHaveLength(2);
    send(t.sockets[1], 0);
    expect(t.feeds.at(-1)).toBe("live");
  });

  it("stays stale through every reconnect attempt, and reports one outage once", async () => {
    const t = await started();
    send(t.sockets[0], 0);
    t.sockets[0]?.drop("close");
    // Different reasons in one outage are still one report.
    for (const how of ["error", "close", "error"] as const) {
      t.scheduler.advance(15_000);
      await settle();
      t.sockets.at(-1)?.drop(how);
    }
    expect(t.sockets.length).toBeGreaterThan(3);
    expect(t.feeds).toEqual(["live", "stale"]);
    expect(t.problems).toEqual(["The connection to the node closed."]);
    t.scheduler.advance(15_000);
    await settle();
    send(t.sockets.at(-1), 0);
    expect(t.feeds).toEqual(["live", "stale", "live"]);
  });

  it("counts a heartbeat as life, so a quiet market is not a stale feed, and goes stale when the heartbeats stop", async () => {
    const t = await started({ accept: true, clockMs: 1 });
    const heartbeat = (n: number) => t.sockets[0]?.receive(JSON.stringify({ v: 1, n, time: 1, msg: '{"type":"heartbeat","head":null}', sig: "0x" }));
    // Heartbeats alone, across more than three intervals, keep the feed live (the verifier here accepts any signature).
    for (let n = 0; n < 6; n++) {
      heartbeat(n);
      t.scheduler.advance(HEARTBEAT_MS * 2);
    }
    expect(t.feeds).toEqual(["live"]);
    expect(t.messages).toEqual([]);
    t.scheduler.advance(HEARTBEAT_MS * STALE_AFTER_INTERVALS);
    expect(t.feeds.at(-1)).toBe("stale");
  });

  it("reopens at the live end, never replaying from an old offset, with a delay that doubles while it keeps failing", async () => {
    const t = await started();
    send(t.sockets[0], 0, 1);
    t.sockets[0]?.drop("close");
    t.scheduler.advance(999);
    await settle();
    expect(t.sockets).toHaveLength(1);
    t.scheduler.advance(1);
    await settle();
    expect(t.sockets[1]?.url).toBe(`wss://node.test/v1/stream?signed=1&challenge=${connection.challenge}`);
    t.sockets[1]?.drop("error");
    t.scheduler.advance(1_999);
    await settle();
    expect(t.sockets).toHaveLength(2);
    t.scheduler.advance(1);
    await settle();
    expect(t.sockets).toHaveLength(3);
  });

  it("opens nothing when stopped while a recheck is pending", async () => {
    let address = OTHER;
    const t = await started({ address: () => address });
    address = VECTORS.signer;
    send(t.sockets[0], 0);
    t.stream.stop();
    await settle();
    t.scheduler.advance(60_000);
    await settle();
    expect(t.sockets).toHaveLength(1);
  });

  it("stops for good when stopped, and ignores a late frame from the closed socket", async () => {
    const t = await started();
    t.stream.stop();
    send(t.sockets[0], 0, 1);
    t.scheduler.advance(60_000);
    await settle();
    expect(t.messages).toEqual([]);
    expect(t.sockets).toHaveLength(1);
    expect(t.sockets[0]?.closed).toBe(true);
  });
});

describe("a changed enclave", () => {
  it("rejects frames signed under an address other than the attested one", async () => {
    const t = await started({ address: () => OTHER });
    send(t.sockets[0], 0);
    expect(t.messages).toEqual([]);
    expect(t.problems[0]).toContain("did not verify");
  });

  it("verifies the node again after a failed frame and carries on under the new address", async () => {
    let address = OTHER;
    const t = await started({ address: () => address });
    address = VECTORS.signer;
    send(t.sockets[0], 0);
    await settle();
    t.scheduler.advance(1_000);
    await settle();
    send(t.sockets[1], 0, 1);
    expect(t.messages.map((m) => m.offset)).toEqual(["1205:0"]);
    expect(t.feeds.at(-1)).toBe("live");
  });
});
