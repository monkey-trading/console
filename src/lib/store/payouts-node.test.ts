/** Tests for reading the node's unpaid approvals: statuses from a fresh load, what an absent nonce means, paging, a node without the route, and wallet changes mid-read. */

import { describe, expect, it } from "vitest";

import { EngineError } from "../engine/client";
import type { PayoutsPage, SignedWithdrawal } from "../engine/types";
import { ACCOUNT } from "../engine/wallet-kit";
import { applyFeedEvent } from "./funds";
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
    expect(store.getSnapshot().notices).toEqual({});
    // The nonces the answer lists still get the vault read; the absent one is paid without it.
    await checkPaid(store);
    expect(provider.calls.filter((c) => c.method === "eth_call")).toHaveLength(3);
    expect(store.getSnapshot()).toMatchObject({ paid: [], unpaid: expect.arrayContaining([3, 4, 5]) });
  });

  it("names the boundary an approval waits for its log check at, the unexpired authorization it lists included, and none for a bad time (monkey-trading/console#280)", async () => {
    const { client, store } = await connected();
    store.patch({ now: NOW_MS, approvals: [approved(5, 90), approved(4, 80), approved(3, 70)] });
    client.payoutsPage = page([
      { nonce: 5, check: { turn: 9, boundary_ms: NOW_MS + 3_600_000 } },
      { nonce: 4, check: { turn: 9, boundary_ms: -1 } },
      // An authorization of an earlier signer epoch: unexpired, and not usable, which is why the node names a check.
      { nonce: 3, withdrawal: signed(3, 2_000_000_000), check: { turn: 9, boundary_ms: NOW_MS + 3_600_000 } },
    ]);
    await loadPayouts(store);
    expect(payoutsOf(store.getSnapshot()).map((p) => [p.nonce, p.status])).toEqual([
      [5, { kind: "waiting", checkAtMs: NOW_MS + 3_600_000 }], [4, { kind: "waiting" }], [3, { kind: "waiting", checkAtMs: NOW_MS + 3_600_000 }],
    ]);
  });

  it("shows an approval that waits for an installation with no time, reads a check with no waits as a boundary, and keeps both kinds apart (monkey-trading/console#521)", async () => {
    const { client, store } = await connected();
    store.patch({ now: NOW_MS, approvals: [approved(5, 90), approved(4, 80), approved(3, 70), approved(2, 60)] });
    client.payoutsPage = page([
      { nonce: 5, check: { turn: 9, waits: "installation" } },
      { nonce: 4, check: { turn: 9, waits: "boundary", boundary_ms: NOW_MS + 3_600_000 } },
      { nonce: 3, check: { turn: 9, boundary_ms: NOW_MS + 3_600_000 } },
      // A boundary check with no time is a bad answer, as before.
      { nonce: 2, check: { turn: 9, waits: "boundary", boundary_ms: 0 } },
    ]);
    await loadPayouts(store);
    expect(payoutsOf(store.getSnapshot()).map((p) => [p.nonce, p.status])).toEqual([
      [5, { kind: "waiting", installation: true }], [4, { kind: "waiting", checkAtMs: NOW_MS + 3_600_000 }], [3, { kind: "waiting", checkAtMs: NOW_MS + 3_600_000 }], [2, { kind: "waiting" }],
    ]);
  });

  it("shows an approval that waits for a routine check with no time, whether the covering checkpoint is named or null, and leaves a malformed one at the plain wait (monkey-trading/console#535)", async () => {
    const { client, store } = await connected();
    store.patch({ now: NOW_MS, approvals: [approved(5, 90), approved(4, 80), approved(3, 70)] });
    client.payoutsPage = page([
      { nonce: 5, check: { waits: "check", checkpoint_seq: 812 } },
      { nonce: 4, check: { waits: "check", checkpoint_seq: null } },
      { nonce: 3, check: { waits: "check", checkpoint_seq: -1 } },
    ]);
    await loadPayouts(store);
    expect(payoutsOf(store.getSnapshot()).map((p) => [p.nonce, p.status])).toEqual([
      [5, { kind: "waiting", routine: true }], [4, { kind: "waiting", routine: true }], [3, { kind: "waiting" }],
    ]);
  });

  it("keeps the check an answer names while the node is still loading, without taking an approval it omits as paid, and replaces it by the next complete answer", async () => {
    const { client, store } = await connected();
    store.patch({ now: NOW_MS, approvals: [approved(6, 100), approved(5, 90), approved(4, 80)] });
    client.payoutsPage = page([{ nonce: 5, check: { turn: 9, boundary_ms: NOW_MS + 60_000 } }], { loaded: false });
    await loadPayouts(store);
    const state = store.getSnapshot();
    expect(state.payoutsRead).toBeNull();
    expect(state.payoutsProblem).toContain("still loading");
    // The row names its boundary, and an approval the answer omits is still waiting, not paid.
    expect(payoutsOf(state).map((p) => [p.nonce, p.status])).toEqual([[6, { kind: "waiting" }], [5, { kind: "waiting", checkAtMs: NOW_MS + 60_000 }], [4, { kind: "waiting" }]]);
    // A check held for an approval a later incomplete answer omits stays; one it lists without a check goes.
    client.payoutsPage = page([{ nonce: 6, check: { turn: 9, boundary_ms: NOW_MS + 90_000 } }], { loaded: false });
    await loadPayouts(store);
    expect(payoutsOf(store.getSnapshot()).map((p) => p.status)).toEqual([{ kind: "waiting", checkAtMs: NOW_MS + 90_000 }, { kind: "waiting", checkAtMs: NOW_MS + 60_000 }, { kind: "waiting" }]);
    client.payoutsPage = page([{ nonce: 5 }, { nonce: 6 }]);
    await loadPayouts(store);
    expect(payoutsOf(store.getSnapshot()).map((p) => [p.nonce, p.status])).toEqual([[6, { kind: "waiting" }], [5, { kind: "waiting" }], [4, { kind: "paid" }]]);
  });

  it("offers a claim beside a named check only for an unexpired authorization later than every one held when the node named it", async () => {
    const at = (epoch: number, expiresAt: number): SignedWithdrawal => {
      const base = signed(5, expiresAt);
      if (base.authorization === undefined) throw new Error("the fixture carries an authorization");
      return { ...base, authorization: { ...base.authorization, signer_epoch: epoch } };
    };
    const CHECK = { kind: "waiting", checkAtMs: NOW_MS + 60_000 };
    // `during` arrives through the stream while the read is on its way, after the node named the check.
    const cases: { held?: SignedWithdrawal; listed?: SignedWithdrawal; during?: SignedWithdrawal; streamed?: SignedWithdrawal; kind: string }[] = [
      { listed: at(1, 2_000_000_000), kind: "waiting" },
      { listed: at(1, 2_000_000_000), streamed: at(2, 2_000_000_000), kind: "claimable" },
      { listed: at(2, 1_900_000_000), streamed: at(2, 2_000_000_000), kind: "claimable" },
      { listed: at(1, 2_000_000_000), streamed: at(2, 1_700_000_000), kind: "waiting" },
      { listed: at(2, 2_000_000_000), streamed: at(1, 2_100_000_000), kind: "waiting" },
      { held: at(1, 2_000_000_000), kind: "waiting" },
      { listed: at(1, 2_000_000_000), during: at(2, 2_000_000_000), kind: "claimable" },
      { held: at(1, 2_000_000_000), during: at(2, 2_000_000_000), kind: "claimable" },
    ];
    for (const { held, listed, during, streamed, kind } of cases) {
      const { client, store } = await connected();
      const read = client.payouts.bind(client);
      client.payouts = async (account, page) => {
        const answer = await read(account, page);
        if (during !== undefined) store.patch(applyFeedEvent(store.getSnapshot(), { type: "withdrawal", withdrawal: during }) ?? {});
        return answer;
      };
      store.patch({ now: NOW_MS, approvals: [approved(5, 90)], authorizations: held === undefined ? [] : [held] });
      client.payoutsPage = page([{ nonce: 5, ...(listed === undefined ? {} : { withdrawal: listed }), check: { turn: 9, boundary_ms: NOW_MS + 60_000 } }]);
      await loadPayouts(store);
      if (streamed !== undefined) store.patch(applyFeedEvent(store.getSnapshot(), { type: "withdrawal", withdrawal: streamed }) ?? {});
      const status = payoutsOf(store.getSnapshot())[0]?.status;
      expect(kind === "waiting" ? status : status?.kind).toEqual(kind === "waiting" ? CHECK : kind);
    }
  });

  it("waits on the named check, not on an expired authorization it still holds, while the node names a check for its replacement", async () => {
    const { client, store } = await connected();
    store.patch({ now: NOW_MS, approvals: [approved(5, 90)] });
    client.payoutsPage = page([{ nonce: 5, withdrawal: signed(5, 1_700_000_000), check: { turn: 9, boundary_ms: NOW_MS + 60_000 } }]);
    await loadPayouts(store);
    expect(payoutsOf(store.getSnapshot())[0]?.status).toEqual({ kind: "waiting", checkAtMs: NOW_MS + 60_000 });
    // With no check named it is the expired authorization a fresh one can be asked for.
    client.payoutsPage = page([{ nonce: 5, withdrawal: signed(5, 1_700_000_000) }]);
    await loadPayouts(store);
    expect(payoutsOf(store.getSnapshot())[0]?.status).toMatchObject({ kind: "expired" });
  });

  it("forgets a boundary once the node's next answer names none for the approval", async () => {
    const { client, store } = await connected();
    store.patch({ now: NOW_MS, approvals: [approved(5, 90)] });
    client.payoutsPage = page([{ nonce: 5, check: { turn: 9, boundary_ms: NOW_MS + 1 } }]);
    await loadPayouts(store);
    expect(payoutsOf(store.getSnapshot())[0]?.status).toEqual({ kind: "waiting", checkAtMs: NOW_MS + 1 });
    client.payoutsPage = page([{ nonce: 5 }]);
    await loadPayouts(store);
    expect(payoutsOf(store.getSnapshot())[0]?.status).toEqual({ kind: "waiting" });
  });

  it("reads an absent nonce as paid only from a loaded answer, and not for an approval the answer predates", async () => {
    const { client, store } = await connected();
    store.patch({ approvals: [approved(6, 120), approved(2, 60)] });
    client.payoutsPage = page([], { loaded: false });
    await loadPayouts(store);
    expect(payoutsOf(store.getSnapshot()).map((p) => [p.nonce, p.status.kind])).toEqual([[6, "waiting"], [2, "waiting"]]);
    expect(unreadPayouts(store.getSnapshot())).toEqual([6, 2]);
    expect(store.getSnapshot().payoutsProblem).toContain("still loading");
    expect(store.getSnapshot().notices).toEqual({});
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
    expect(store.getSnapshot().payoutsProblem).toContain("more approved withdrawals than can be shown on this page");
  });

  it("shows waiting with no message and no notice when the node predates the route, and keeps what the stream delivered", async () => {
    const { client, store } = await connected();
    store.patch({ approvals: [approved(2, 60), approved(1, 40)], authorizations: [signed(2, 2_000_000_000)] });
    client.payoutsError = new EngineError(404, "not found");
    await loadPayouts(store);
    await loadPayouts(store);
    expect(client.payoutsReads).toHaveLength(2);
    expect(store.getSnapshot()).toMatchObject({ payoutsProblem: null, payoutsRead: null, notices: {} });
    expect(payoutsOf(store.getSnapshot()).map((p) => [p.nonce, p.status.kind])).toEqual([[2, "claimable"], [1, "waiting"]]);
  });

  it("says plainly that a failed read failed, with no notice, and reads again on the next trigger", async () => {
    const { client, store } = await connected();
    store.patch({ approvals: [approved(1, 40)] });
    client.payoutsError = new EngineError(0, "The server did not respond.");
    await loadPayouts(store);
    expect(store.getSnapshot().payoutsProblem).toBe("Your approved withdrawals could not be loaded. The server did not respond. The app checks again automatically when the next check of the server's records is due, when your next withdrawal is approved, or when you reload the page.");
    expect(store.getSnapshot().notices).toEqual({});
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
    client.payouts = () => new Promise((_, reject) => { fail = () => reject(new EngineError(0, "The server did not respond.")); });
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

