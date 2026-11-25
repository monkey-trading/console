/** Tests for where the served history begins (monkey-trading/console#526): kept from the server's answers, never fixed. */

import { describe, expect, it } from "vitest";

import type { HistoryPage } from "../engine/types";
import { settle } from "../engine/test-kit";
import { createMockNode } from "../mock";
import { DEMO_ADDRESS } from "../mock/demo";
import { emptySince, historyBeginsNote, historyBeginsOf, readHistory } from "./history-begins";
import { ACCOUNT, setup } from "./live-fake";

const OTHER = "0x00000000000000000000000000000000000000bb";
const START = Date.UTC(2026, 9, 26, 13, 52);

async function connected() {
  const made = setup();
  made.store.start(0);
  await settle();
  made.store.setWallet({ address: ACCOUNT, label: "test" });
  await settle();
  return made;
}

describe("the start of the served history", () => {
  it("is kept from the page a read answers, and moves only forward", async () => {
    const { client, store } = await connected();
    client.historyAnswer = () => ({ events: [], next: null, retained_from_ms: START });
    await readHistory(store, ACCOUNT, { limit: 1 });
    expect(historyBeginsOf(store.getSnapshot())).toBe(START);
    client.historyAnswer = () => ({ events: [], next: null, retained_from_ms: START + 1000 });
    await readHistory(store, ACCOUNT, { limit: 1 });
    expect(historyBeginsOf(store.getSnapshot())).toBe(START + 1000);
    client.historyAnswer = () => ({ events: [], next: null, retained_from_ms: START });
    await readHistory(store, ACCOUNT, { limit: 1 });
    expect(historyBeginsOf(store.getSnapshot())).toBe(START + 1000);
  });

  it("is not kept from a page that states none, and belongs to the account it was read for", async () => {
    const { client, store } = await connected();
    client.historyAnswer = () => ({ events: [], next: null, retained_from_ms: null });
    await readHistory(store, ACCOUNT, {});
    expect(historyBeginsOf(store.getSnapshot())).toBeNull();
    client.historyAnswer = () => ({ events: [], next: null, retained_from_ms: START });
    await readHistory(store, OTHER, {});
    expect(historyBeginsOf(store.getSnapshot())).toBeNull();
  });
});

describe("a wallet switch", () => {
  it("records the new account's start even when it equals the old one", async () => {
    const { client, store } = await connected();
    client.historyAnswer = () => ({ events: [], next: null, retained_from_ms: START });
    await readHistory(store, ACCOUNT, {});
    store.setWallet({ address: OTHER, label: "other" });
    await settle();
    await readHistory(store, OTHER, {});
    expect(historyBeginsOf(store.getSnapshot())).toBe(START);
  });

  it("is not undone by an answer for the account it left that lands afterwards", async () => {
    const { client, store } = await connected();
    let release: (page: HistoryPage) => void = () => {};
    client.history = () => new Promise<HistoryPage>((resolve) => { release = resolve; });
    const late = readHistory(store, ACCOUNT, {});
    store.setWallet({ address: OTHER, label: "other" });
    await settle();
    client.history = async () => ({ events: [], next: null, retained_from_ms: START });
    await readHistory(store, OTHER, {});
    release({ events: [], next: null, retained_from_ms: START + 5000 });
    await late;
    expect(historyBeginsOf(store.getSnapshot())).toBe(START);
  });
});

describe("a late answer for another account", () => {
  it("leaves the connected account's start in place", async () => {
    const { client, store } = await connected();
    client.historyAnswer = () => ({ events: [], next: null, retained_from_ms: START });
    await readHistory(store, ACCOUNT, {});
    client.historyAnswer = () => ({ events: [], next: null, retained_from_ms: START + 5000 });
    await readHistory(store, OTHER, {});
    expect(historyBeginsOf(store.getSnapshot())).toBe(START);
  });
});

describe("the words that say where history begins", () => {
  it("name the start in UTC and say that entries before it are not available", () => {
    expect(historyBeginsNote("history", START)).toBe("Account history before 2026-10-26 13:52 UTC is not available here.");
    expect(historyBeginsNote("withdrawals", START)).toBe("Approved withdrawals before 2026-10-26 13:52 UTC are not available here.");
  });

  it("tell an empty list that older history is not shown, never that there is none", () => {
    expect(emptySince("history", START)).toBe("You have no account history since 2026-10-26 13:52 UTC, and older history is not shown.");
    expect(emptySince("results", START)).toBe("You have no realised profit or loss since 2026-10-26 13:52 UTC, and older results are not shown.");
  });

  it("hold no period of their own", () => {
    for (const list of ["history", "results", "withdrawals", "distributions"] as const) expect(historyBeginsNote(list, START)).not.toMatch(/\b30\b|thirty/i);
    for (const list of ["history", "results", "withdrawals"] as const) expect(emptySince(list, START)).not.toMatch(/\b30\b|thirty/i);
  });
});

describe("the mock's history pages", () => {
  it("begin where the mock's clock started", () => {
    const node = createMockNode(START);
    expect(node.client.historyPage(ACCOUNT, {}).retained_from_ms).toBe(START);
    node.client.tick(START + 40 * 86_400_000);
    expect(node.client.historyPage(ACCOUNT, {}).retained_from_ms).toBe(START);
  });
});

describe("the demo's history pages", () => {
  it("begin no later than the oldest event they serve", () => {
    const node = createMockNode(START, true);
    const page = node.client.historyPage(DEMO_ADDRESS, { limit: 200 });
    expect(page.events.length).toBeGreaterThan(0);
    const oldest = Math.min(...page.events.map((e) => e.ts));
    expect(page.retained_from_ms).not.toBeNull();
    expect(page.retained_from_ms ?? Infinity).toBeLessThanOrEqual(oldest);
  });
});
