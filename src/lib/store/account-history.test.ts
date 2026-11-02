/** Tests for what the connected account's reads say of its history, which the exit proof's verdict on an account leans on. */

import { describe, expect, it } from "vitest";

import { settle } from "../engine/test-kit";
import { ACCOUNT, setup } from "./live-fake";

const OTHER = "0x00000000000000000000000000000000000000bb";

/** A started store with the account connected, its history answering as `answer` does. */
async function connected(answer: () => { events: never[]; next: null }) {
  const made = setup();
  made.store.start(0);
  await settle();
  made.client.historyAnswer = answer;
  made.store.setWallet({ address: ACCOUNT, label: "test" });
  return made;
}

const EMPTY = () => ({ events: [] as never[], next: null });
const FAILS = () => { throw new Error("The node did not answer."); };

describe("the account's first read of its history", () => {
  it("is waited for until it lands, after the account's own read", async () => {
    const { store } = await connected(EMPTY);
    expect(store.getSnapshot().accountHistory).toBe("waiting");
    await store.refresh(false);
    await settle();
    expect(store.getSnapshot().accountRead).toBe(true);
    expect(store.getSnapshot().accountHistory).toBe("read");
  });
  it("says it failed, which an empty history does not", async () => {
    const { store } = await connected(FAILS);
    await store.refresh(false);
    await settle();
    expect(store.getSnapshot().accountRead).toBe(true);
    expect(store.getSnapshot().accountHistory).toBe("failed");
    expect(store.getSnapshot().history).toEqual([]);
  });
  it("is read once a read that failed answers", async () => {
    const { client, store } = await connected(FAILS);
    await store.refresh(false);
    await settle();
    client.historyAnswer = EMPTY;
    store.quiet.accountEvent();
    await store.refresh(true);
    await settle();
    expect(store.getSnapshot().accountHistory).toBe("read");
  });
  it("stays read when a later read fails, as what it read still stands", async () => {
    const { client, store } = await connected(EMPTY);
    await store.refresh(false);
    await settle();
    client.historyAnswer = FAILS;
    await store.refresh(true);
    await settle();
    expect(store.getSnapshot().accountHistory).toBe("read");
  });
  it("is waited for again by the next wallet", async () => {
    const { store } = await connected(EMPTY);
    await store.refresh(false);
    await settle();
    store.setWallet({ address: OTHER, label: "test" });
    expect(store.getSnapshot().accountHistory).toBe("waiting");
  });
});
