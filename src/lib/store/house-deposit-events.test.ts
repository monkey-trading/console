/** Tests for a deposit for the house that screening holds: its events name no account, and belong to nobody's activity. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EngineEvent } from "../engine/event-types";
import { settle } from "../engine/test-kit";
import type { StreamMessage } from "../engine/types";
import { ACCOUNT } from "../engine/wallet-kit";
import { eventAccount, feedFrom, isMine } from "./feed";
import { connected } from "./live-kit";
import { ACCOUNT as WATCHED, setup } from "./live-fake";

const house = (type: "deposit_pending" | "deposit_held"): EngineEvent => ({ type, chain_ref: "0xabc:0", account: null, payer: null, amount: "10", reason: "payer_unknown" });
const deposit = (events: EngineEvent[]): StreamMessage => ({ offset: "7:0", type: "command", seq: 7, ts: 7, cmd: { type: "deposit" }, events });

describe.each(["deposit_pending", "deposit_held"] as const)("a house deposit's %s event", (type) => {
  it("is nobody's activity: no account, no feed line for any viewer", () => {
    const event = house(type);
    expect(eventAccount(event)).toBeUndefined();
    expect(isMine(event, ACCOUNT)).toBe(false);
    expect(isMine(event, undefined)).toBe(false);
    expect(feedFrom([deposit([event])], [], ACCOUNT, () => 1)).toEqual([]);
  });

  it("reaches a connected console's stream handler without throwing, adds no line and starts no account refresh", async () => {
    const { client, store } = await connected();
    await store.refresh(true);
    const reads = client.marketReads;
    const lines = store.getSnapshot().feed.length;
    client.deliver(deposit([house(type)]));
    await settle();
    expect(store.getSnapshot().feed).toHaveLength(lines);
    expect(client.marketReads).toBe(reads);
  });
});

describe("a deposit event that names an account", () => {
  it("is still that account's, and refreshes its reads", async () => {
    const { client, store } = await connected();
    await store.refresh(true);
    const reads = client.marketReads;
    client.deliver(deposit([{ type: "deposit_held", chain_ref: "0xabc:0", account: ACCOUNT, payer: ACCOUNT, amount: "10", reason: "payer_unknown" }]));
    await settle();
    expect(client.marketReads).toBeGreaterThan(reads);
  });
});

describe("a house deposit's event on a tick", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("does not make the paced read an account read: the history is not read again", async () => {
    const { client, store } = setup();
    store.start(0);
    await settle();
    store.setWallet({ address: WATCHED, label: "test" });
    client.credited = true;
    client.historyAnswer = () => ({ events: [{ type: "deposited", account: WATCHED, amount: "5", cursor: "1:0", ts: 1 }], next: null });
    await store.refresh(true);
    const reads = client.historyReads.length;
    client.onMessage?.({ ...deposit([house("deposit_held")]), cmd: { type: "tick" } });
    await vi.advanceTimersByTimeAsync(2_000);
    await settle();
    expect(client.historyReads).toHaveLength(reads);
  });
});
