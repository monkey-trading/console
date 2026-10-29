/** Tests for the live client's signed reads, against the engine's known-answer vectors. */

import { describe, expect, it } from "vitest";

import { EngineError, type ClientEvent } from "./client";
import { devStubVerifier } from "./dev-stub-verifier";
import { LiveEngineClient } from "./live";
import { FakeNode, FakeScheduler, type SignedReply } from "./test-kit";
import { SignatureError, UntrustedError } from "./trust";
import { unavailableVerifier, type Verifier } from "./verifier";
import { VECTORS, vectorResponse, vectorVerifier } from "./vector-verifier";

const OTHER = "0x00000000000000000000000000000000000000aa";
const markets = vectorResponse("markets");
const replyOf = (v: typeof markets, overrides: Partial<SignedReply> = {}): SignedReply => ({
  status: v.status, body: v.body, signature: v.signature, timeMs: v.time_ms, seq: v.head_seq, ...overrides,
});

function setup(options: { verifier?: Verifier; acceptsMock?: boolean; address?: () => string; challenge?: string; nowMs?: number } = {}) {
  const node = new FakeNode();
  node.attestation(options.address ?? (() => VECTORS.signer));
  node.signed("/v1/markets", () => replyOf(markets));
  const events: ClientEvent[] = [];
  const client = new LiveEngineClient({
    origin: "https://node.test", streamOrigin: "wss://node.test", chainId: 31337, vault: markets.vault, heartbeatMs: 5_000,
    verifier: options.verifier ?? vectorVerifier(), manifests: [], acceptsMock: options.acceptsMock ?? true,
    fetch: node.fetch, openSocket: () => { throw new Error("no stream in these tests"); }, scheduler: new FakeScheduler(),
    nowMs: () => options.nowMs ?? markets.time_ms, challenge: () => options.challenge ?? markets.challenge,
  });
  client.watch((event) => events.push(event));
  return { node, client, events };
}

describe("signed reads", () => {
  it("returns a read whose signature the attested enclave made for this request, sending its challenge", async () => {
    const { node, client } = setup();
    await expect(client.markets()).resolves.toEqual(JSON.parse(markets.body));
    expect(node.requests.filter((r) => r.path === "/v1/markets")).toEqual([{ path: "/v1/markets", challenge: markets.challenge }]);
    expect(node.requests[0]?.challenge).toBeNull();
  });

  it("rejects a read whose body was altered in transit, and shows nothing", async () => {
    const { node, client } = setup();
    node.signed("/v1/markets", () => replyOf(markets, { body: vectorResponse("altered body").body }));
    await expect(client.markets()).rejects.toBeInstanceOf(SignatureError);
  });

  it("rejects a recorded response replayed under another challenge", async () => {
    const { client } = setup({ challenge: vectorResponse("replayed under another challenge").challenge });
    await expect(client.markets()).rejects.toThrow("did not verify");
  });

  it("rejects an answer signed by a key other than the attested address", async () => {
    const { client } = setup({ address: () => OTHER });
    await expect(client.markets()).rejects.toBeInstanceOf(SignatureError);
  });

  it("rejects an answer with no signature, whatever its status", async () => {
    const { node, client } = setup();
    node.routes.set("/v1/markets", () => new Response("[]", { status: 200 }));
    await expect(client.markets()).rejects.toThrow("not signed");
    node.routes.set("/v1/markets", () => new Response('{"error":"rate limited"}', { status: 429 }));
    await expect(client.markets()).rejects.toThrow("HTTP 429");
  });

  it("rejects an answer whose signed time is more than 30 s from the device clock, and says the clock is wrong", async () => {
    const { client, events } = setup({ nowMs: markets.time_ms + 31_000 });
    await expect(client.markets()).rejects.toThrow("device clock");
    expect(events).toContainEqual({ type: "attestation", status: { kind: "clock", skewMs: -31_000 } });
  });

  it("accepts a signed time within 30 s and clears a clock error", async () => {
    const { client, events } = setup({ nowMs: markets.time_ms + 30_000 });
    await expect(client.markets()).resolves.toHaveLength(1);
    expect(events.some((e) => e.type === "attestation" && e.status.kind === "clock")).toBe(false);
  });
});

