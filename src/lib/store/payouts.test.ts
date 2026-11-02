/** Tests for the payout actions: reading approvals and paid nonces, claiming, reading the node's payouts and asking for a fresh authorization. */

import { describe, expect, it } from "vitest";

import { EngineError } from "../engine/client";
import vectors from "../engine/eip712-vectors.json";
import { reissueTypedData, requestDomain } from "../engine/eip712";
import { settle } from "../engine/test-kit";
import { ACCOUNT } from "../engine/wallet-kit";
import { WatchConnector } from "../engine/watch-wallet";
import { checkPaid, claim, loadApprovals, payoutsOf, reissue, unreadPayouts } from "./payouts";
import { connected, signerOf, VAULT } from "./live-kit";
import { approved, OTHER, page, signed } from "./payouts-kit";

describe("approvals and paid payouts", () => {
  it("reads every approval by kind, apart from the recent history, and keeps it only for the account that asked", async () => {
    const { client, store } = await connected();
    client.historyPage = { events: [approved(2, 50), approved(1, 40)], next: null };
    await loadApprovals(store);
    expect(client.historyReads.at(-1)).toEqual({ kind: "withdrawal_approved" });
    expect(store.getSnapshot().approvals.map((e) => e.type === "withdrawal_approved" && e.nonce)).toEqual([2, 1]);
    const reading = loadApprovals(store);
    store.setWallet({ address: OTHER, label: "Other" });
    store.patch({ approvals: [] });
    await reading;
    expect(store.getSnapshot().approvals).toEqual([]);
  });

  it("follows every page of approvals the node returns", async () => {
    const { client, store } = await connected();
    client.historyPages = { "": { events: [approved(3, 60)], next: "60:0" }, "60:0": { events: [approved(2, 50)], next: "50:0" }, "50:0": { events: [approved(1, 40)], next: null } };
    await loadApprovals(store);
    expect(store.getSnapshot().approvals.map((e) => e.type === "withdrawal_approved" && e.nonce)).toEqual([3, 2, 1]);
    expect(client.historyReads).toHaveLength(3);
  });

  it("lists every unpaid payout and at most five paid ones", async () => {
    const { store } = await connected();
    store.patch({ approvals: Array.from({ length: 12 }, (_, i) => approved(12 - i, 100 - i)), paid: [12, 11, 10, 9, 8, 7, 6] });
    expect(payoutsOf(store.getSnapshot()).map((p) => [p.nonce, p.status.kind])).toEqual([
      [5, "waiting"], [4, "waiting"], [3, "waiting"], [2, "waiting"], [1, "waiting"],
      [12, "paid"], [11, "paid"], [10, "paid"], [9, "paid"], [8, "paid"],
    ]);
  });

  it("reads the vault's record of every listed approval, once each, and says when the wallet is on another chain", async () => {
    const paid = await connected({ paid: true });
    paid.store.patch({ approvals: [approved(2, 50), approved(1, 40)], authorizations: [signed(1, 2_000_000_000)] });
    await checkPaid(paid.store);
    expect(paid.store.getSnapshot()).toMatchObject({ paid: [2, 1], unpaid: [] });
    expect(paid.provider.calls.filter((c) => c.method === "eth_call")).toHaveLength(2);
    await checkPaid(paid.store);
    expect(paid.provider.calls.filter((c) => c.method === "eth_call")).toHaveLength(2);
    const unpaid = await connected({ paid: false });
    unpaid.store.patch({ approvals: [approved(1, 40)], authorizations: [signed(1, 2_000_000_000)] });
    await checkPaid(unpaid.store);
    expect(unpaid.store.getSnapshot()).toMatchObject({ paid: [], unpaid: [1] });
    expect(payoutsOf(unpaid.store.getSnapshot())[0]).toMatchObject({ read: true, status: { kind: "claimable" } });
    const elsewhere = await connected({ paid: true, chainId: 1 });
    elsewhere.store.patch({ approvals: [approved(1, 40)], authorizations: [signed(1, 2_000_000_000)] });
    await checkPaid(elsewhere.store);
    expect(elsewhere.store.getSnapshot()).toMatchObject({ paid: [], unpaid: [] });
    expect(payoutsOf(elsewhere.store.getSnapshot())[0]?.read).toBe(false);
    expect(elsewhere.store.getSnapshot().toasts.at(-1)?.text).toBe("The vault's payouts could not be read: your wallet is on chain 1, not chain 31337");
  });

  it("reads each payout once in one run at a time, however often the page asks again, including one that arrives during the run", async () => {
    const { provider, store } = await connected();
    store.patch({ approvals: [approved(3, 60), approved(2, 50), approved(1, 40)], authorizations: [signed(1, 2_000_000_000)] });
    // The claims section asks again whenever the unread payouts change; here on every change.
    const stop = store.subscribe(() => {
      const state = store.getSnapshot();
      if (state.unpaid.length === 1 && state.approvals.length === 3) store.patch({ approvals: [approved(4, 70), ...state.approvals] });
      void checkPaid(store);
    });
    await checkPaid(store);
    await settle();
    stop();
    expect(provider.calls.filter((c) => c.method === "eth_call")).toHaveLength(4);
    expect(store.getSnapshot().unpaid).toEqual([3, 4, 2, 1]);
  });

  it("reads nothing and reports nothing for a watched account, whose payouts stay unread rather than unpaid", async () => {
    const { store } = await connected();
    store.liveWallet = await new WatchConnector(() => `?account=${ACCOUNT}`).connect();
    store.patch({ now: 1_800_000_000_000, approvals: [approved(1, 40)], authorizations: [signed(1, 1_700_000_000)] });
    const toasts = store.getSnapshot().toasts.length;
    await checkPaid(store);
    expect(store.getSnapshot().toasts).toHaveLength(toasts);
    expect(payoutsOf(store.getSnapshot())[0]).toMatchObject({ read: false, status: { kind: "expired" } });
  });
});

