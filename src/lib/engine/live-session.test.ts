/** Tests for what a live client needs and which builds get the dev-only mock entry point. */

import { describe, expect, it } from "vitest";

import { parseDeploy, type RawDeploy } from "./deploy";
import { loadVerifier } from "./load-verifier";
import { createLiveClient, WASM_PATH, type Browser } from "./live-session";
import { FakeNode, FakeScheduler } from "./test-kit";
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
    const client = createLiveClient(parseDeploy({ ...raw, mode: "live" }), await browserFor());
    await expect(client.verify()).resolves.toMatchObject({ kind: "unverified", reason: expect.stringContaining("refuses") });
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
