/** Tests for the quotes and withdrawal authorizations the store keeps for the connected account, and the payouts built from them. */

import { describe, expect, it } from "vitest";

import type { HistoryEvent, MarketQuote, SignedWithdrawal } from "../engine/types";
import { fixedFromInt } from "../fixed";
import { ACCOUNT } from "../engine/wallet-kit";
import { applyFeedEvent, keepLatest, quoteSyncKey, syncQuotes } from "./funds";
import { connected } from "./live-kit";
import { payoutsOf } from "./payouts";
import { initialState, type ConsoleState } from "./state";

const ME = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const OTHER = "0x00000000000000000000000000000000000000aa";
const base = (): ConsoleState => ({ ...initialState([], { cash: "0", nav: "0", gross_exposure: "0" }, 0, () => [], "checked"), wallet: { address: ME, label: "Test" } });
const quote = (account: string, market = 1): MarketQuote => ({ type: "quote", account, market, open: true, reduce_only: false, stress_level: 0, mark: "1", ask: [], bid: [], close: null });
const signed = (nonce: number, expiresAt: number, account = ME): SignedWithdrawal => ({
  account, amount: "10", nonce, chain_id: 31337, vault: OTHER, signature: "0x22", approved_seq: 40,
  authorization: { signer: OTHER, signer_epoch: 1, issued_at: expiresAt - 86_400, expires_at: expiresAt, checkpoint_seq: 64, checkpoint_root: "0x33", siblings: [] },
});

describe("applyFeedEvent", () => {
  it("keeps the connected account's quote per market it asked about and clears a refusal, ignoring another account's or another market's", () => {
    const state = { ...base(), quoteError: "uncredited", quoted: [1] };
    expect(applyFeedEvent(state, { type: "quote", quote: quote(ME.toUpperCase().replace("0X", "0x")) })).toEqual({ quotes: { 1: quote(ME.toUpperCase().replace("0X", "0x")) }, quoteError: null });
    expect(applyFeedEvent(state, { type: "quote", quote: quote(OTHER) })).toBeNull();
    expect(applyFeedEvent(state, { type: "quote", quote: quote(ME, 2) })).toBeNull();
  });

  it("drops every quote once the feed goes stale, as none from before an outage is executable", () => {
    expect(applyFeedEvent({ ...base(), quotes: { 1: quote(ME) } }, { type: "feed", status: "stale" })).toEqual({ quotes: {} });
    expect(applyFeedEvent({ ...base(), quotes: { 1: quote(ME) } }, { type: "feed", status: "live" })).toBeNull();
    expect(applyFeedEvent(base(), { type: "feed", status: "stale" })).toBeNull();
  });

  it("drops every quote when the node refuses the request, and ignores a refusal with no wallet", () => {
    const state = { ...base(), quotes: { 1: quote(ME) } };
    expect(applyFeedEvent(state, { type: "quote_error", error: "uncredited" })).toEqual({ quotes: {}, quoteError: "uncredited" });
    expect(applyFeedEvent({ ...state, wallet: null }, { type: "quote_error", error: "uncredited" })).toBeNull();
  });

  it("keeps the latest authorization per payout for the connected account, and none without a typed authorization", () => {
    const state = { ...base(), authorizations: [signed(1, 100), signed(2, 100)] };
    expect(applyFeedEvent(state, { type: "withdrawal", withdrawal: signed(1, 200) })).toEqual({ authorizations: [signed(2, 100), signed(1, 200)] });
    expect(applyFeedEvent(state, { type: "withdrawal", withdrawal: signed(1, 200, OTHER) })).toBeNull();
    expect(applyFeedEvent(state, { type: "withdrawal", withdrawal: { ...signed(3, 100), authorization: undefined } })).toBeNull();
  });
});

describe("keepLatest", () => {
  const at = (epoch: number, expires: number): SignedWithdrawal => ({ ...signed(1, expires), authorization: { ...signed(1, expires).authorization, signer_epoch: epoch } as SignedWithdrawal["authorization"] });
  it.each([
    ["a later expiry in the same epoch", at(1, 100), at(1, 200), at(1, 200)],
    ["an earlier expiry in the same epoch", at(1, 200), at(1, 100), at(1, 200)],
    ["a later signer epoch, even expiring sooner", at(1, 200), at(2, 150), at(2, 150)],
    ["an earlier signer epoch", at(2, 150), at(1, 300), at(2, 150)],
  ])("keeps the newer authorization of a payout: %s", (_, held, arriving, kept) => {
    expect(keepLatest([held, signed(2, 50)], arriving).find((w) => w.nonce === 1)).toEqual(kept);
  });
});

