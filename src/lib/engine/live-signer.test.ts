/** Tests for the live client's judgement of the signer the vault names (monkey-trading/console#280, monkey-trading/engine#595): at the first check, on a later read, and on answers in flight. */

import { describe, expect, it } from "vitest";

import { LiveEngineClient } from "./live";
import { SIGNER_SUPERSEDED } from "./signer-naming";
import { acceptAll, FakeNode, FakeScheduler, FakeSocket, OPERATOR_CLAIM, settle } from "./test-kit";
import { UntrustedError } from "./trust";
import { vectorResponse } from "./test-vectors";

/** The enclave `acceptAll` reads out of a mock attestation. */
const ENCLAVE = "0x0000000000000000000000000000000000000001";
const OTHER = "0x00000000000000000000000000000000000000bb";

function client() {
  const node = new FakeNode();
  node.attestation(() => ENCLAVE);
  const gates: { markets: Promise<void> | null } = { markets: null };
  const fetchThrough: typeof fetch = async (input, init) => {
    if (String(input).endsWith("/v1/markets") && gates.markets !== null) await gates.markets;
    return node.fetch(input, init);
  };
  const live = new LiveEngineClient({
    origin: "https://node.test", streamOrigin: "wss://node.test", chainId: 31337, vault: vectorResponse("markets").vault, heartbeatMs: 5_000,
    loadVerifier: async () => acceptAll, releases: [], acceptsMock: true, fetch: fetchThrough,
    openSocket: (url) => new FakeSocket(url), scheduler: new FakeScheduler(), nowMs: () => 1, challenge: () => "ab".repeat(32),
  });
  const reply = (path: string, body: object) => node.signed(path, () => ({ status: 200, body: JSON.stringify(body), signature: "0x", timeMs: 1, seq: 1 }));
  const operator = (signer: { epoch: number; address: string } | null, enclave: string = ENCLAVE) => reply(OPERATOR_CLAIM, { operator: ENCLAVE, pending_rotation: null, rotation_enabled: true, last_election: null, enclave, ...(signer === null ? {} : { signer }) });
  return { node, live, reply, operator, gates };
}

describe("the first check", () => {
  it("reads the node's own word on the signer before anything else is taken, and trusts a node whose enclave the vault names", async () => {
    const { node, live, reply, operator } = client();
    operator({ epoch: 5, address: ENCLAVE });
    reply("/v1/markets", []);
    await live.verify();
    expect(live.signatures).toBe("checked");
    await expect(live.markets()).resolves.toEqual([]);
    expect(node.requests.map((request) => request.path).filter((path) => path !== "/v1/attestation")).toEqual([OPERATOR_CLAIM, "/v1/markets"]);
  });

  it("refuses a node the vault names another signer than, before any other answer is taken, and says why", async () => {
    const { node, live, reply, operator } = client();
    operator({ epoch: 6, address: OTHER });
    reply("/v1/markets", []);
    await expect(live.verify()).resolves.toEqual({ kind: "unverified", reason: SIGNER_SUPERSEDED });
    await expect(live.markets()).rejects.toBeInstanceOf(UntrustedError);
    expect(node.requests.some((request) => request.path === "/v1/markets")).toBe(false);
  });

  it("refuses a node whose word names an enclave other than the one it attested, and goes on without one from a node that predates the route", async () => {
    const wrong = client();
    wrong.operator({ epoch: 5, address: ENCLAVE }, OTHER);
    wrong.reply("/v1/markets", []);
    await expect(wrong.live.verify()).resolves.toMatchObject({ kind: "unverified", reason: expect.stringContaining("named an enclave other than the one that signed its answer") });
    const old = client();
    old.reply("/v1/markets", []);
    await expect(old.live.verify()).resolves.toMatchObject({ kind: "mock" });
    await expect(old.live.markets()).resolves.toEqual([]);
  });

  it("takes a node whose liveness rule does not run: it states no signer", async () => {
    const { live, operator } = client();
    operator(null);
    await expect(live.verify()).resolves.toMatchObject({ kind: "mock" });
  });
});

describe("a later operator read", () => {
  it("refuses the node once it names another signer at a later epoch, and refuses it at every check after", async () => {
    const { live, operator, reply } = client();
    operator({ epoch: 5, address: ENCLAVE });
    reply("/v1/markets", []);
    await live.verify();
    operator({ epoch: 6, address: OTHER });
    await expect(live.stats.operator({ limit: 1 })).rejects.toThrow(SIGNER_SUPERSEDED);
    await expect(live.markets()).rejects.toBeInstanceOf(UntrustedError);
    await expect(live.verify()).resolves.toEqual({ kind: "unverified", reason: SIGNER_SUPERSEDED });
  });

  it("trusts the enclave again once the vault names it at a later epoch", async () => {
    const { live, operator, reply } = client();
    operator({ epoch: 5, address: ENCLAVE });
    reply("/v1/markets", []);
    await live.verify();
    operator({ epoch: 6, address: OTHER });
    await expect(live.stats.operator({ limit: 1 })).rejects.toThrow(SIGNER_SUPERSEDED);
    // The vault names the enclave again, at epoch 7: the first check's own word clears the refusal.
    operator({ epoch: 7, address: ENCLAVE });
    await expect(live.verify()).resolves.toMatchObject({ kind: "mock" });
    await expect(live.markets()).resolves.toEqual([]);
  });
});

describe("an answer in flight", () => {
  it("is discarded when the vault named another signer while it was on its way, valid as its signature is", async () => {
    const { live, operator, reply, gates } = client();
    operator({ epoch: 5, address: ENCLAVE });
    reply("/v1/markets", []);
    await live.verify();
    let release: () => void = () => undefined;
    gates.markets = new Promise<void>((resolve) => { release = resolve; });
    const inFlight = live.markets();
    await settle();
    operator({ epoch: 6, address: OTHER });
    await expect(live.stats.operator({ limit: 1 })).rejects.toThrow(SIGNER_SUPERSEDED);
    release();
    await expect(inFlight).rejects.toThrow(SIGNER_SUPERSEDED);
  });
});
