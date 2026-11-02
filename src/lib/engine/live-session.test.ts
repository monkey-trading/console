/** Tests for what a live client needs and which builds get the dev-only mock entry point. */

import { describe, expect, it } from "vitest";

import { parseDeploy, type RawDeploy } from "./deploy";
import { loadVerifier } from "./load-verifier";
import type { Verifier } from "./verifier";
import { createLiveClient, WASM_PATH, type Browser } from "./live-session";
import { FakeNode, FakeScheduler, FakeSocket, settle } from "./test-kit";
import { loadGlue, readWasm, VECTORS } from "./test-vectors";

const raw: RawDeploy = { mode: "live-dev", origin: "https://127.0.0.1:8080", chainId: "31337", vault: "0x" + "0".repeat(40), devOrigins: "https://127.0.0.1:8080" };

async function browserFor() {
  const node = new FakeNode();
  node.attestation(() => VECTORS.signer);
  const wasm = await readWasm();
  const browser: Browser = {
    fetch: async (input, init) => (String(input) === WASM_PATH ? new Response(wasm) : node.fetch(input, init)),
    openSocket: () => { throw new Error("unused"); }, scheduler: new FakeScheduler(), nowMs: () => 0, loadGlue,
  };
  return browser;
}

describe("createLiveClient", () => {
  it("loads the pinned verifier from the app's own origin and trusts a dev node's mock attestation", async () => {
    const client = createLiveClient(parseDeploy(raw), await browserFor());
    expect(client.signatures).toBe("checked");
    await expect(client.verify()).resolves.toEqual({ kind: "mock" });
  });

  it("gives a production build a verifier with no mock entry point, so a mock attestation is refused", async () => {
    const loaded: Verifier[] = [];
    const spy: typeof loadVerifier = async (deps) => { const verifier = await loadVerifier(deps); loaded.push(verifier); return verifier; };
    const client = createLiveClient(parseDeploy({ ...raw, mode: "live" }), await browserFor(), spy);
    await expect(client.verify()).resolves.toMatchObject({ kind: "unverified", reason: expect.stringContaining("refuses") });
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.verifyMockAttestation).toBeUndefined();
  });

  it("lets only a dev build's verifier read a mock attestation", async () => {
    const allowed: boolean[] = [];
    const spy: typeof loadVerifier = async (deps) => { allowed.push(deps.allowMock); return loadVerifier(deps); };
    for (const mode of ["live-dev", "live"]) await createLiveClient(parseDeploy({ ...raw, mode }), await browserFor(), spy).verify();
    expect(allowed).toEqual([true, false]);
  });

  it("refuses a deployment with no node", async () => {
    expect(() => createLiveClient(parseDeploy({}), { fetch, openSocket: () => { throw new Error("unused"); }, scheduler: new FakeScheduler(), nowMs: () => 0, loadGlue })).toThrow("needs a deployment");
  });
});

describe("the origin a live client takes", () => {
  const HOME = "https://127.0.0.1:8080";
  const CANDIDATE = "https://b.example";
  const listed = parseDeploy({ ...raw, candidateOrigins: CANDIDATE, devOrigins: `${HOME},${CANDIDATE}` });

  /** A browser that records every origin the client fetches from and every socket it opens. */
  async function recording() {
    const browser = await browserFor();
    const fetched = new Set<string>();
    const sockets: string[] = [];
    const seen: Browser = {
      ...browser,
      fetch: (input, init) => {
        if (String(input) !== WASM_PATH) fetched.add(new URL(String(input)).origin);
        return browser.fetch(input, init);
      },
      openSocket: (url) => { sockets.push(url); return new FakeSocket(url); },
    };
    return { seen, fetched, sockets };
  }

  /** Verifies the client and opens its stream; returns what stops the stream. */
  async function reach(client: ReturnType<typeof createLiveClient>) {
    await expect(client.verify()).resolves.toEqual({ kind: "mock" });
    const stop = client.subscribe(() => {});
    await settle();
    return stop;
  }

  it("fetches from and streams to a listed candidate's origin, never the build's own", async () => {
    const { seen, fetched, sockets } = await recording();
    const stop = await reach(createLiveClient(listed, seen, undefined, CANDIDATE));
    expect([...fetched]).toEqual([CANDIDATE]);
    expect(sockets).toEqual([expect.stringMatching(/^wss:\/\/b\.example\/v1\/stream\?/)]);
    stop();
  });

  it("fetches from and streams to the build's own origin when given none", async () => {
    const { seen, fetched, sockets } = await recording();
    const stop = await reach(createLiveClient(listed, seen));
    expect([...fetched]).toEqual([HOME]);
    expect(sockets).toEqual([expect.stringMatching(/^wss:\/\/127\.0\.0\.1:8080\/v1\/stream\?/)]);
    stop();
  });

  it("refuses an origin the build does not list, or none at all, reaching nothing", async () => {
    const { seen, fetched, sockets } = await recording();
    expect(() => createLiveClient(listed, seen, undefined, "https://evil.example")).toThrow("This build does not list the node origin https://evil.example.");
    expect(() => createLiveClient(listed, seen, undefined, null)).toThrow("needs a deployment");
    expect([[...fetched], sockets]).toEqual([[], []]);
  });

  it("takes a mock attestation by the origin given: a dev build's own node, and not a candidate outside its dev origins", async () => {
    const own = parseDeploy({ ...raw, candidateOrigins: CANDIDATE });
    const allowed: boolean[] = [];
    const spy: typeof loadVerifier = async (deps) => { allowed.push(deps.allowMock); return loadVerifier(deps); };
    await expect(createLiveClient(own, await browserFor(), spy).verify()).resolves.toEqual({ kind: "mock" });
    await expect(createLiveClient(own, await browserFor(), spy, CANDIDATE).verify()).resolves.toMatchObject({ kind: "unverified", reason: expect.stringContaining("refuses") });
    await expect(createLiveClient(listed, await browserFor(), spy, CANDIDATE).verify()).resolves.toEqual({ kind: "mock" });
    expect(allowed).toEqual([true, false, true]);
  });
});
