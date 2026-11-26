/** Each read behind a list of history keeps the start the server states with its pages, with the rows it produced (monkey-trading/console#526, #528). */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { settle } from "../engine/test-kit";
import { page } from "../ledger-kit";
import { started } from "../staking/history-reads-kit";
import { opened } from "./ledger-store-kit";
import { ACCOUNT, setup } from "./live-fake";
import { disconnectWallet } from "./actions";
import { loadApprovals } from "./payouts";

const S = Date.UTC(2026, 9, 26, 13, 52);

async function connected() {
  const made = setup();
  made.store.start(0);
  await settle();
  made.store.setWallet({ address: ACCOUNT, label: "test" });
  await settle();
  return made;
}

describe("the reads behind the lists", () => {
  it("keeps the start of the account read's history, for the History tab", async () => {
    const { client, store } = setup();
    client.historyAnswer = () => ({ ...page([]), retained_from_ms: S });
    store.start(0);
    await settle();
    store.setWallet({ address: ACCOUNT, label: "test" });
    await store.refresh(false);
    await settle();
    expect(store.getSnapshot().historyBegins).toBe(S);
  });

  it("keeps the start of the approvals' pages, for the withdrawals list", async () => {
    const { client, store } = await connected();
    client.historyAnswer = () => ({ ...page([]), retained_from_ms: S });
    await loadApprovals(store);
    expect(store.getSnapshot().approvalsBegins).toBe(S);
  });

  it("keeps the earliest start any page of the ledger stated, for the P&L tab", async () => {
    const { client, store, ledger } = await opened();
    client.historyAnswer = ({ kind }) => ({ ...page([]), retained_from_ms: kind === "fill" ? S + 5000 : S });
    store.ledger.reset();
    store.ledger.open(ACCOUNT);
    await settle();
    expect(ledger().begins).toBe(S);
  });
});

describe("a start another view's read states", () => {
  it("leaves the History tab's start with the read its rows came from", async () => {
    const { client, store } = await connected();
    client.historyAnswer = () => ({ ...page([]), retained_from_ms: S });
    await store.refresh(true);
    client.historyAnswer = () => ({ ...page([]), retained_from_ms: S + 5000 });
    await loadApprovals(store);
    store.ledger.open(ACCOUNT);
    await settle();
    expect(store.getSnapshot().historyBegins).toBe(S);
    expect(store.getSnapshot().approvalsBegins).toBe(S + 5000);
  });

  it("is replaced by the start of the next read of the history's own rows", async () => {
    const { client, store } = await connected();
    client.historyAnswer = () => ({ ...page([]), retained_from_ms: S });
    await store.refresh(true);
    client.historyAnswer = () => ({ ...page([]), retained_from_ms: S + 5000 });
    await store.refresh(true);
    expect(store.getSnapshot().historyBegins).toBe(S + 5000);
  });

  it("is cleared with the rows when the wallet changes", async () => {
    const { client, store } = await connected();
    client.historyAnswer = () => ({ ...page([]), retained_from_ms: S });
    await store.refresh(true);
    await loadApprovals(store);
    disconnectWallet(store);
    await settle();
    expect(store.getSnapshot().historyBegins).toBeNull();
    expect(store.getSnapshot().approvalsBegins).toBeNull();
  });
});

describe("the distributions card's reads", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("keeps the start its pages state", async () => {
    const { history, node, stop } = await started();
    expect(history.getSnapshot().begins).toBe(node.client.state.historyFromMs);
    stop();
  });
});
