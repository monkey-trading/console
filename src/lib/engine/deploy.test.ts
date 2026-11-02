/** Tests for the deployment a build pins and what it lets the console trust. */

import { describe, expect, it } from "vitest";

import { acceptsMockAttestation, hostnameOrigin, listedOrigins, parseDeploy, streamOrigin, type RawDeploy } from "./deploy";

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

describe("the nodes a build may follow", () => {
  it("lists the build's node and each approved candidate's origin, once each", () => {
    const deploy = parseDeploy({ ...live, candidateOrigins: "https://b.example, https://c.example:8443,https://127.0.0.1:8080" });
    expect(deploy.candidateOrigins).toEqual(["https://b.example", "https://c.example:8443", "https://127.0.0.1:8080"]);
    expect(listedOrigins(deploy)).toEqual(["https://127.0.0.1:8080", "https://b.example", "https://c.example:8443"]);
    expect(listedOrigins(parseDeploy({}))).toEqual([]);
  });

  it("fails the build on a wildcard, a scheme source, a path, or http", () => {
    for (const candidateOrigins of ["https://*.example.com", "https:", "*", "https://b.example/v1", "http://b.example", "b.example", "https://user@b.example", "wss://b.example"]) {
      expect(() => parseDeploy({ ...live, candidateOrigins }), candidateOrigins).toThrow("NEXT_PUBLIC_ENGINE_CANDIDATE_ORIGINS");
    }
  });

  it("reads the registry, lowercased, refusing a malformed one", () => {
    expect(parseDeploy(live).registry).toBeNull();
    expect(parseDeploy({ ...live, registry: "" }).registry).toBeNull();
    expect(parseDeploy({ ...live, registry: "0x5FbDB2315678afecb367f032d93F642f64180aa3" }).registry).toBe("0x5fbdb2315678afecb367f032d93f642f64180aa3");
    expect(() => parseDeploy({ ...live, registry: "0x12" })).toThrow("NEXT_PUBLIC_ENGINE_REGISTRY");
  });

  it("takes stand-in launch digests only in a dev build, each of 48 bytes", () => {
    const digest = `0x${"5A".repeat(48)}`;
    expect(parseDeploy({ ...live, devLaunchDigests: digest }).devLaunchDigests).toEqual([digest.toLowerCase()]);
    expect(() => parseDeploy({ ...live, mode: "live", devLaunchDigests: digest })).toThrow("only to a live-dev build");
    expect(() => parseDeploy({ ...live, devLaunchDigests: "0x12" })).toThrow("48-byte");
  });

  it("accepts a mock quote only from an origin the dev build lists as a dev origin", () => {
    const deploy = parseDeploy({ ...live, candidateOrigins: "https://b.example,https://c.example", devOrigins: "https://127.0.0.1:8080,https://b.example" });
    expect(acceptsMockAttestation(deploy, "https://b.example")).toBe(true);
    expect(acceptsMockAttestation(deploy, "https://c.example")).toBe(false);
  });
});

describe("hostnameOrigin", () => {
  it("reads a plain host and port as its https origin, lowercased", () => {
    expect(hostnameOrigin("api.candidate.example")).toBe("https://api.candidate.example");
    expect(hostnameOrigin("API.Candidate.Example")).toBe("https://api.candidate.example");
    expect(hostnameOrigin("127.0.0.1:8443")).toBe("https://127.0.0.1:8443");
    expect(hostnameOrigin("node.example:443")).toBe("https://node.example");
  });

  it("refuses anything a chain could hold that is not a plain host and port", () => {
    for (const hostile of ["", " ", "https://node.example", "node.example/path", "user@node.example", "node.example?x=1", "node.example#x", "*.example.com", "node.example:99999", "node.example:", "-node.example", "node-.example", "node..example", "\u0430pi.example", "xn--\u0430.example", "a".repeat(254), "node.example\n", "[::1]:8080"]) {
      expect(hostnameOrigin(hostile), hostile).toBeNull();
    }
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
