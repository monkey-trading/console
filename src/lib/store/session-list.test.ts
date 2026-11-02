/** Tests for the Settings page's session list: what it reads and when it repeats. */

import { describe, expect, it } from "vitest";

import { EngineError } from "../engine/client";
import { settle } from "../engine/test-kit";
import type { HistoryPage } from "../engine/types";
import { ACCOUNT } from "../engine/wallet-kit";
import { disconnectWallet } from "./actions";
import { connected, NODE_TIME } from "./live-kit";
import { H, message, ManualScheduler, opened, OTHER_KEY, registered, registeredReads, revokedAt, serve, walletSignatures } from "./session-list-kit";
import { SESSION_REFRESH_MS, SessionList } from "./session-list";

describe("the session list", () => {
  it("reads the registrations and revocations when opened, lists the live keys and marks this browser's, with no prompt", async () => {
    const { list, provider, reads, own } = await opened();
    expect([...reads].sort()).toEqual(["session_key_registered", "session_key_revoked"]);
    expect(walletSignatures(provider)).toBe(1); // the login's, none for the read
    expect(list.getSnapshot()).toMatchObject({ status: { kind: "ready" }, ownKey: own });
    expect(list.getSnapshot().keys.map((k) => k.address)).toEqual([OTHER_KEY, own.toLowerCase()]);
  });

  it("reads with no session key at all, and asks the wallet for nothing", async () => {
    const { list, provider, store } = await opened(false);
    expect(store.sessionKey).toBeNull();
    expect(list.getSnapshot()).toMatchObject({ status: { kind: "ready" }, ownKey: null });
    expect(list.getSnapshot().keys).toHaveLength(2);
    expect(walletSignatures(provider)).toBe(0);
  });

  it("reads a watched account's sessions too", async () => {
    const kit = await connected();
    kit.store.patch({ now: NODE_TIME });
    kit.store.setWallet({ address: ACCOUNT, label: "Watching", readOnly: true });
    serve(kit.client, () => [registered("9:0", OTHER_KEY, NODE_TIME - H, NODE_TIME + H)]);
    const list = new SessionList(kit.store, () => false, new ManualScheduler());
    list.open();
    await settle();
    expect(list.getSnapshot().keys).toHaveLength(1);
  });

  it("drops a revoked key and an expired one from the list", async () => {
    const { list, setEvents, scheduler } = await opened();
    setEvents([revokedAt("12:0", OTHER_KEY, NODE_TIME), registered("9:0", OTHER_KEY, NODE_TIME - H, NODE_TIME + 20 * H), registered("5:0", "0x00000000000000000000000000000000000000cc", NODE_TIME - 23 * H, NODE_TIME - 1)]);
    scheduler.fire();
    await settle();
    expect(list.getSnapshot().keys).toEqual([]);
  });

  it("reads again at the slow pace and not before, and stops when the page closes", async () => {
    const { reads, scheduler, close } = await opened();
    expect(scheduler.timers.map((t) => t.ms)).toEqual([SESSION_REFRESH_MS]);
    scheduler.fire();
    await settle();
    expect(registeredReads(reads)).toBe(2);
    expect(scheduler.timers).toHaveLength(1);
    close();
    expect(scheduler.timers).toEqual([]);
  });

  it("reads again when the stream registers or revokes a key for the account, and ignores another account's", async () => {
    const { client, reads, setEvents, list } = await opened();
    client.deliver(message([{ type: "session_key_registered", account: "0x00000000000000000000000000000000000000bb", session_key: OTHER_KEY, expires_at: 1 }]));
    client.deliver(message([{ type: "deposited", account: ACCOUNT, amount: "1" }]));
    await settle();
    expect(registeredReads(reads)).toBe(1);
    setEvents([]);
    client.deliver(message([{ type: "session_key_revoked", account: ACCOUNT.toUpperCase().replace("0X", "0x"), session_key: OTHER_KEY }]));
    await settle();
    expect(registeredReads(reads)).toBe(2);
    expect(list.getSnapshot().keys).toEqual([]);
  });

  it("folds events that arrive while a read runs into one more read", async () => {
    const { client, reads } = await opened();
    for (const n of [1, 2, 3]) client.deliver(message([{ type: "session_key_registered", account: ACCOUNT, session_key: OTHER_KEY, expires_at: n }]));
    await settle();
    // The open's read, the first event's, and one more for the two events that came while it ran.
    expect(registeredReads(reads)).toBe(3);
  });

  it("disconnects the wallet, with no further prompt, when this browser's own key is revoked", async () => {
    const { client, store, provider, own } = await opened();
    const before = walletSignatures(provider);
    client.deliver(message([{ type: "session_key_revoked", account: ACCOUNT, session_key: own }]));
    await settle();
    expect(store.getSnapshot().wallet).toBeNull();
    expect(store.sessionKey).toBeNull();
    expect(walletSignatures(provider)).toBe(before);
  });

  it("keeps the keys it has, says why, and tries again at the slow pace when a read fails", async () => {
    const { client, list, scheduler } = await opened();
    client.history = async () => { throw new EngineError(0, "The node did not answer."); };
    scheduler.fire();
    await settle();
    expect(list.getSnapshot().status).toEqual({ kind: "failed", message: "The node did not answer." });
    expect(list.getSnapshot().keys).toHaveLength(2);
    expect(scheduler.timers).toHaveLength(1);
  });

  it("shows no keys for an account the node has not credited (404)", async () => {
    const kit = await connected();
    kit.store.patch({ now: NODE_TIME });
    kit.client.history = async () => { throw new EngineError(404, "not found"); };
    const list = new SessionList(kit.store, () => false, new ManualScheduler());
    list.open();
    await settle();
    expect(list.getSnapshot()).toMatchObject({ status: { kind: "ready" }, keys: [] });
  });

  it("makes no read while the node cannot be read, and reads when it can", async () => {
    const kit = await connected();
    kit.store.patch({ now: NODE_TIME, stream: "stale" });
    const reads = serve(kit.client, () => []);
    const list = new SessionList(kit.store, () => false, new ManualScheduler());
    list.open();
    await settle();
    expect(reads).toEqual([]);
    expect(list.getSnapshot().status).toEqual({ kind: "waiting", why: "the node's feed is stale" });
    kit.store.patch({ stream: "live" });
    await settle();
    expect(list.getSnapshot().status).toEqual({ kind: "ready" });
  });

  it("drops an answer, and schedules nothing, when the node becomes unreadable while a read waits", async () => {
    const { client, store, list, scheduler } = await opened();
    const waiting: ((page: HistoryPage) => void)[] = [];
    client.history = () => new Promise((resolve) => { waiting.push(resolve); });
    scheduler.fire();
    await settle();
    expect(waiting).toHaveLength(2); // the registrations and the revocations
    store.patch({ stream: "stale" });
    for (const release of waiting) release({ events: [registered("20:0", OTHER_KEY, NODE_TIME, NODE_TIME + H)], next: null });
    await settle();
    expect(list.getSnapshot().status.kind).toBe("waiting");
    expect(list.getSnapshot().keys.map((k) => k.startedAt)).not.toContain(NODE_TIME);
    expect(list.getSnapshot().reading).toBe(false);
    expect(scheduler.timers).toEqual([]);
  });

  it("drops a late answer for the account that was disconnected, shows nothing of it under the next account, and reads for the next", async () => {
    const { client, store, list, scheduler, wallet } = await opened();
    const waiting: ((page: HistoryPage) => void)[] = [];
    client.history = () => new Promise((resolve) => { waiting.push(resolve); });
    scheduler.fire();
    await settle();
    const other = "0x00000000000000000000000000000000000000bb";
    store.liveWallet = { ...wallet, address: other };
    store.setWallet({ address: other, label: "Other" });
    expect(list.getSnapshot().keys).toEqual([]);
    for (const release of waiting) release({ events: [registered("20:0", OTHER_KEY, NODE_TIME, NODE_TIME + H)], next: null });
    await settle();
    expect(list.getSnapshot().keys).toEqual([]);
    expect(waiting.length).toBeGreaterThan(2); // the next account's own read was asked for
  });

  it("keeps a failed list on screen, and its Refresh, while the retry runs", async () => {
    const { client, list, scheduler } = await opened();
    client.history = async () => { throw new EngineError(0, "The node did not answer."); };
    scheduler.fire();
    await settle();
    expect(list.getSnapshot().status.kind).toBe("failed");
    const seen: string[] = [];
    list.subscribe(() => seen.push(list.getSnapshot().status.kind));
    scheduler.fire();
    await settle();
    expect(seen).not.toContain("loading");
  });

  it("says when the read stopped short of a day of history, and no longer when a later read reaches it", async () => {
    const { client, list, scheduler } = await opened();
    let page = 0;
    const ordinary = client.history.bind(client);
    client.history = async () => ({ events: [registered(`${10_000 - page}:0`, OTHER_KEY, NODE_TIME - H, NODE_TIME + H)], next: `${10_000 - page++}:0` });
    scheduler.fire();
    await settle();
    expect(list.getSnapshot()).toMatchObject({ status: { kind: "ready" }, complete: false });
    client.history = ordinary;
    scheduler.fire();
    await settle();
    expect(list.getSnapshot().complete).toBe(true);
  });

  it("forgets that a read stopped short when the wallet is disconnected, and under the next account", async () => {
    const { client, store, list, scheduler, wallet } = await opened();
    let page = 0;
    const stoppedShort = async () => ({ events: [registered(`${10_000 - page}:0`, OTHER_KEY, NODE_TIME - H, NODE_TIME + H)], next: `${10_000 - page++}:0` });
    client.history = stoppedShort;
    scheduler.fire();
    await settle();
    expect(list.getSnapshot().complete).toBe(false);
    disconnectWallet(store);
    await settle();
    expect(list.getSnapshot()).toMatchObject({ status: { kind: "no-wallet" }, keys: [], complete: true });
    // The next account's list is not under a warning about the last one's read, before its own read ends.
    let release!: (page: HistoryPage) => void;
    client.history = () => new Promise((resolve) => { release = resolve; });
    store.liveWallet = { ...wallet, address: "0x00000000000000000000000000000000000000bb" };
    store.setWallet({ address: "0x00000000000000000000000000000000000000bb", label: "Other" });
    await settle();
    expect(list.getSnapshot().complete).toBe(true);
    release({ events: [], next: null });
  });

  it("makes no timed read in a hidden tab, and one when it returns", async () => {
    const { reads, scheduler, hide, list } = await opened();
    hide(true);
    scheduler.fire();
    await settle();
    expect(registeredReads(reads)).toBe(1);
    hide(false);
    list.resume();
    await settle();
    expect(registeredReads(reads)).toBe(2);
    list.resume(); // nothing is owed now
    await settle();
    expect(registeredReads(reads)).toBe(2);
  });
});
