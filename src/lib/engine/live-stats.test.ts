/** Tests for the live client's dashboard reads: the exact routes and query parameters it asks the node for, and the refusals it surfaces. */

import { describe, expect, it } from "vitest";

import { EngineError } from "./client";
import { LiveEngineClient } from "./live";
import { acceptAll, FakeNode, FakeScheduler, FakeSocket } from "./test-kit";
import { VECTORS, vectorResponse } from "./test-vectors";

function client() {
  const node = new FakeNode();
  node.attestation(() => VECTORS.signer);
  const live = new LiveEngineClient({
    origin: "https://node.test", streamOrigin: "wss://node.test", chainId: 31337, vault: vectorResponse("markets").vault, heartbeatMs: 5_000,
    loadVerifier: async () => acceptAll, manifests: [], acceptsMock: true, fetch: node.fetch,
    openSocket: (url) => new FakeSocket(url), scheduler: new FakeScheduler(), nowMs: () => 1, challenge: () => "ab".repeat(32),
  });
  const reply = (path: string, status: number, body: object) => node.signed(path, () => ({ status, body: JSON.stringify(body), signature: "0x", timeMs: 1, seq: 1 }));
  return { node, live, reply };
}

describe("the live client's dashboard reads", () => {
  it("asks for a house-wide series without a market, and a per-market series with one", async () => {
    const { node, live, reply } = client();
    reply("/v1/stats/series?metric=nav&resolution=1m&from_ms=100&to_ms=200&limit=50", 200, { entries: [], next: null });
    reply("/v1/stats/series?metric=long&resolution=1h&from_ms=100&to_ms=200&limit=50&market=2", 200, { entries: [], next: null });
    await live.stats.series({ metric: "nav", market: null, resolution: "1m", fromMs: 100, toMs: 200, limit: 50 });
    await live.stats.series({ metric: "long", market: 2, resolution: "1h", fromMs: 100, toMs: 200, limit: 50 });
    expect(node.requests.map((r) => r.path).filter((path) => path.startsWith("/v1/stats"))).toEqual([
      "/v1/stats/series?metric=nav&resolution=1m&from_ms=100&to_ms=200&limit=50",
      "/v1/stats/series?metric=long&resolution=1h&from_ms=100&to_ms=200&limit=50&market=2",
    ]);
  });

  it("asks for a market's positions and for the MONKEY totals", async () => {
    const { node, live, reply } = client();
    reply("/v1/house/positions?market=3", 200, { market: 3 });
    reply("/v1/monkey", 200, { seq: 1 });
    await expect(live.stats.positions(3)).resolves.toMatchObject({ market: 3 });
    await expect(live.stats.monkey()).resolves.toMatchObject({ seq: 1 });
    expect(node.requests.map((r) => r.path).filter((path) => !path.includes("attestation"))).toEqual(["/v1/house/positions?market=3", "/v1/monkey"]);
  });

  it("derives the ledger's emission schedule from the one /v1/monkey read, and reads null from a node without the route", async () => {
    const { node, live, reply } = client();
    reply("/v1/monkey", 200, { emissions: { start_ms: 5, period_ms: 600_000, period: 3 } });
    await expect(live.emissionSchedule()).resolves.toEqual({ startMs: 5, periodMs: 600_000, period: 3 });
    expect(node.requests.filter((r) => r.path === "/v1/monkey")).toHaveLength(1);
    reply("/v1/monkey", 404, { error: "not found" });
    await expect(live.emissionSchedule()).resolves.toBeNull();
  });

  it("surfaces a signed 503 before the first scan, and a node without the route, as engine errors the page can tell apart", async () => {
    const { live, reply } = client();
    reply("/v1/house/positions?market=1", 503, { error: "no position snapshot yet" });
    await expect(live.stats.positions(1)).rejects.toMatchObject({ status: 503 });
    reply("/v1/monkey", 404, { error: "not found" });
    await expect(live.stats.monkey()).rejects.toMatchObject({ status: 404 });
    await expect(live.stats.monkey()).rejects.toBeInstanceOf(EngineError);
  });
});
