/** Tests for the Rotation tab's older turns: the join with the newest page, and the reads against the mock node. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EngineError } from "../engine/client";
import { flush, setup } from "../monkey/panel-kit";
import { rotationView, type TurnRecord } from "./rotation";
import { joinHistory, MAX_HELD_TURNS, NO_OLDER, TURNS_PAGE, TurnHistoryReads } from "./turn-history-reads";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function record(seq: number): TurnRecord {
  return { turn: seq, position: 0, reason: "draw", candidate: "0x00000000000000000000000000000000000000a1", appliesAtMs: seq, refused: null, assignedSeq: seq, assignedMs: seq, takenMs: null };
}
const page = (seqs: number[], next: number | null) => ({ records: seqs.map(record), next, truncated: false });

describe("joinHistory", () => {
  it("is the newest page alone while no older page is held", () => {
    const head = page([30, 20], 20);
    expect(joinHistory(head, NO_OLDER)).toBe(head);
  });

  it("puts the older records below the newest page and moves the end on to theirs", () => {
    const joined = joinHistory(page([30, 20], 20), { records: [10, 5].map(record), anchor: 20, next: 5, truncated: true });
    expect(joined.records.map((r) => r.assignedSeq)).toEqual([30, 20, 10, 5]);
    expect(joined).toMatchObject({ next: 5, truncated: true });
  });

  it("holds each record once when the newest page has reached into the older ones", () => {
    const joined = joinHistory(page([30, 20, 10], 10), { records: [10, 5].map(record), anchor: 20, next: 5, truncated: false });
    expect(joined.records.map((r) => r.assignedSeq)).toEqual([30, 20, 10, 5]);
  });

  it("leaves the older records out once the newest page has moved past where they began, as turns between could be missing", () => {
    const head = page([50, 40], 40);
    expect(joinHistory(head, { records: [10, 5].map(record), anchor: 20, next: 5, truncated: false })).toBe(head);
  });

  it("holds at most the bound, and reads no further past it", () => {
    const many = Array.from({ length: MAX_HELD_TURNS + 5 }, (_, i) => MAX_HELD_TURNS + 100 - i);
    const joined = joinHistory(page([MAX_HELD_TURNS + 200], 150), { records: many.map(record), anchor: 150, next: 3, truncated: false });
    expect(joined.records).toHaveLength(MAX_HELD_TURNS);
    expect(joined.next).toBeNull();
  });
});

describe("TurnHistoryReads", () => {
  async function started() {
    const kit = await setup();
    const reads = new TurnHistoryReads(kit.store);
    const stop = reads.start();
    const head = rotationView(await kit.node.client.stats.operator({ limit: 5 })).history;
    return { ...kit, reads, stop, head };
  }

  it("reads the page before the newest page's end, and the one before that, until none is left", async () => {
    const { reads, head, node, stop } = await started();
    expect(head.next).not.toBeNull();
    const asked: unknown[] = [];
    const real = node.client.stats.operator;
    node.client.stats.operator = (params) => { asked.push(params); return real(params); };
    await reads.loadOlder(head);
    await flush();
    const first = reads.getSnapshot();
    expect(asked).toEqual([{ before: head.next, limit: TURNS_PAGE }]);
    expect(first.older.records.length).toBeGreaterThan(0);
    expect(first.older.anchor).toBe(head.next);
    for (let i = 0; i < 10 && joinHistory(head, reads.getSnapshot().older).next !== null; i += 1) {
      await reads.loadOlder(head);
      await flush();
    }
    const all = joinHistory(head, reads.getSnapshot().older);
    expect(all.next).toBeNull();
    const seqs = all.records.map((r) => r.assignedSeq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs).toEqual([...seqs].sort((a, b) => b - a));
    stop();
  });

  it("reads nothing at the end of the history, and nothing while a read is in flight", async () => {
    const { reads, node, head, stop } = await started();
    let calls = 0;
    const real = node.client.stats.operator;
    node.client.stats.operator = (params) => { calls += 1; return real(params); };
    await reads.loadOlder({ ...head, next: null });
    expect(calls).toBe(0);
    void reads.loadOlder(head);
    await reads.loadOlder(head);
    expect(calls).toBe(1);
    await flush();
    stop();
  });

  it("says why a read failed and keeps what it held", async () => {
    const { reads, node, head, stop } = await started();
    const real = node.client.stats.operator;
    // A page of three, so the end is not reached and a further read is due.
    node.client.stats.operator = (params) => real({ ...params, limit: 3 });
    await reads.loadOlder(head);
    await flush();
    const held = reads.getSnapshot().older;
    expect(joinHistory(head, held).next).not.toBeNull();
    node.client.stats.operator = () => Promise.reject(new EngineError(503, "the node is busy"));
    await reads.loadOlder(head);
    await flush();
    expect(reads.getSnapshot()).toMatchObject({ error: "the node is busy", reading: false, older: held });
    stop();
  });

  it("drops what it held when the node stops being trusted", async () => {
    const { reads, store, head, stop } = await started();
    await reads.loadOlder(head);
    await flush();
    expect(reads.getSnapshot().older.records.length).toBeGreaterThan(0);
    store.patch({ attestation: { kind: "unverified", reason: "the quote did not verify" } });
    expect(reads.getSnapshot().older).toEqual(NO_OLDER);
    stop();
  });

  it("drops what it held when another verified enclave now holds the node, while it ran and at a start after one replaced it", async () => {
    const { reads, store, head, stop } = await started();
    await reads.loadOlder(head);
    await flush();
    expect(reads.getSnapshot().older.records.length).toBeGreaterThan(0);
    store.patch({ attestation: { kind: "verified", release: "r", config: "c", address: "0x00000000000000000000000000000000000000e1" } });
    store.patch({ attestation: { kind: "verified", release: "r", config: "c", address: "0x00000000000000000000000000000000000000e2" } });
    expect(reads.getSnapshot().older).toEqual(NO_OLDER);
    await reads.loadOlder(head);
    await flush();
    stop();
    store.patch({ attestation: { kind: "verified", release: "r", config: "c", address: "0x00000000000000000000000000000000000000e3" } });
    expect(reads.start()).toBeTypeOf("function");
    expect(reads.getSnapshot().older).toEqual(NO_OLDER);
  });
});
