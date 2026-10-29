/** The dev scenario: the live client against a running dev node, with a man in the middle between them. */

import { execFileSync } from "node:child_process";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ClientEvent } from "../../src/lib/engine/client";
import { LiveEngineClient } from "../../src/lib/engine/live";
import { realVerifier } from "../../src/lib/engine/test-vectors";
import { UntrustedError } from "../../src/lib/engine/trust";
import type { Verifier } from "../../src/lib/engine/verifier";
import { startProxy, type Proxy } from "./tamper-proxy";

const NODE = process.env.ENGINE_NODE_URL ?? "";
const VAULT = "0x0000000000000000000000000000000000000000";

let proxy: Proxy;
let dev: Verifier;
let production: Verifier;
const clients: LiveEngineClient[] = [];
const unsubscribes: (() => void)[] = [];

beforeAll(async () => {
  if (NODE === "") throw new Error("ENGINE_NODE_URL names the dev node, such as https://127.0.0.1:8080");
  proxy = await startProxy(NODE);
  dev = await realVerifier(true);
  production = await realVerifier(false);
});
beforeEach(() => {
  Object.assign(proxy.tamper, { flipBodyByte: false, replay: false, dropFrame: null });
});
afterAll(async () => {
  for (const stop of unsubscribes) stop();
  await proxy.close();
});

function clientFor(origin: string, options: { production?: boolean } = {}) {
  const client = new LiveEngineClient({
    origin, streamOrigin: origin.replace(/^http/, "ws"), chainId: 31337, vault: VAULT, heartbeatMs: 5_000,
    loadVerifier: async () => (options.production ? production : dev), manifests: [], acceptsMock: !options.production,
    fetch: (input, init) => fetch(input, init), openSocket: (url) => new WebSocket(url),
    scheduler: { setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    nowMs: () => Date.now(),
  });
  clients.push(client);
  return client;
}

/** Waits until `done` holds, or fails after `ms`. */
async function until(done: () => boolean, ms = 20_000): Promise<void> {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) throw new Error("timed out waiting for the node");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const curl = (path: string): unknown => JSON.parse(execFileSync("curl", ["-sk", `${NODE}${path}`], { encoding: "utf8" }));

describe("reads", () => {
  it("equal curl of the same routes, directly and through the untouched proxy", async () => {
    for (const origin of [NODE, proxy.url]) {
      const client = clientFor(origin);
      await expect(client.house()).resolves.toEqual(curl("/v1/house"));
      const symbols = (rows: unknown) => (rows as { id: number; symbol: string; schedule: unknown }[]).map(({ id, symbol, schedule }) => ({ id, symbol, schedule }));
      expect(symbols(await client.markets())).toEqual(symbols(curl("/v1/markets")));
      await expect(client.attestation()).resolves.toEqual(curl("/v1/attestation"));
      await expect(client.verify()).resolves.toEqual({ kind: "mock" });
    }
  });

  it("are refused when the proxy flips one byte of a body", async () => {
    const client = clientFor(proxy.url);
    await client.house();
    proxy.tamper.flipBodyByte = true;
    await expect(client.house()).rejects.toBeInstanceOf(UntrustedError);
  });

  it("are refused when the proxy replays an older response to a new request", async () => {
    const client = clientFor(proxy.url);
    await client.house();
    proxy.tamper.replay = true;
    await expect(client.house()).rejects.toThrow("did not verify");
  });

  it("refuse a mock attestation in a production build, with the message", async () => {
    await expect(clientFor(proxy.url, { production: true }).verify()).resolves.toEqual({
      kind: "unverified", reason: "The node presents a mock attestation, which this build refuses.",
    });
  });
});

describe("the stream", () => {
  function follow(client: LiveEngineClient) {
    const seen = { messages: 0, feed: [] as string[], problems: [] as string[] };
    client.watch((event: ClientEvent) => {
      if (event.type === "feed") seen.feed.push(event.status);
      if (event.type === "problem") seen.problems.push(event.reason);
    });
    unsubscribes.push(client.subscribe(() => seen.messages++));
    return seen;
  }

  it("delivers verified messages through the untouched proxy and goes live", async () => {
    const seen = follow(clientFor(proxy.url));
    await until(() => seen.messages >= 5);
    expect(seen.feed).toContain("live");
    expect(seen.problems).toEqual([]);
  });

  it("drops the connection and goes stale when the proxy drops one frame", async () => {
    proxy.tamper.dropFrame = 2;
    const seen = follow(clientFor(proxy.url));
    await until(() => seen.problems.length > 0);
    expect(seen.problems[0]).toContain("skipped");
    expect(seen.feed).toContain("stale");
  });
});
