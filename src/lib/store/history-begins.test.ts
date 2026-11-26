/** Tests for where the served history begins (monkey-trading/console#526): kept from the server's answers, never fixed. */

import { describe, expect, it } from "vitest";

import { createMockNode } from "../mock";
import { DEMO_ADDRESS } from "../mock/demo";
import { ACCOUNT } from "./live-fake";
import { emptySince, historyBeginsNote, withdrawalsBegin } from "./history-begins";

const START = Date.UTC(2026, 9, 26, 13, 52);

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

describe("where the withdrawals list begins", () => {
  it("is the earliest start of the reads its rows came from, or none while neither states one", () => {
    expect(withdrawalsBegin({ historyBegins: START + 5000, approvalsBegins: START })).toBe(START);
    expect(withdrawalsBegin({ historyBegins: START, approvalsBegins: START + 5000 })).toBe(START);
    expect(withdrawalsBegin({ historyBegins: null, approvalsBegins: START })).toBe(START);
    expect(withdrawalsBegin({ historyBegins: null, approvalsBegins: null })).toBeNull();
  });
});