describe("approvals paging", () => {
  it("drops an approvals read that a later one overtook", async () => {
    const { client, store } = await connected();
    const slow = { events: [approved(1, 40)], next: null };
    let release: () => void = () => undefined;
    client.history = async () => { await new Promise<void>((resolve) => { release = resolve; }); return slow; };
    const first = loadApprovals(store);
    const holdFirst = release;
    client.history = async () => ({ events: [approved(2, 50), approved(1, 40)], next: null });
    await loadApprovals(store);
    holdFirst();
    await first;
    expect(store.getSnapshot().approvals.map((e) => e.type === "withdrawal_approved" && e.nonce)).toEqual([2, 1]);
  });

  it("keeps the cursor of older approvals past the page budget, and reads on from it", async () => {
    const { client, store } = await connected();
    client.historyPages = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [i === 0 ? "" : `${100 - i}:0`, { events: [approved(100 - i, 100 - i)], next: `${99 - i}:0` }]));
    await loadApprovals(store);
    expect(store.getSnapshot().approvals).toHaveLength(20);
    expect(store.getSnapshot().approvalsNext).toBe("80:0");
    await loadApprovals(store, true);
    expect(store.getSnapshot().approvals).toHaveLength(21);
  });
});

describe("payouts after a reload, with no authorization held", () => {
  it("shows a payout the vault has paid as paid, and one it has not as waiting once that is read", async () => {
    const paid = await connected({ paid: true });
    paid.store.patch({ approvals: [approved(1, 40)] });
    expect(unreadPayouts(paid.store.getSnapshot())).toEqual([1]);
    expect(payoutsOf(paid.store.getSnapshot())[0]).toMatchObject({ read: false, status: { kind: "waiting" } });
    await checkPaid(paid.store);
    expect(payoutsOf(paid.store.getSnapshot())[0]).toMatchObject({ read: true, status: { kind: "paid" } });
    const unpaid = await connected({ paid: false });
    unpaid.store.patch({ approvals: [approved(1, 40)] });
    await checkPaid(unpaid.store);
    expect(payoutsOf(unpaid.store.getSnapshot())[0]).toMatchObject({ read: true, status: { kind: "waiting" } });
  });

  it("reads the newest approval first, one read at a time, and reads a nonce again once a failed claim clears it", async () => {
    const { provider, store } = await connected({ paid: false });
    store.patch({ approvals: [approved(3, 60), approved(2, 50), approved(1, 40)] });
    await checkPaid(store);
    expect(provider.calls.filter((c) => c.method === "eth_call")).toHaveLength(3);
    // `unpaid` fills in the order the reads settled.
    expect(store.getSnapshot().unpaid).toEqual([3, 2, 1]);
    store.patch({ unpaid: [3, 1] });
    expect(unreadPayouts(store.getSnapshot())).toEqual([2]);
  });

  it("settles neither way when the vault cannot be read", async () => {
    const elsewhere = await connected({ paid: true, chainId: 1 });
    elsewhere.store.patch({ approvals: [approved(1, 40)] });
    await checkPaid(elsewhere.store);
    expect(elsewhere.store.getSnapshot()).toMatchObject({ paid: [], unpaid: [] });
    expect(payoutsOf(elsewhere.store.getSnapshot())[0]).toMatchObject({ read: false, status: { kind: "waiting" } });
    const watched = await connected();
    watched.store.liveWallet = await new WatchConnector(() => `?account=${ACCOUNT}`).connect();
    watched.store.patch({ approvals: [approved(1, 40)] });
    await checkPaid(watched.store);
    expect(payoutsOf(watched.store.getSnapshot())[0]).toMatchObject({ read: false, status: { kind: "waiting" } });
  });
});