describe("quoteSyncKey", () => {
  it("changes with the account, the selected market, the markets held and the account's credit, and with nothing else", () => {
    const start = base();
    const key = quoteSyncKey(start);
    const account = { balance: 0n, unfinalised: 0n, equity: 0n, margin: 0n, positions: [], orders: [] };
    expect(quoteSyncKey({ ...start, account })).not.toBe(key);
    expect(quoteSyncKey({ ...start, account: { ...account, positions: [{ market: 2, qty: 1n, entry: 1n }] } })).not.toBe(quoteSyncKey({ ...start, account }));
    expect(quoteSyncKey({ ...start, selected: 9 })).not.toBe(key);
    expect(quoteSyncKey({ ...start, wallet: null })).not.toBe(key);
    expect(quoteSyncKey({ ...start, toasts: [{ id: 1, tone: "ok", text: "x" }], quotes: { 1: quote(ME) } })).toBe(key);
  });
});

describe("syncQuotes", () => {
  it("asks for the selected market and those held, and drops the quotes of markets it no longer asks about", async () => {
    const { client, store } = await connected();
    store.patch({ selected: 2, quotes: { 1: quote(ME, 1), 2: quote(ME, 2) } });
    syncQuotes(store);
    expect(client.quoteRequests.at(-1)).toEqual({ account: ACCOUNT, markets: [2] });
    expect(store.getSnapshot()).toMatchObject({ quoted: [2], quotes: { 2: quote(ME, 2) } });
    expect(Object.keys(store.getSnapshot().quotes)).toEqual(["2"]);
    store.setWallet(null);
    syncQuotes(store);
    expect(client.quoteRequests.at(-1)).toBeNull();
    expect(store.getSnapshot()).toMatchObject({ quoted: [], quotes: {} });
  });
});

describe("payoutsOf", () => {
  const approved = (nonce: number, seq: number): HistoryEvent => ({ type: "withdrawal_approved", account: ME, amount: "10", nonce, cursor: `${seq}:0`, ts: 0 });

  it("says where each approval stands at node time: paid, claimable until it expires, expired, or waiting", () => {
    const state: ConsoleState = {
      ...base(), now: 1_000_000, paid: [1],
      approvals: [approved(4, 70), approved(3, 60), approved(2, 50), approved(1, 40), { type: "deposited", account: ME, amount: "10", cursor: "30:0", ts: 0 }],
      authorizations: [signed(1, 900), signed(2, 1_001), signed(3, 1_000)],
    };
    expect(payoutsOf(state).map(({ nonce, searchFrom, status, amount }) => ({ nonce, searchFrom, kind: status.kind, amount }))).toEqual([
      { nonce: 4, searchFrom: 70, kind: "waiting", amount: fixedFromInt(10) },
      { nonce: 3, searchFrom: 60, kind: "expired", amount: fixedFromInt(10) },
      { nonce: 2, searchFrom: 50, kind: "claimable", amount: fixedFromInt(10) },
      { nonce: 1, searchFrom: 40, kind: "paid", amount: fixedFromInt(10) },
    ]);
  });

  it("names a newer authorization the node signed but the page missed, and searches from where a reissue landed", () => {
    const state: ConsoleState = {
      ...base(), now: 1_000_000, approvals: [approved(2, 50), approved(1, 40)], authorizations: [signed(1, 900), signed(2, 900)],
      payoutHints: { 1: { newerUntil: 1_500, searchFrom: 90 }, 2: { newerUntil: 950 } },
    };
    expect(payoutsOf(state).map(({ nonce, searchFrom, status }) => ({ nonce, searchFrom, status }))).toEqual([
      { nonce: 2, searchFrom: 50, status: { kind: "expired", expiresAt: 950 } },
      { nonce: 1, searchFrom: 90, status: { kind: "missed", expiresAt: 1_500 } },
    ]);
  });
});
