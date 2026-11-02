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

  it("reads an optional RPC URL and WalletConnect project id, refusing malformed ones", () => {
    expect(parseDeploy(live)).toMatchObject({ rpcUrl: null, walletConnectProjectId: null });
    expect(parseDeploy({ ...live, rpcUrl: "http://127.0.0.1:8545", walletConnectProjectId: "0123456789abcdef0123456789abcdef" })).toMatchObject({ rpcUrl: "http://127.0.0.1:8545/", walletConnectProjectId: "0123456789abcdef0123456789abcdef" });
    expect(() => parseDeploy({ ...live, rpcUrl: "ws://127.0.0.1:8545" })).toThrow("NEXT_PUBLIC_ENGINE_RPC_URL must be an http or https URL");
    expect(() => parseDeploy({ ...live, rpcUrl: "nope" })).toThrow("NEXT_PUBLIC_ENGINE_RPC_URL is not a URL");
    expect(() => parseDeploy({ ...live, walletConnectProjectId: "0123" })).toThrow("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID must be 32 lowercase hex characters");
  });

  it("reads the optional staking contract and MONKEY token, lowercased, refusing a malformed one", () => {
    expect(parseDeploy(live)).toMatchObject({ staking: null, monkey: null });
    expect(parseDeploy({ ...live, staking: "0x5FbDB2315678afecb367f032d93F642f64180aa3", monkey: "0xE7f1725E7734CE288F8367e1Bb143E90bb3F0512" })).toMatchObject({ staking: "0x5fbdb2315678afecb367f032d93f642f64180aa3", monkey: "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512" });
    expect(() => parseDeploy({ ...live, staking: "0x12" })).toThrow("NEXT_PUBLIC_ENGINE_STAKING");
    expect(() => parseDeploy({ ...live, monkey: "nope" })).toThrow("NEXT_PUBLIC_ENGINE_MONKEY");
    expect(parseDeploy({})).toMatchObject({ staking: null, monkey: null });
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