describe("claims", () => {
  it("claims with the authorization and marks it paid, even while the node's feed is stale", async () => {
    const { provider, store } = await connected();
    store.patch({ approvals: [approved(1, 40)], authorizations: [signed(1, 2_000_000_000)], stream: "stale" });
    await claim(store, 1);
    expect(provider.sent).toHaveLength(1);
    expect(store.getSnapshot()).toMatchObject({ paid: [1], busy: false, prompt: null });
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("The vault paid 10 USDC to your wallet.");
  });

  it("leaves a payout unpaid when its claim reverts, and has the vault's record of it read again", async () => {
    const { store } = await connected({ receiptStatus: "0x0" });
    store.patch({ approvals: [approved(1, 40)], authorizations: [signed(1, 2_000_000_000)], unpaid: [1] });
    await claim(store, 1);
    expect(store.getSnapshot().paid).toEqual([]);
    expect(unreadPayouts(store.getSnapshot())).toEqual([1]);
    expect(store.getSnapshot().toasts.at(-1)?.text).toContain("failed on chain");
  });

  it("does not mark another account's payout paid when the wallet changed during the claim", async () => {
    const { store } = await connected();
    store.patch({ approvals: [approved(1, 40)], authorizations: [signed(1, 2_000_000_000)] });
    const claiming = claim(store, 1);
    store.setWallet({ address: OTHER, label: "Other" });
    store.patch({ paid: [] });
    await claiming;
    expect(store.getSnapshot().paid).toEqual([]);
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe(`The vault paid 10 USDC to ${ACCOUNT}.`);
  });
});

describe("authorizations", () => {
  it("asks for a fresh authorization with a ReissueRequest the account signs over the expired one's expiry, then reads the node's payouts", async () => {
    const { client, store } = await connected();
    client.payoutsPage = page([{ nonce: 3, withdrawal: signed(3, 2_000_000_000) }]);
    await reissue(store, 3, 1_700_000_000);
    const posted = client.posted[0];
    expect(posted?.route).toBe("reissue 3");
    const body = posted?.body as { replaces_expires_at: number; signature: string };
    expect(body.replaces_expires_at).toBe(1_700_000_000);
    expect(await signerOf(reissueTypedData(requestDomain(vectors.chain_id, VAULT), ACCOUNT, 3, 1_700_000_000), body.signature)).toBe(ACCOUNT);
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("Requested. The new authorization arrives here once the node signs it.");
    expect(client.payoutsReads).toHaveLength(1);
    expect(store.getSnapshot().authorizations).toEqual([signed(3, 2_000_000_000)]);
  });

  it("explains a reissue the node refuses for holding no unpaid approval under its nonce, and has the vault's record read again", async () => {
    const { client, store } = await connected();
    store.patch({ authorizations: [signed(3, 1_700_000_000)], unpaid: [3] });
    client.answer = () => { throw new EngineError(404, "not found"); };
    await reissue(store, 3, 1_700_000_000);
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("The node holds no unpaid withdrawal 3 for this account: the vault has paid it, or the node is still loading it after a restart.");
    // The vault's record of it is read again.
    expect(unreadPayouts(store.getSnapshot())).toEqual([3]);
    expect(client.payoutsReads).toEqual([]);
  });

  it("reads the node's payouts again when it says a newer authorization replaced the expired one", async () => {
    const { client, store } = await connected();
    client.answer = () => { throw new EngineError(400, "the latest authorization expires at 1700086400, not the one replaced"); };
    client.payoutsPage = page([{ nonce: 3, withdrawal: signed(3, 1_700_086_400) }]);
    await reissue(store, 3, 1_700_000_000);
    expect(client.posted).toHaveLength(1);
    expect(client.payoutsReads).toHaveLength(1);
    expect(store.getSnapshot().authorizations).toEqual([signed(3, 1_700_086_400)]);
    expect(store.getSnapshot()).toMatchObject({ busy: false });
    expect(store.getSnapshot().toasts.map((t) => t.text)).toEqual(["The node has signed a newer authorization for this withdrawal, valid until 15 Nov 22:13:20 UTC; reading it from the node."]);
  });

  it("reads nothing after a reissue refused for any other reason", async () => {
    const { client, store } = await connected();
    client.answer = () => { throw new EngineError(500, "the node failed"); };
    await reissue(store, 3, 1_700_000_000);
    expect(client.payoutsReads).toEqual([]);
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("the node failed");
  });

  it("reads the node's payouts after a reissue only for the wallet that asked", async () => {
    const { client, store } = await connected();
    const asking = reissue(store, 3, 1_700_000_000);
    store.setWallet({ address: OTHER, label: "Other" });
    await asking;
    expect(client.payoutsReads).toEqual([]);
  });
});