describe("a restarted enclave", () => {
  it("verifies the new attestation before accepting anything, then answers the same read under it", async () => {
    let address = OTHER;
    const { client, events } = setup({ address: () => address });
    await client.verify();
    address = VECTORS.signer;
    await expect(client.markets()).resolves.toHaveLength(1);
    const kinds = events.flatMap((e) => (e.type === "attestation" ? [e.status.kind] : []));
    expect(kinds).toEqual(["checking", "mock", "reverifying", "mock"]);
  });

  it("keeps rejecting when the attestation names the same address and the signature still fails", async () => {
    const { node, client } = setup();
    node.signed("/v1/markets", () => replyOf(markets, { body: "[]" }));
    await expect(client.markets()).rejects.toBeInstanceOf(SignatureError);
    expect(node.requests.filter((r) => r.path === "/v1/attestation")).toHaveLength(2);
  });

  it("refuses to read at all when the new attestation fails", async () => {
    let production = false;
    const { node, client } = setup();
    await client.verify();
    node.signed("/v1/markets", () => replyOf(markets, { body: "[]" }));
    node.routes.set("/v1/attestation", () => { production = true; return Response.json({ provider: "sev_snp", enclave_address: OTHER, quote: "0xab" }); });
    await expect(client.markets()).rejects.toBeInstanceOf(UntrustedError);
    expect(production).toBe(true);
  });
});

describe("what the build trusts", () => {
  it("refuses a mock quote in a production build, with the message", async () => {
    const { client } = setup({ acceptsMock: false });
    await expect(client.verify()).resolves.toEqual({ kind: "unverified", reason: "The node presents a mock attestation, which this build refuses." });
    await expect(client.markets()).rejects.toThrow("mock attestation");
  });

  it("trusts nothing when the build has no verifier for a hardware quote", async () => {
    const { node, client } = setup({ verifier: unavailableVerifier });
    node.routes.set("/v1/attestation", () => Response.json({ provider: "sev_snp", enclave_address: VECTORS.signer, quote: "0xab" }));
    node.routes.set("/v1/attestation/collateral", () => new Response("{}", { status: 503 }));
    await expect(client.verify()).resolves.toMatchObject({ kind: "unverified" });
    await expect(client.markets()).rejects.toBeInstanceOf(UntrustedError);
  });

  it("says its signatures are unchecked when the verifier is the dev stub", () => {
    expect(setup({ verifier: devStubVerifier }).client.signatures).toBe("unchecked");
    expect(setup().client.signatures).toBe("checked");
  });
});

describe("the other reads", () => {
  it("maps a signed refusal to an EngineError with its status, message and access reason", async () => {
    const { node, client } = setup({ verifier: devStubVerifier });
    const refusal = (status: number, body: string) => node.signed("/v1/accounts/0xabc", () => ({ status, body, signature: "0x", timeMs: markets.time_ms, seq: 1 }));
    refusal(404, '{"error":"not found"}');
    await expect(client.account("0xabc")).rejects.toMatchObject({ name: "EngineError", status: 404, message: "not found", reject: null });
    refusal(403, '{"error":"access refused","reason":"united_states"}');
    await expect(client.account("0xabc")).rejects.toMatchObject({ status: 403, reject: { kind: "access", reason: "united_states" } });
    refusal(503, "<html>");
    await expect(client.account("0xabc")).rejects.toMatchObject({ status: 503, message: "The node answered HTTP 503." });
  });

  it("reads the account routes and history with its query", async () => {
    const { node, client } = setup({ verifier: devStubVerifier });
    const ok = (path: string, body: unknown) => node.signed(path, () => ({ status: 200, body: JSON.stringify(body), signature: "0x", timeMs: markets.time_ms, seq: 1 }));
    ok("/v1/accounts/0xabc/nonce", { next_nonce: 3 });
    ok("/v1/accounts/0xabc/eligibility", { class: null, statement: null });
    ok("/v1/accounts/0xabc/withdrawals", { seq: 1, queue: [], next: null });
    ok("/v1/accounts/0xabc/history?limit=100&before=5%3A0", { events: [], next: null });
    await expect(client.nonce("0xabc")).resolves.toEqual({ next_nonce: 3 });
    await expect(client.eligibility("0xabc")).resolves.toEqual({ class: null, statement: null });
    await expect(client.withdrawalQueue("0xabc")).resolves.toMatchObject({ queue: [] });
    await expect(client.history("0xabc", { limit: 100, before: "5:0" })).resolves.toEqual({ events: [], next: null });
  });

  it("leaves the signed actions unwired", async () => {
    const { client } = setup();
    for (const action of [client.placeOrder(), client.cancelOrder(), client.withdraw(), client.attestEligibility()]) {
      await expect(action).rejects.toBeInstanceOf(EngineError);
      await expect(action).rejects.toMatchObject({ status: 501 });
    }
  });
});
