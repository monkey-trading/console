import { describe, expect, it } from "vitest";

import { DEFAULT_PREFS, PREFS_KEY, SIZES_KEY } from "./prefs";
import { PrefsStore, type PrefsStorage } from "./prefs-store";

function memory(initial: Record<string, string> = {}): PrefsStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (key) => data[key] ?? null, setItem: (key, value) => { data[key] = value; } };
}

describe("PrefsStore", () => {
  it("starts from the defaults on empty storage and from what is stored otherwise", () => {
    expect(new PrefsStore(() => memory()).getSnapshot().prefs).toEqual(DEFAULT_PREFS);
    const stored = memory({ [PREFS_KEY]: JSON.stringify({ orderType: "stop" }), [SIZES_KEY]: JSON.stringify({ 1: "0.5" }) });
    const state = new PrefsStore(() => stored).getSnapshot();
    expect(state.prefs).toEqual({ ...DEFAULT_PREFS, orderType: "stop" });
    expect(state.sizes).toEqual({ 1: "0.5" });
  });

  it("applies a change at once, saves it, and tells its listeners", () => {
    const storage = memory();
    const store = new PrefsStore(() => storage);
    let heard = 0;
    store.subscribe(() => { heard += 1; });
    const before = store.getSnapshot();
    store.set("confirmBatch", false);
    expect(store.getSnapshot()).not.toBe(before);
    expect(store.getSnapshot().prefs.confirmBatch).toBe(false);
    expect(JSON.parse(storage.data[PREFS_KEY] ?? "null")).toEqual({ ...DEFAULT_PREFS, confirmBatch: false });
    expect(heard).toBe(1);
  });

  it("returns the same snapshot until something changes, so a subscriber does not re-render", () => {
    const store = new PrefsStore(() => memory());
    expect(store.getSnapshot()).toBe(store.getSnapshot());
    store.rememberSize(1, "0.5");
    const after = store.getSnapshot();
    store.rememberSize(1, "0.5");
    expect(store.getSnapshot()).toBe(after);
  });

  it("remembers the last size per market", () => {
    const storage = memory();
    const store = new PrefsStore(() => storage);
    store.rememberSize(1, "0.5");
    store.rememberSize(2, "3");
    store.rememberSize(1, "0.75");
    expect(store.getSnapshot().sizes).toEqual({ 1: "0.75", 2: "3" });
    expect(JSON.parse(storage.data[SIZES_KEY] ?? "null")).toEqual({ 1: "0.75", 2: "3" });
  });

  it("keeps a change for the page and says it is not saved when storage refuses or is absent", () => {
    const refusing: PrefsStorage = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    const store = new PrefsStore(() => refusing);
    store.set("chartLines", false);
    expect(store.getSnapshot()).toMatchObject({ prefs: { chartLines: false }, saved: false });
    const none = new PrefsStore(() => null);
    expect(none.getSnapshot()).toMatchObject({ prefs: DEFAULT_PREFS, saved: false });
  });

  it("uses the defaults when reading storage throws", () => {
    const denied = new PrefsStore(() => { throw new Error("denied"); });
    expect(denied.getSnapshot()).toMatchObject({ prefs: DEFAULT_PREFS, saved: false });
  });

  it("reads again when a listener returns after another tab wrote while none listened", () => {
    const storage = memory();
    const store = new PrefsStore(() => storage);
    const stop = store.subscribe(() => {});
    store.set("confirmBatch", true);
    stop();
    storage.data[PREFS_KEY] = JSON.stringify({ ...DEFAULT_PREFS, confirmBatch: false });
    store.subscribe(() => {});
    expect(store.getSnapshot().prefs.confirmBatch).toBe(false);
    // A later write builds on what the other tab wrote, not on the stale copy.
    store.set("chartLines", false);
    expect(JSON.parse(storage.data[PREFS_KEY] ?? "null")).toMatchObject({ confirmBatch: false, chartLines: false });
  });

  it("keeps a choice whose write failed when a listener returns and storage reads fine", () => {
    const stored: Record<string, string> = { [PREFS_KEY]: JSON.stringify({ ...DEFAULT_PREFS, confirmBatch: false }) };
    const full: PrefsStorage = { getItem: (key) => stored[key] ?? null, setItem: () => { throw new Error("quota"); } };
    const store = new PrefsStore(() => full);
    const stop = store.subscribe(() => {});
    store.set("confirmBatch", true);
    expect(store.getSnapshot()).toMatchObject({ prefs: { confirmBatch: true }, saved: false });
    stop();
    store.subscribe(() => {});
    expect(store.getSnapshot()).toMatchObject({ prefs: { confirmBatch: true }, saved: false });
  });

  it("keeps the page's own choices when a returning listener finds storage unreadable", () => {
    const refusing: PrefsStorage = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    const store = new PrefsStore(() => refusing);
    store.set("chartLines", false);
    store.subscribe(() => {});
    expect(store.getSnapshot().prefs.chartLines).toBe(false);
  });

  it("reads again when another tab writes, and stops watching with its last listener", () => {
    const storage = memory();
    let fire: () => void = () => {};
    let watching = 0;
    const store = new PrefsStore(() => storage, (onChange) => { fire = onChange; watching += 1; return () => { watching -= 1; }; });
    const stop = store.subscribe(() => {});
    expect(store.getSnapshot().prefs.orderType).toBe("market");
    storage.data[PREFS_KEY] = JSON.stringify({ orderType: "limit" });
    fire();
    expect(store.getSnapshot().prefs.orderType).toBe("limit");
    expect(watching).toBe(1);
    stop();
    expect(watching).toBe(0);
  });
});
