/** Each read behind a list of history keeps the start the server states with its pages (monkey-trading/console#526). */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { settle } from "../engine/test-kit";
import { page } from "../ledger-kit";
import { started } from "../staking/history-reads-kit";
import { historyBeginsOf } from "./history-begins";
import { opened } from "./ledger-store-kit";
import { ACCOUNT, setup } from "./live-fake";
import { loadApprovals } from "./payouts";

const S = Date.UTC(2026, 9, 26, 13, 52);

describe("the reads behind the lists", () => {
  it("keeps the start of the account read's history, for the History tab", async () => {
    const { client, store } = setup();
    client.historyAnswer = () => ({ ...page([]), retained_from_ms: S });
    store.start(0);
    await settle();
    store.setWallet({ address: ACCOUNT, label: "test" });
    await store.refresh(false);
    await settle();
    expect(historyBeginsOf(store.getSnapshot())).toBe(S);
  });

  it("keeps the start of the approvals' pages, for the withdrawals list", async () => {
    const { client, store } = setup();
    store.start(0);
    await settle();
    store.setWallet({ address: ACCOUNT, label: "test" });
    await settle();
    client.historyAnswer = () => ({ ...page([]), retained_from_ms: S });
    await loadApprovals(store);
    expect(historyBeginsOf(store.getSnapshot())).toBe(S);
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

describe("the distributions card's reads", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("keeps the start its pages state", async () => {
    const { history, node, stop } = await started();
    expect(history.getSnapshot().begins).toBe(node.client.state.historyFromMs);
    stop();
  });
});
