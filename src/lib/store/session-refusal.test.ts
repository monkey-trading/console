/** Tests for when a refused session-key registration stops holding: a revocation for the account frees a slot. */

import { describe, expect, it } from "vitest";

import type { Reject } from "../engine/types";
import { settle } from "../engine/test-kit";
import { ACCOUNT, memoryStorage } from "../engine/wallet-kit";
import { setupGate } from "../setup-steps";
import { authorizeBrowser, connectWallet } from "./actions";
import { tab } from "./live-kit";
import { message, OTHER_KEY } from "./session-list-kit";
import { SessionList } from "./session-list";

/** A credited, declared tab whose registration the node refused with `reason`, popup closed. */
async function refused(reason: Reject) {
  const kit = await tab(memoryStorage());
  kit.client.credited = true;
  await connectWallet(kit.store, "injected");
  kit.client.answer = (posted) => (posted.route === "session_key"
    ? { seq: 1, events: [{ type: "session_key_rejected", account: ACCOUNT, session_key: "0x0", reason }] }
    : { seq: 1, events: [{ type: "session_key_revoked", account: ACCOUNT, session_key: OTHER_KEY }] });
  expect(await authorizeBrowser(kit.store)).toBe(false);
  return kit;
}

const CAP: Reject = { kind: "too_many_session_keys", max: 10 };
const gate = (kit: { store: { getSnapshot(): Parameters<typeof setupGate>[0] } }) => setupGate(kit.store.getSnapshot());

describe("a refusal for the live-key cap", () => {
  it("holds the key step closed until it is refused again", async () => {
    const kit = await refused(CAP);
    expect(gate(kit)).toBeNull();
  });

  it("is cleared by a revocation another client made for the account, so the key step reopens", async () => {
    const kit = await refused(CAP);
    kit.client.deliver(message([{ type: "session_key_revoked", account: ACCOUNT, session_key: OTHER_KEY }]));
    await settle();
    expect(kit.store.getSnapshot().sessionRefusal).toBeNull();
    expect(gate(kit)).toBe("needed");
  });

  it("is cleared by a revocation made from this page, whether or not the stream has reported it", async () => {
    const kit = await refused(CAP);
    const list = new SessionList(kit.store, () => false);
    await list.revoke(OTHER_KEY);
    expect(kit.store.getSnapshot().sessionRefusal).toBeNull();
    expect(gate(kit)).toBe("needed");
  });

  it("stays set for a revocation of another account's key", async () => {
    const kit = await refused(CAP);
    kit.client.deliver(message([{ type: "session_key_revoked", account: "0x0000000000000000000000000000000000000abc", session_key: OTHER_KEY }]));
    await settle();
    expect(kit.store.getSnapshot().sessionRefusal).toEqual(CAP);
    expect(gate(kit)).toBeNull();
  });
});

describe("a refusal of another kind", () => {
  it.each<[string, Reject]>([
    ["the budget of new keys", { kind: "too_many_session_keys", max: 100 }],
    ["a node without session keys", { kind: "session_key_unsupported" }],
  ])("survives a revocation: %s", async (_name, reason) => {
    const kit = await refused(reason);
    kit.client.deliver(message([{ type: "session_key_revoked", account: ACCOUNT, session_key: OTHER_KEY }]));
    await settle();
    expect(kit.store.getSnapshot().sessionRefusal).toEqual(reason);
    expect(gate(kit)).toBeNull();
  });
});
