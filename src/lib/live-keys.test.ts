import { describe, expect, it } from "vitest";

import type { EngineEvent, HistoryEvent, HistoryPage } from "./engine/types";
import { activeFor, compareCursors, expiresIn, KEY_LIFETIME_MS, readLiveKeys, type ReadHistory } from "./live-keys";

const NOW = 1_800_000_000_000;
const H = 3_600_000;
const A = "0x00000000000000000000000000000000000000aa";
const B = "0x00000000000000000000000000000000000000bb";
const ACCOUNT = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

const registered = (cursor: string, key: string, ts: number, expiresAt: number): HistoryEvent => ({ type: "session_key_registered", account: ACCOUNT, session_key: key, expires_at: expiresAt, cursor, ts });
const revoked = (cursor: string, key: string, ts: number): HistoryEvent => ({ type: "session_key_revoked", account: ACCOUNT, session_key: key, cursor, ts });

/** A history route over `events` (newest first), `size` to a page, that filters by kind as the node does. */
function route(events: HistoryEvent[], size = 100): { read: ReadHistory; calls: { before?: string; kind: string }[] } {
  const calls: { before?: string; kind: string }[] = [];
  const read: ReadHistory = async ({ before, kind, limit }) => {
    calls.push({ kind, ...(before === undefined ? {} : { before }) });
    const matching = events.filter((e) => e.type === kind && (before === undefined || compareCursors(e.cursor, before) < 0));
    const page = matching.slice(0, Math.min(size, limit));
    const more = matching.length > page.length;
    const result: HistoryPage = { events: page, next: more ? (page.at(-1)?.cursor ?? null) : null };
    return result;
  };
  return { read, calls };
}

describe("readLiveKeys", () => {
  it("lists a key whose registration expires ahead of the clock, with its start and expiry", async () => {
    const { read } = route([registered("5:0", A, NOW - 2 * H, NOW + 20 * H)]);
    expect((await readLiveKeys(read, NOW)).keys).toEqual([{ address: A, startedAt: NOW - 2 * H, expiresAt: NOW + 20 * H }]);
  });

  it("drops a key at its expiry, and one past it", async () => {
    const { read } = route([registered("5:0", A, NOW - 23 * H, NOW), registered("6:0", B, NOW - 23 * H, NOW - 1)]);
    expect((await readLiveKeys(read, NOW)).keys).toEqual([]);
  });

  it("drops a key revoked after its registration and keeps one registered again after its revocation", async () => {
    const events = [revoked("9:0", A, NOW - H), registered("7:0", B, NOW - 3 * H, NOW + 10 * H), registered("6:0", A, NOW - 4 * H, NOW + 10 * H)];
    expect((await readLiveKeys(route(events).read, NOW)).keys.map((k) => k.address)).toEqual([B]);
    const again = [registered("10:0", A, NOW - H, NOW + 20 * H), revoked("9:0", A, NOW - 2 * H), registered("6:0", A, NOW - 4 * H, NOW + 10 * H)];
    expect((await readLiveKeys(route(again).read, NOW)).keys).toEqual([{ address: A, startedAt: NOW - H, expiresAt: NOW + 20 * H }]);
  });

  it("compares by cursor, so a revocation in the same command as a later event index still orders", async () => {
    const events = [revoked("8:1", A, NOW - H), registered("8:0", A, NOW - H, NOW + 10 * H)];
    expect((await readLiveKeys(route(events).read, NOW)).keys).toEqual([]);
    expect(compareCursors("8:10", "8:9")).toBeGreaterThan(0);
    expect(compareCursors("9:0", "8:99")).toBeGreaterThan(0);
  });

  it("lists the newest start first, and reads a key's address in any case as one key", async () => {
    const events = [registered("8:0", B, NOW - H, NOW + H), registered("7:0", A.toUpperCase().replace("0X", "0x"), NOW - 3 * H, NOW + H), registered("6:0", A, NOW - 5 * H, NOW + H)];
    const { keys } = await readLiveKeys(route(events).read, NOW);
    expect(keys.map((k) => [k.address, k.startedAt])).toEqual([[B, NOW - H], [A, NOW - 3 * H]]);
  });

  it("stops reading at events older than 24 hours, and asks nothing further", async () => {
    const events = [registered("30:0", A, NOW - H, NOW + H), registered("20:0", B, NOW - KEY_LIFETIME_MS - H, NOW - H), registered("10:0", B, NOW - KEY_LIFETIME_MS - 2 * H, NOW - 2 * H)];
    const { read, calls } = route(events, 1);
    const read24 = await readLiveKeys(read, NOW);
    expect(read24.complete).toBe(true);
    // One page reached the newest event, the next the first one older than a day; the third is never asked for.
    expect(calls.filter((c) => c.kind === "session_key_registered")).toHaveLength(2);
  });

  it("reads each kind through its own pages and keeps its pages bounded", async () => {
    const many = Array.from({ length: 5000 }, (_, i) => registered(`${10_000 - i}:0`, A, NOW - H, NOW + H));
    const { read, calls } = route(many);
    const answer = await readLiveKeys(read, NOW);
    // The bound stopped the registrations short of a day, so the answer says it may be missing keys.
    expect(answer.complete).toBe(false);
    expect(calls.filter((c) => c.kind === "session_key_registered")).toHaveLength(10);
    expect(calls.filter((c) => c.kind === "session_key_revoked")).toHaveLength(1);
  });

  it("stops asking for further pages once the read is no longer wanted", async () => {
    const many = Array.from({ length: 500 }, (_, i) => registered(`${10_000 - i}:0`, A, NOW - H, NOW + H));
    const { read, calls } = route(many, 1);
    let wanted = true;
    const answer = await readLiveKeys(async (params) => { const page = await read(params); wanted = false; return page; }, NOW, () => !wanted);
    expect(calls.filter((c) => c.kind === "session_key_registered")).toHaveLength(1);
    expect(answer.complete).toBe(false);
  });

  it("ignores an event of another kind that the route returns", async () => {
    const other: EngineEvent = { type: "deposited", account: ACCOUNT, amount: "1" };
    const read: ReadHistory = async () => ({ events: [{ ...other, cursor: "1:0", ts: NOW }], next: null });
    expect((await readLiveKeys(read, NOW)).keys).toEqual([]);
  });

  it("lets a failed read reject, so the page can say so", async () => {
    await expect(readLiveKeys(async () => { throw new Error("node down"); }, NOW)).rejects.toThrow("node down");
  });
});

describe("a row's times", () => {
  it("reads how long a key has been active and when it expires", () => {
    expect(activeFor(NOW, NOW - 3 * H)).toBe("3 h");
    expect(activeFor(NOW, NOW + 5)).toBe("under a minute");
    expect(expiresIn(NOW, NOW + 2 * H)).toBe("in 2 h");
    expect(expiresIn(NOW, NOW)).toBe("expired");
  });
});
