/** Tests for the deployment a build pins and what it lets the console trust. */

import { describe, expect, it } from "vitest";

import { acceptsMockAttestation, parseDeploy, streamOrigin, type RawDeploy } from "./deploy";

const live: RawDeploy = {
  mode: "live-dev", origin: "https://127.0.0.1:8080", chainId: "31337", vault: "0x5FbDB2315678afecb367f032d93F642f64180aa3", devOrigins: "https://127.0.0.1:8080",
};

describe("parseDeploy", () => {
  it("defaults to the mock, which pins no node", () => {
    expect(parseDeploy({})).toMatchObject({ mode: "mock", origin: null, chainId: null, vault: null });
    expect(parseDeploy({ mode: "", origin: "https://ignored.example" }).origin).toBeNull();
  });

  it("pins a live node's origin, chain, vault and heartbeat, lowercasing the vault", () => {
    expect(parseDeploy(live)).toMatchObject({ mode: "live-dev", origin: "https://127.0.0.1:8080", chainId: 31337, vault: "0x5fbdb2315678afecb367f032d93f642f64180aa3", heartbeatMs: 5_000 });
    expect(parseDeploy({ ...live, heartbeatMs: "2000" }).heartbeatMs).toBe(2_000);
  });

  it("refuses a live build missing a pinned value or with a malformed one", () => {
    expect(() => parseDeploy({ ...live, origin: undefined })).toThrow("NEXT_PUBLIC_ENGINE_ORIGIN is required");
    expect(() => parseDeploy({ ...live, chainId: "0" })).toThrow("CHAIN_ID");
    expect(() => parseDeploy({ ...live, vault: "0x12" })).toThrow("VAULT");
    expect(() => parseDeploy({ ...live, vault: undefined })).toThrow("VAULT");
    expect(() => parseDeploy({ ...live, heartbeatMs: "500" })).toThrow("HEARTBEAT");
    expect(() => parseDeploy({ ...live, mode: "staging" })).toThrow("must be mock, live-dev or live");
  });

  it("allows only a bare https origin", () => {
    for (const origin of ["http://node.example", "https://node.example/v1", "https://node.example?x=1", "https://user@node.example", "wss://node.example", "node.example"]) {
      expect(() => parseDeploy({ ...live, origin, devOrigins: origin })).toThrow();
    }
  });

  it("builds a dev build only for a node it lists as a dev origin", () => {
    expect(() => parseDeploy({ ...live, devOrigins: "https://other.example" })).toThrow("not in NEXT_PUBLIC_ENGINE_DEV_ORIGINS");
    expect(parseDeploy({ ...live, mode: "live", devOrigins: undefined }).devOrigins).toEqual([]);
  });
});

describe("acceptsMockAttestation", () => {
  it("accepts a mock quote from the mock build and a listed dev origin, and never from a production build", () => {
    expect(acceptsMockAttestation(parseDeploy({}))).toBe(true);
    expect(acceptsMockAttestation(parseDeploy(live))).toBe(true);
    expect(acceptsMockAttestation(parseDeploy({ ...live, mode: "live" }))).toBe(false);
    expect(acceptsMockAttestation(parseDeploy({ ...live, mode: "live", devOrigins: "https://127.0.0.1:8080" }))).toBe(false);
  });
});

describe("streamOrigin", () => {
  it("names the wss origin of the same host and port", () => {
    expect(streamOrigin("https://127.0.0.1:8080")).toBe("wss://127.0.0.1:8080");
    expect(streamOrigin("https://api.example.com")).toBe("wss://api.example.com");
  });
});
