/** Tests for how the live client judges the node: a restarted enclave, an attestation it cannot verify, a verifier that stalls, a node that stalls. */

import { describe, expect, it } from "vitest";

import { LiveEngineClient } from "./live";
import { dev, markets, OTHER, replyOf, setup } from "./live-setup";
import { acceptAll, FakeNode, FakeScheduler, settle } from "./test-kit";
import { VECTORS } from "./test-vectors";
import { SignatureError, UntrustedError } from "./trust";
import type { Verifier } from "./verifier";

describe("a restarted enclave", () => {
  it("verifies the new attestation before accepting anything, then answers the same read under it", async () => {
    let address = OTHER;
    const { client, events } = setup({ address: () => address });
    await client.verify();
    address = VECTORS.signer;
    await expect(client.markets()).resolves.toHaveLength(1);
    const kinds = events.flatMap((e) => (e.type === "attestation" ? [e.status.kind] : []));
    expect(kinds).toEqual(["checking", "mock", "reverifying", "mock"]);
    expect(events.filter((e) => e.type === "enclave")).toHaveLength(1);
  });

  it("reports no enclave change when the same address is verified again", async () => {
    const { node, client, events } = setup();
    node.signed("/v1/markets", () => replyOf(markets, { body: "[]" }));
    await expect(client.markets()).rejects.toBeInstanceOf(SignatureError);
    expect(events.filter((e) => e.type === "enclave")).toEqual([]);
  });

  it("does not ask for the attestation again on every failure under an address that re-verifies unchanged, until a cooldown passes", async () => {
    let now = markets.time_ms;
    const { node, client } = setup({ nowMs: () => now });
    node.signed("/v1/markets", () => replyOf(markets, { body: "[]" }));
    const attestations = () => node.requests.filter((r) => r.path === "/v1/attestation").length;
    await expect(client.markets()).rejects.toBeInstanceOf(SignatureError);
    await expect(client.markets()).rejects.toBeInstanceOf(SignatureError);
    expect(attestations()).toBe(2);
    now += 31_000;
    await expect(client.markets()).rejects.toBeInstanceOf(SignatureError);
    expect(attestations()).toBe(3);
  });

  it("keeps showing a failed check as failed while it is tried again", async () => {
    const { node, client, events } = setup();
    node.routes.set("/v1/attestation", () => new Response("", { status: 503 }));
    await client.verify();
    await client.verify();
    await client.verify();
    expect(events.flatMap((e) => (e.type === "attestation" ? [e.status.kind] : []))).toEqual(["checking", "unverified", "unverified", "unverified"]);
  });

  it("keeps rejecting when the attestation names the same address and the signature still fails", async () => {
    const { node, client } = setup();
    node.signed("/v1/markets", () => replyOf(markets, { body: "[]" }));
    await expect(client.markets()).rejects.toBeInstanceOf(SignatureError);
    expect(node.requests.filter((r) => r.path === "/v1/attestation")).toHaveLength(2);
  });

  it("refuses to read at all when the new attestation fails", async () => {
    const { node, client } = setup();
    await client.verify();
    node.signed("/v1/markets", () => replyOf(markets, { body: "[]" }));
    node.routes.set("/v1/attestation", () => new Response(JSON.stringify({ provider: "sev_snp", enclave_address: OTHER, quote: "0xab" })));
    await expect(client.markets()).rejects.toBeInstanceOf(UntrustedError);
  });
});

describe("a node whose attestation cannot be judged", () => {
  const hardware = (node: FakeNode) => node.routes.set("/v1/attestation", () => new Response(JSON.stringify({ provider: "sev_snp", enclave_address: VECTORS.signer, quote: "0xab" })));

  it("adds the clock hint when the verifier fails on dates, and only then", async () => {
    const dated: Verifier = { ...acceptAll, verifyAttestation: () => ({ ok: false, reason: "certificate VCEK is outside its validity period" }) };
    const { node, client } = setup({ verifier: dated });
    hardware(node);
    node.routes.set("/v1/attestation/collateral", () => new Response("{}"));
    await expect(client.verify()).resolves.toEqual({ kind: "unverified", reason: "certificate VCEK is outside its validity period. If the device clock is wrong, correct it and reload." });
    const other: Verifier = { ...acceptAll, verifyAttestation: () => ({ ok: false, reason: "chain root is not a pinned vendor root" }) };
    const second = setup({ verifier: other });
    hardware(second.node);
    second.node.routes.set("/v1/attestation/collateral", () => new Response("{}"));
    await expect(second.client.verify()).resolves.toEqual({ kind: "unverified", reason: "chain root is not a pinned vendor root" });
  });

  it("is unverified when the collateral cannot be fetched", async () => {
    const { node, client } = setup();
    hardware(node);
    node.routes.set("/v1/attestation/collateral", () => new Response("", { status: 500 }));
    await expect(client.verify()).resolves.toMatchObject({ kind: "unverified", reason: "The node did not serve the attestation's collateral (HTTP 500)." });
  });
});

describe("a verifier that never loads", () => {
  it("is given up on after the deadline, shown as unverified, and tried again on the next check", async () => {
    const node = new FakeNode();
    node.attestation(() => VECTORS.signer);
    const scheduler = new FakeScheduler();
    let loads = 0;
    const client = new LiveEngineClient({
      origin: "https://node.test", streamOrigin: "wss://node.test", chainId: 31337, vault: markets.vault, heartbeatMs: 5_000,
      loadVerifier: () => (++loads === 1 ? new Promise<Verifier>(() => {}) : Promise.resolve(dev)),
      manifests: [], acceptsMock: true, fetch: node.fetch, openSocket: () => { throw new Error("unused"); }, scheduler, nowMs: () => markets.time_ms,
    });
    const first = client.verify();
    await settle();
    scheduler.advance(20_000);
    await expect(first).resolves.toEqual({ kind: "unverified", reason: "The verifier took too long to load." });
    await expect(client.verify()).resolves.toEqual({ kind: "mock" });
    expect(loads).toBe(2);
  });
});

describe("a stalled node", () => {
  it("aborts a read when the deadline passes, and says the node did not answer", async () => {
    const node = new FakeNode();
    node.attestation(() => VECTORS.signer);
    const deadline = new AbortController();
    const hanging: typeof fetch = (input, init) =>
      String(input).endsWith("/v1/attestation")
        ? node.fetch(input, init)
        : new Promise((_, reject) => {
            const signal = init?.signal;
            if (signal?.aborted) reject(new Error("aborted"));
            signal?.addEventListener("abort", () => reject(new Error("aborted")));
          });
    const client = new LiveEngineClient({
      origin: "https://node.test", streamOrigin: "wss://node.test", chainId: 31337, vault: markets.vault, heartbeatMs: 5_000, loadVerifier: async () => dev,
      manifests: [], acceptsMock: true, fetch: hanging, openSocket: () => { throw new Error("unused"); }, scheduler: new FakeScheduler(), nowMs: () => markets.time_ms,
      signal: () => deadline.signal,
    });
    const read = client.markets();
    deadline.abort();
    await expect(read).rejects.toMatchObject({ name: "EngineError", status: 0, message: "The node did not answer." });
  });
});

