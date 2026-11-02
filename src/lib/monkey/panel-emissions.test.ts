/** Tests for claiming MONKEY emissions through the page's wallet queue. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MONKEY_UNIT } from "../format";
import { DEMO_ADDRESS } from "../mock/demo";
import { claimMonkeyEmissions, stakeMonkey } from "./actions";
import { MonkeyPanel } from "./panel";
import { flush, holdReads, setup } from "./panel-kit";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function accrued() {
  const made = await setup();
  made.node.client.state.entitledMonkey.set(DEMO_ADDRESS, 5n * MONKEY_UNIT);
  return made;
}

describe("claimMonkeyEmissions", () => {
  it("claims what the node's proof entitles the account to, and the page reads the vault's record again after", async () => {
    const { node, store, panel, stop } = await accrued();
    await claimMonkeyEmissions(panel);
    expect(node.client.state.claimedMonkey.get(DEMO_ADDRESS)).toBe(5n * MONKEY_UNIT);
    expect(store.getSnapshot().emissionsVault).toMatchObject({ claimed: 5n * MONKEY_UNIT });
    stop();
  });

  it("sends nothing queued for a wallet that has been replaced by the time its turn comes", async () => {
    const { node, store, panel, stop } = await accrued();
    const held = holdReads(store);
    void panel.refreshWallet(true);
    await flush();
    const claimed = claimMonkeyEmissions(panel);
    await flush();
    store.liveWallet = null;
    held.release();
    await claimed;
    expect(node.client.state.claimedMonkey.get(DEMO_ADDRESS)).toBeUndefined();
    expect(store.getSnapshot().toasts.at(-1)).toMatchObject({ tone: "info", text: "The wallet changed while this was waiting, so nothing was sent." });
    stop();
  });

  it("says so, and sends nothing, when a transaction is already waiting for the wallet", async () => {
    const { node, store, panel, stop } = await accrued();
    const held = holdReads(store);
    void panel.refreshWallet(true);
    await flush();
    const staked = stakeMonkey(panel, MONKEY_UNIT);
    await flush();
    const claimed = claimMonkeyEmissions(panel);
    await flush();
    expect(store.getSnapshot().toasts.at(-1)).toMatchObject({ tone: "info", text: "Your earlier request is still with your wallet." });
    held.release();
    await claimed;
    await staked;
    expect(node.client.state.claimedMonkey.get(DEMO_ADDRESS)).toBeUndefined();
    stop();
  });

  it("sends nothing when another request has taken the console's busy flag by its turn", async () => {
    const { node, store, panel, stop } = await accrued();
    const held = holdReads(store);
    void panel.refreshWallet(true);
    await flush();
    const claimed = claimMonkeyEmissions(panel);
    await flush();
    store.patch({ busy: true });
    held.release();
    await claimed;
    expect(node.client.state.claimedMonkey.get(DEMO_ADDRESS)).toBeUndefined();
    expect(store.getSnapshot().toasts.at(-1)).toMatchObject({ text: "Another request is in progress, so nothing was sent." });
    stop();
  });

  it("offers the token to the wallet once the mint has landed, and holds the queue until the offer is answered", async () => {
    const { store, panel, stop } = await accrued();
    const wallet = store.liveWallet;
    if (wallet === null) throw new Error("no wallet");
    let answer: (added: boolean) => void = () => {};
    const offer = vi.fn(() => new Promise<boolean>((resolve) => { answer = resolve; }));
    wallet.suggestMonkey = offer;
    let settled = false;
    const claimed = claimMonkeyEmissions(panel).then(() => { settled = true; });
    await flush();
    expect(offer).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().busy).toBe(false);
    expect(settled).toBe(false);
    answer(true);
    await claimed;
    expect(store.getSnapshot().toasts.at(-1)).toMatchObject({ tone: "info", text: "MONKEY was added to your wallet, so its balance shows there." });
    stop();
  });

  it("refreshes the page that is open when the claim lands, which may be a later opening", async () => {
    const { store, panel, stop } = await accrued();
    const held = holdReads(store);
    void panel.refreshWallet(true);
    await flush();
    const claimed = claimMonkeyEmissions(panel);
    await flush();
    stop();
    const later = new MonkeyPanel(store);
    const restart = later.start(() => false);
    held.release();
    await claimed;
    await flush();
    expect(store.getSnapshot().emissionsVault).toMatchObject({ claimed: 5n * MONKEY_UNIT });
    restart();
  });
});
