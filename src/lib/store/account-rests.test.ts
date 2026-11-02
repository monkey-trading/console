/** Tests for the account's other reads resting with an uncredited account (monkey-trading/console#166): eligibility, the withdrawal queue and an empty history. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { settle } from "../engine/test-kit";
import type { EngineEvent } from "../engine/event-types";
import type { StreamMessage } from "../engine/types";
import { ACCOUNT, setup } from "./live-fake";
import { NOT_CREDITED_MS } from "./quiet-reads";
import type { ConsoleStore } from "./store";

const OTHER = "0x00000000000000000000000000000000000000bb";
const message = (seq: number, events: EngineEvent[]): StreamMessage => ({ offset: `${seq}:0`, type: "command", seq, ts: seq, cmd: { type: "deposit" }, events });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** A started store with the account connected and read once, the node answering 404 for it. */
async function connected() {
  const made = setup();
  made.store.start(0);
  await settle();
  made.store.setWallet({ address: ACCOUNT, label: "test" });
  await made.store.refresh(false);
  await settle();
  return made;
}

/** Refreshes `times` times as the ticks prompt it, `gapMs` apart. */
async function tickEvery(store: ConsoleStore, times: number, gapMs = 500) {
  for (let i = 0; i < times; i++) {
    await vi.advanceTimersByTimeAsync(gapMs);
    await store.refresh(false);
    await settle();
  }
}

const reads = (client: { eligibilityReads: number; queueReads: number; accountReads: number; historyReads: unknown[] }) => ({ eligibility: client.eligibilityReads, queue: client.queueReads, account: client.accountReads, history: client.historyReads.length });

describe("an account the node has not credited", () => {
  it("rests its eligibility and withdrawal queue with the account, and reads all three when the rest ends", async () => {
    const { client, store } = await connected();
    expect(reads(client)).toMatchObject({ eligibility: 1, queue: 1, account: 1 });
    await tickEvery(store, 4); // 2 s on: inside the rest
    expect(reads(client)).toMatchObject({ eligibility: 1, queue: 1, account: 1 });
    await tickEvery(store, 3); // 3.5 s on: the rest has ended
    expect(reads(client)).toMatchObject({ eligibility: 2, queue: 2, account: 2 });
  });

  it("reads its history once while it is empty, not on each refresh", async () => {
    const { client, store } = await connected();
    await tickEvery(store, 12, NOT_CREDITED_MS); // four rests have ended, so eligibility has been read again each time
    expect(client.eligibilityReads).toBe(13);
    expect(client.historyReads).toHaveLength(1);
  });

  it("reads everything at once on an event for the account, and an eligibility change shows promptly", async () => {
    const { client, store } = await connected();
    expect(store.getSnapshot().eligibility).toBeNull();
    client.declared = "professional";
    client.onMessage?.(message(20, [{ type: "eligibility_attested", account: ACCOUNT, class: "professional" }]));
    await settle();
    expect(store.getSnapshot().eligibility).toBe("professional");
    expect(reads(client)).toMatchObject({ eligibility: 2, queue: 2, account: 2, history: 2 });
  });

  it("is not read sooner by an event for another account", async () => {
    const { client } = await connected();
    client.onMessage?.(message(20, [{ type: "eligibility_attested", account: OTHER, class: "professional" }]));
    await settle();
    expect(reads(client)).toMatchObject({ eligibility: 1, queue: 1, account: 1, history: 1 });
  });

  it("is read in full by a refresh asked for after an event, an action or the stream's return", async () => {
    const { client, store } = await connected();
    client.declared = "professional";
    await store.refresh(true);
    expect(reads(client)).toMatchObject({ eligibility: 2, queue: 2, account: 2, history: 2 });
    expect(store.getSnapshot().eligibility).toBe("professional");
  });

  it("reads again from the start under a wallet connected after it left", async () => {
    const { client, store } = await connected();
    store.setWallet(null);
    store.setWallet({ address: ACCOUNT, label: "test" });
    await store.refresh(false);
    await settle();
    expect(reads(client)).toMatchObject({ eligibility: 2, queue: 2, account: 2, history: 2 });
  });
});

describe("a credited account with no history yet", () => {
  async function credited() {
    const made = await connected();
    made.client.credited = true;
    made.client.onMessage?.(message(20, [{ type: "deposited", account: ACCOUNT, amount: "5" }]));
    await settle();
    return made;
  }

  it("does not read its history again on each refresh, while the rest of its reads go on", async () => {
    const { client, store } = await credited();
    const before = reads(client);
    await tickEvery(store, 5, 100);
    const after = reads(client);
    expect([after.eligibility - before.eligibility, after.queue - before.queue, after.account - before.account]).toEqual([5, 5, 5]);
    expect(after.history).toBe(before.history);
  });

  it("reads it again after an event for the account", async () => {
    const { client } = await credited();
    const before = client.historyReads.length;
    client.onMessage?.(message(21, [{ type: "financing", account: ACCOUNT, market: 1, amount: "1" }]));
    await settle();
    expect(client.historyReads.length - before).toBe(1);
  });

  it("does not read a history that has rows again without an event", async () => {
    const { client, store } = await credited();
    client.historyAnswer = () => ({ events: [{ type: "deposited", account: ACCOUNT, amount: "5", cursor: "20:0", ts: 20 }], next: null });
    client.onMessage?.(message(22, [{ type: "deposited", account: ACCOUNT, amount: "5" }]));
    await settle();
    expect(store.getSnapshot().history).toHaveLength(1);
    const before = client.historyReads.length;
    await tickEvery(store, 3, 100);
    expect(client.historyReads.length).toBe(before);
  });
});
