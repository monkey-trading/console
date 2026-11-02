/** Tests for reading the node's unpaid approvals: statuses from a fresh load, what an absent nonce means, paging, a node without the route, and wallet changes mid-read. */

import { describe, expect, it } from "vitest";

import { EngineError } from "../engine/client";
import type { PayoutsPage } from "../engine/types";
import { ACCOUNT } from "../engine/wallet-kit";
import { connected } from "./live-kit";
import { checkPaid, loadPayouts, payoutsOf, unreadPayouts } from "./payouts";
import { approved, OTHER, page, signed } from "./payouts-kit";
import { NO_ACCOUNT } from "./wallet-session";

const NOW_MS = 1_800_000_000_000;

describe("the node's payouts", () => {
  it("gives each status from a fresh load with nothing held: claimable, expired and waiting from the answer, paid from its absence", async () => {
    const { client, provider, store } = await connected({ paid: false });
    store.patch({ now: NOW_MS, approvals: [approved(5, 90), approved(4, 80), approved(3, 70), approved(2, 60)] });
    expect(store.getSnapshot().authorizations).toEqual([]);
    client.payoutsPage = page([{ nonce: 5 }, { nonce: 4, withdrawal: signed(4, 2_000_000_000) }, { nonce: 3, withdrawal: signed(3, 1_700_000_000) }]);
    await loadPayouts(store);
    expect(payoutsOf(store.getSnapshot()).map((p) => [p.nonce, p.status.kind])).toEqual([[5, "waiting"], [4, "claimable"], [3, "expired"], [2, "paid"]]);
    expect(store.getSnapshot().toasts).toEqual([]);
    // The nonces the answer lists still get the vault read; the absent one is paid without it.
    await checkPaid(store);
    expect(provider.calls.filter((c) => c.method === "eth_call")).toHaveLength(3);
    expect(store.getSnapshot()).toMatchObject({ paid: [], unpaid: expect.arrayContaining([3, 4, 5]) });
  });

  it("reads an absent nonce as paid only from a loaded answer, and not for an approval the answer predates", async () => {
    const { client, store } = await connected();
    store.patch({ approvals: [approved(6, 120), approved(2, 60)] });
    client.payoutsPage = page([], { loaded: false });
    await loadPayouts(store);
    expect(payoutsOf(store.getSnapshot()).map((p) => [p.nonce, p.status.kind])).toEqual([[6, "waiting"], [2, "waiting"]]);
    expect(unreadPayouts(store.getSnapshot())).toEqual([6, 2]);
    expect(store.getSnapshot().payoutsProblem).toContain("still loading");
    expect(store.getSnapshot().toasts).toEqual([]);
    client.payoutsPage = page([]);
    await loadPayouts(store);
    expect(payoutsOf(store.getSnapshot()).map((p) => [p.nonce, p.status.kind])).toEqual([[6, "waiting"], [2, "paid"]]);
    expect(unreadPayouts(store.getSnapshot())).toEqual([6]);
    expect(store.getSnapshot().payoutsProblem).toBeNull();
  });

  it("follows every page, so a nonce on a later page is not read as paid", async () => {
    const { client, store } = await connected();
    store.patch({ approvals: [approved(4, 90), approved(3, 80), approved(1, 40)] });
    client.payoutsPages = { "": page([{ nonce: 2 }, { nonce: 3 }], { next: 3 }), "3": page([{ nonce: 4, withdrawal: signed(4, 2_000_000_000) }]) };
    await loadPayouts(store);
    expect(client.payoutsReads).toEqual([{ limit: 200 }, { limit: 200, after: 3 }]);
    expect(payoutsOf(store.getSnapshot()).map((p) => [p.nonce, p.status.kind])).toEqual([[4, "claimable"], [3, "waiting"], [1, "paid"]]);
  });

  it("settles nothing from a list it stopped reading before its end", async () => {
    const { client, store } = await connected();
    store.patch({ approvals: [approved(1, 40)] });
    client.payoutsPage = page([{ nonce: 9 }], { next: 9 });
    await loadPayouts(store);
    expect(client.payoutsReads).toHaveLength(20);
    expect(store.getSnapshot().payoutsRead).toBeNull();
    expect(payoutsOf(store.getSnapshot())[0]?.status.kind).toBe("waiting");
    expect(store.getSnapshot().payoutsProblem).toContain("longer than this page reads");
  });

  it("shows waiting with no message and no toast when the node predates the route, and keeps what the stream delivered", async () => {
    const { client, store } = await connected();
    store.patch({ approvals: [approved(2, 60), approved(1, 40)], authorizations: [signed(2, 2_000_000_000)] });
    client.payoutsError = new EngineError(404, "not found");
    await loadPayouts(store);
    await loadPayouts(store);
    expect(client.payoutsReads).toHaveLength(2);
    expect(store.getSnapshot()).toMatchObject({ payoutsProblem: null, payoutsRead: null, toasts: [] });
    expect(payoutsOf(store.getSnapshot()).map((p) => [p.nonce, p.status.kind])).toEqual([[2, "claimable"], [1, "waiting"]]);
  });

  it("says plainly that a failed read failed, with no toast, and reads again on the next trigger", async () => {
    const { client, store } = await connected();
    store.patch({ approvals: [approved(1, 40)] });
    client.payoutsError = new EngineError(0, "The node did not answer.");
    await loadPayouts(store);
    expect(store.getSnapshot().payoutsProblem).toBe("The node's list of your payouts could not be read: The node did not answer. It is read again when the next withdrawal is approved or the page reloads.");
    expect(store.getSnapshot().toasts).toEqual([]);
    expect(payoutsOf(store.getSnapshot())[0]?.status.kind).toBe("waiting");
    client.payoutsError = null;
    client.payoutsPage = page([{ nonce: 1, withdrawal: signed(1, 2_000_000_000) }]);
    await loadPayouts(store);
    expect(store.getSnapshot().payoutsProblem).toBeNull();
    expect(payoutsOf(store.getSnapshot())[0]?.status.kind).toBe("claimable");
  });

  it("drops an answer that arrives after the wallet changed, or after a later read began", async () => {
    const { client, store } = await connected();
    let release: () => void = () => undefined;
    const slow = (answer: PayoutsPage) => async () => { await new Promise<void>((resolve) => { release = resolve; }); return answer; };
    client.payouts = slow(page([{ nonce: 1, withdrawal: signed(1, 2_000_000_000) }]));
    const reading = loadPayouts(store);
    store.setWallet({ address: OTHER, label: "Other" });
    release();
    await reading;
    expect(store.getSnapshot()).toMatchObject({ authorizations: [], payoutsRead: null });
    store.setWallet({ address: ACCOUNT, label: "Test wallet" });
    client.payouts = slow(page([], { seq: 90 }));
    const first = loadPayouts(store);
    const holdFirst = release;
    client.payouts = async () => page([{ nonce: 1, withdrawal: signed(1, 2_000_000_000) }]);
    await loadPayouts(store);
    holdFirst();
    await first;
    expect(store.getSnapshot()).toMatchObject({ authorizations: [signed(1, 2_000_000_000)], payoutsRead: { seq: 100, listed: [1] } });
  });

  it("drops a failure that arrives after the wallet changed", async () => {
    const { client, store } = await connected();
    let fail: () => void = () => undefined;
    client.payouts = () => new Promise((_, reject) => { fail = () => reject(new EngineError(0, "The node did not answer.")); });
    const reading = loadPayouts(store);
    store.setWallet({ address: OTHER, label: "Other" });
    fail();
    await reading;
    expect(store.getSnapshot().payoutsProblem).toBeNull();
  });

  it("keeps only the authorizations of the connected account's own payouts, and a newer one the stream already delivered", async () => {
    const { client, store } = await connected();
    store.patch({ authorizations: [signed(2, 2_000_000_000)] });
    client.payoutsPage = page([{ nonce: 1, withdrawal: { ...signed(1, 2_000_000_000), account: OTHER } }, { nonce: 2, withdrawal: signed(2, 1_900_000_000) }, { nonce: 3, withdrawal: signed(4, 2_000_000_000) }]);
    await loadPayouts(store);
    expect(store.getSnapshot().authorizations).toEqual([signed(2, 2_000_000_000)]);
  });

  it("forgets what the node said about one wallet when the connection changes", async () => {
    const { client, store } = await connected();
    client.payoutsPage = page([]);
    await loadPayouts(store);
    expect(store.getSnapshot().payoutsRead).not.toBeNull();
    store.patch(NO_ACCOUNT);
    store.setWallet({ address: OTHER, label: "Other" });
    expect(store.getSnapshot()).toMatchObject({ payoutsRead: null, payoutsProblem: null });
  });
});

