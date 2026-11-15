/** Tests for the signed stream under a signer the vault stops naming (monkey-trading/console#280): its frames are refused on arrival, before the check the vault's word starts has ended. */

import { describe, expect, it } from "vitest";

import type { ClientEvent } from "./client";
import { LiveEngineClient } from "./live";
import type { DeploymentReads, VaultFacts } from "./registry";
import { releaseName } from "./release-check";
import { SIGNER_SUPERSEDED } from "./signer-naming";
import { acceptAll, FakeNode, FakeScheduler, FakeSocket, settle } from "./test-kit";
import { vectorResponse } from "./test-vectors";

/** The enclave `acceptAll` reads out of a mock attestation. */
const ENCLAVE = "0x0000000000000000000000000000000000000001";
const OTHER = "0x00000000000000000000000000000000000000bb";
const DIGEST = `0x${"5a".repeat(48)}` as const;
/** The config hash `mockAttestation` serves. */
const CONFIG = `0x${"01".repeat(32)}` as const;
const NAMED: VaultFacts = { release: releaseName(DIGEST, CONFIG), signer: ENCLAVE };

const frame = (n: number, seq: number) => JSON.stringify({ v: 1, n, time: 1, msg: JSON.stringify({ type: "checkpoint", offset: `${seq}:0`, seq }), sig: "0x00" });

describe("a stream under a signer the wallet's vault read puts aside", () => {
  it("delivers nothing more from that signer, while the check the read starts still runs", async () => {
    const node = new FakeNode();
    node.attestation(() => ENCLAVE);
    const sockets: FakeSocket[] = [];
    const client = new LiveEngineClient({
      origin: "https://node.test", streamOrigin: "wss://node.test", chainId: 31337, vault: vectorResponse("markets").vault, heartbeatMs: 5_000,
      loadVerifier: async () => acceptAll, releases: [], devDigests: [DIGEST], acceptsMock: true, fetch: node.fetch,
      openSocket: (url) => { const socket = new FakeSocket(url); sockets.push(socket); return socket; }, scheduler: new FakeScheduler(), nowMs: () => 1, challenge: () => "ab".repeat(32),
    });
    const events: ClientEvent[] = [];
    client.watch((event) => events.push(event));
    const vault = { facts: NAMED };
    const chain: DeploymentReads = { vault: async () => vault.facts, operator: async () => null };
    await client.readChainThrough(chain);
    expect(await client.verify()).toEqual({ kind: "mock" });
    client.subscribe(() => {});
    await settle();
    const socket = sockets[0];
    if (socket === undefined) throw new Error("the stream opened no socket");
    socket.open();
    socket.receive(frame(0, 9));
    expect(events).toContainEqual({ type: "checkpoint", seq: 9 });
    // The vault now names another key, and the check that follows waits on the node's attestation.
    node.routes.set("/v1/attestation", () => new Promise<Response>(() => {}));
    vault.facts = { ...NAMED, signer: OTHER };
    void client.heedVault(vault.facts, chain);
    socket.receive(frame(1, 10));
    expect(events).not.toContainEqual({ type: "checkpoint", seq: 10 });
    expect(events).toContainEqual({ type: "problem", reason: SIGNER_SUPERSEDED });
    expect(socket.closed).toBe(true);
  });
});
