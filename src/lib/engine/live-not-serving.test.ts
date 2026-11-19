/** Tests that a check failing only for want of an answer keeps that kind through the real client's signer gate (monkey-trading/console#492). */

import { describe, expect, it } from "vitest";

import { LiveEngineClient } from "./live";
import { NodeWord } from "./operator-follow-node";
import { acceptAll, FakeNode, FakeScheduler, FakeSocket, OPERATOR_CLAIM } from "./test-kit";
import { vectorResponse } from "./test-vectors";
import { notReady, RefusedAnswer } from "./trust-errors";

const ENCLAVE = "0x0000000000000000000000000000000000000001";
const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const T = 10_000_000;

describe("a node whose check failed because it stopped answering", () => {
  it("refuses its operator read as not serving yet, so the turns it named stay heard", async () => {
    const node = new FakeNode();
    node.attestation(() => ENCLAVE);
    const live = new LiveEngineClient({
      origin: "https://node.test", streamOrigin: "wss://node.test", chainId: 31337, vault: vectorResponse("markets").vault, heartbeatMs: 5_000,
      loadVerifier: async () => acceptAll, releases: [], acceptsMock: true, fetch: node.fetch.bind(node),
      openSocket: (url) => new FakeSocket(url), scheduler: new FakeScheduler(), nowMs: () => 1, challenge: () => "ab".repeat(32),
    });
    const route = { operator: ENCLAVE, pending_rotation: null, rotation_enabled: true, last_election: null, enclave: ENCLAVE, signer: { epoch: 5, address: ENCLAVE }, turn: { candidate: A, applies_at: T - 600_000 }, next_turn: { candidate: B, applies_at: T } };
    node.signed(OPERATOR_CLAIM, () => ({ status: 200, body: JSON.stringify(route), signature: "0x", timeMs: 1, seq: 1 }));
    await live.verify();
    const word = new NodeWord(new FakeScheduler(), () => T - 1_000);
    await expect(word.read(live)).resolves.toMatchObject({ read: true });
    // The node stops answering; its next check fails for that alone.
    node.routes.set(OPERATOR_CLAIM, () => { throw new TypeError("Failed to fetch"); });
    await expect(live.verify()).resolves.toMatchObject({ kind: "unverified", notReady: true });
    const refused = await live.stats.operator({ limit: 1 }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(RefusedAnswer);
    expect(notReady(refused)).toBe(true);
    await expect(word.read(live)).resolves.toMatchObject({ read: false });
    expect(word.handoverWindow(T + 1_000, 0)).not.toBeNull();
  });
});
