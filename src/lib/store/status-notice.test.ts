/** Tests for the operator's status notice in the store: set by the node's controls, replaced, and gone once cleared, with no read in between. */

import { describe, expect, it } from "vitest";

import { createMockNode, SIM_EPOCH_MS } from "../mock";
import { mockHistory } from "../mock/history";
import { applyFeedEvent, followAccountFeeds } from "./funds";
import { initialState } from "./state";
import { ConsoleStore } from "./store";

function rig() {
  const node = createMockNode(SIM_EPOCH_MS);
  const store = new ConsoleStore({
    client: node.client, wallets: node.wallets, drive: (ms) => node.client.tick(ms), history: mockHistory,
    initial: { markets: node.client.marketViews(), house: node.client.houseView(), startMs: SIM_EPOCH_MS },
  });
  store.start(SIM_EPOCH_MS);
  followAccountFeeds(store); // as the provider does
  return { node, store };
}

describe("the status notice", () => {
  it("shows the text once the controls publish it, replaces it, and drops it once cleared", () => {
    const { node, store } = rig();
    expect(store.getSnapshot().notice).toBeNull();
    expect(node.controls.publishNotice("Withdrawals are paused.")).toBeNull();
    expect(store.getSnapshot().notice).toEqual({ text: "Withdrawals are paused.", set_at_ms: SIM_EPOCH_MS });
    node.controls.publishNotice("Markets are reduce-only.");
    expect(store.getSnapshot().notice?.text).toBe("Markets are reduce-only.");
    node.controls.clearNotice();
    expect(store.getSnapshot().notice).toBeNull();
  });

  it("refuses text the node would refuse and leaves the notice as it was", () => {
    const { node, store } = rig();
    node.controls.publishNotice("Kept.");
    expect(node.controls.publishNotice("<b>No</b>")).toContain("must not contain");
    expect(store.getSnapshot().notice?.text).toBe("Kept.");
  });

  it("survives a change of wallet, a disconnect and a dismissal of every other notice", () => {
    const { node, store } = rig();
    node.controls.publishNotice("Kept.");
    store.setWallet({ address: "0x00000000000000000000000000000000000000aa", label: "First" });
    expect(store.getSnapshot().notice?.text).toBe("Kept.");
    store.setWallet({ address: "0x00000000000000000000000000000000000000bb", label: "Second" });
    expect(store.getSnapshot().notice?.text).toBe("Kept.");
    store.setWallet(null);
    expect(store.getSnapshot().notice?.text).toBe("Kept.");
    store.clearNotice("account", "node", "feed", "wallet", "ticket");
    expect(store.getSnapshot().notice?.text).toBe("Kept.");
  });

  it("is told to a store that starts after it was published", () => {
    const { node } = rig();
    node.controls.publishNotice("Early.");
    const later = new ConsoleStore({
      client: node.client, wallets: node.wallets, drive: (ms) => node.client.tick(ms), history: mockHistory,
      initial: { markets: node.client.marketViews(), house: node.client.houseView(), startMs: SIM_EPOCH_MS },
    });
    later.start(SIM_EPOCH_MS);
    followAccountFeeds(later);
    expect(later.getSnapshot().notice?.text).toBe("Early.");
  });

  it("changes nothing, and tells nobody, when the same notice is reported again", () => {
    const state = { ...initialState([], { cash: "0", nav: "0", gross_exposure: "0" }, 0, () => [], "checked"), notice: { text: "Same.", set_at_ms: 1 } };
    expect(applyFeedEvent(state, { type: "notice", notice: { text: "Same.", set_at_ms: 1 } })).toBeNull();
    expect(applyFeedEvent(state, { type: "notice", notice: null })).toEqual({ notice: null });
    expect(applyFeedEvent({ ...state, notice: null }, { type: "notice", notice: null })).toBeNull();
    expect(applyFeedEvent({ ...state, notice: null }, { type: "notice", notice: { text: "New.", set_at_ms: 2 } })).toEqual({ notice: { text: "New.", set_at_ms: 2 } });
  });
});
