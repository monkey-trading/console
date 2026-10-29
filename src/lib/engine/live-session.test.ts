/** Tests for which verifier a build gets and what a live client needs. */

import { describe, expect, it } from "vitest";

import { parseDeploy, type RawDeploy } from "./deploy";
import { devStubVerifier } from "./dev-stub-verifier";
import { createLiveClient, verifierFor, type Browser } from "./live-session";
import { unavailableVerifier } from "./verifier";

const raw: RawDeploy = { mode: "live-dev", origin: "https://127.0.0.1:8080", chainId: "31337", vault: "0x" + "0".repeat(40), devOrigins: "https://127.0.0.1:8080" };
const browser: Browser = {
  fetch: async () => new Response(), openSocket: () => { throw new Error("unused"); },
  scheduler: { setTimeout: () => 0, clearTimeout: () => {} }, nowMs: () => 0,
};

describe("verifierFor", () => {
  it("gives the dev stub only to a dev build, and a production build none", () => {
    expect(verifierFor(parseDeploy(raw))).toBe(devStubVerifier);
    expect(verifierFor(parseDeploy({ ...raw, mode: "live" }))).toBe(unavailableVerifier);
  });

  it("makes the stub say on screen that nothing is verified, and the empty verifier refuse everything", async () => {
    expect(devStubVerifier.checksSignatures).toBe(false);
    expect(unavailableVerifier.checksSignatures).toBe(true);
    expect(unavailableVerifier.verifyResponse({} as never)).toMatchObject({ ok: false });
    expect(unavailableVerifier.openFrames({} as never).verify({} as never)).toMatchObject({ ok: false });
    await expect(unavailableVerifier.verifyAttestation({} as never)).resolves.toMatchObject({ ok: false });
  });
});

describe("createLiveClient", () => {
  it("reports unchecked signatures for a dev build, and refuses a deployment with no node", () => {
    expect(createLiveClient(parseDeploy(raw), browser).signatures).toBe("unchecked");
    expect(() => createLiveClient(parseDeploy({}), browser)).toThrow("needs a deployment");
  });
});
