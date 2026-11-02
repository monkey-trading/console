/** Tests for the P&L tab's schedule, failed reads, and what a changed wallet or a gap in the stream does to what is held. */

import { describe, expect, it } from "vitest";

import { EngineError } from "../engine/client";
import { settle } from "../engine/test-kit";
import { fixedFromInt } from "../fixed";
import { fill, page, SCHEDULE } from "../ledger-kit";
import { sharesOf } from "../ledger-share";
import { ACCOUNT } from "./live-fake";
import { opened } from "./ledger-store-kit";

const usd = fixedFromInt;

describe("the emission schedule", () => {
  it("leaves the rows showing and the MONKEY unknown from a node without the route, with no toast", async () => {
    const { store, client, ledger } = await opened({ fill: { "": page([fill("20:0", 100, usd(-4))]) } });
    client.schedule = null;
    store.ledger.open(ACCOUNT);
    await settle();
    expect(ledger().scheduleStatus).toBe("unavailable");
    expect(ledger().data.rows).toHaveLength(1);
    expect(sharesOf(ledger().data, ledger().schedule).get("20:0")).toEqual({ kind: "unknown" });
    expect(store.getSnapshot().toasts).toEqual([]);
  });

  it("is a failure, not a toast, when the node does not answer, and is asked again at the next open", async () => {
    const { store, client, ledger } = await opened();
    client.schedule = new EngineError(503, "history is catching up with the log");
    const close = store.ledger.open(ACCOUNT);
    await settle();
    expect(ledger().scheduleStatus).toBe("failed");
    expect(ledger().status).toBe("ready");
    expect(store.getSnapshot().toasts).toEqual([]);
    close();
    client.schedule = SCHEDULE;
    store.ledger.open(ACCOUNT);
    await settle();
    expect(ledger().scheduleStatus).toBe("ready");
    expect(client.scheduleReads).toBe(2);
  });

  it("takes the periods before the node's open one as closed", async () => {
    const { store, ledger } = await opened();
    store.ledger.open(ACCOUNT);
    await settle();
    expect(ledger().data.closedThrough).toBe(SCHEDULE.period - 1);
  });
});

describe("a read that fails", () => {
  it("reports the failure in the tab, not as a toast, and the next open reads again", async () => {
    const { store, client, ledger, reads } = await opened({ fill: { "": page([fill("20:0", 100, usd(-4))]) } });
    const answer = client.historyAnswer;
    client.historyAnswer = () => { throw new Error("The node did not answer."); };
    const close = store.ledger.open(ACCOUNT);
    await settle();
    expect(ledger()).toMatchObject({ status: "failed", error: "The node did not answer." });
    expect(store.getSnapshot().toasts).toEqual([]);
    close();
    client.historyAnswer = answer;
    store.ledger.open(ACCOUNT);
    await settle();
    expect(ledger().status).toBe("ready");
    expect(ledger().data.rows).toHaveLength(1);
    expect(reads().length).toBeGreaterThan(3);
  });

  it("keeps what is held when a load more fails", async () => {
    const { store, client, ledger } = await opened({ fill: { "": page([fill("20:0", 100, usd(-4))], "20:0") } });
    store.ledger.open(ACCOUNT);
    await settle();
    client.historyAnswer = () => { throw new Error("The node did not answer."); };
    await store.ledger.loadMore();
    expect(ledger()).toMatchObject({ status: "ready", more: false, error: "The node did not answer." });
    expect(ledger().data.rows).toHaveLength(1);
  });
});

describe("a changed wallet or a gap in the stream", () => {
  it("drops the held rows when the wallet changes, and a read in flight answers nothing", async () => {
    const { store, client, ledger } = await opened({ fill: { "": page([fill("20:0", 100, usd(-4))]) } });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const answer = client.historyAnswer;
    client.history = async (...args) => { await gate; return answer(args[1] ?? {}); };
    store.ledger.open(ACCOUNT);
    store.setWallet({ address: "0xdef0000000000000000000000000000000000002", label: "other" });
    release();
    await settle();
    expect(ledger().data.rows).toEqual([]);
    expect(ledger().status).toBe("idle");
  });

  it("reads again after the stream resumed at the live end, when the tab is open", async () => {
    const { store, client, reads, ledger } = await opened({ fill: { "": page([fill("20:0", 100, usd(-4))]) } });
    store.ledger.open(ACCOUNT);
    await settle();
    client.listener?.({ type: "feed", status: "stale" });
    client.listener?.({ type: "feed", status: "live" });
    await settle();
    expect(reads().filter((r) => r.kind === "fill")).toHaveLength(2);
    expect(ledger().data.rows).toHaveLength(1);
  });

  it("holds nothing after a gap while the tab is closed, and reads afresh at the next open", async () => {
    const { store, client, reads, ledger } = await opened();
    store.ledger.open(ACCOUNT)();
    await settle();
    client.listener?.({ type: "feed", status: "stale" });
    client.listener?.({ type: "feed", status: "live" });
    await settle();
    expect(reads()).toHaveLength(3);
    expect(ledger().status).toBe("idle");
    store.ledger.open(ACCOUNT);
    await settle();
    expect(reads()).toHaveLength(6);
  });
});
