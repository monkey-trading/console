/** Tests for the Staking page's wallet figures across the panel's stop and start, as a tab switch to Governance and back does (monkey-trading/console#342). */

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

import { flush, setup } from "./panel-kit";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("MonkeyPanel wallet reads across a stop", () => {
  it("reads the wallet's stake as the page opens again, since the stop cleared it", async () => {
    const { panel, stop } = await setup();
    expect(panel.getSnapshot().wallet.position.status).toBe("ready");
    stop();
    expect(panel.getSnapshot().wallet.position.status).not.toBe("ready");
    const reopened = panel.start(() => false);
    await flush();
    expect(panel.getSnapshot().wallet.position.status).toBe("ready");
    expect(panel.getSnapshot().wallet.proof.status).toBe("ready");
    reopened();
  });

  it("asks the wallet and the node nothing of the wallet while the page is not open", async () => {
    const { node, store, panel, stop } = await setup();
    stop();
    const position = vi.spyOn(store.liveWallet?.staking ?? (() => { throw new Error("the mock wallet stakes"); })(), "position");
    const proof = vi.spyOn(node.client.stats, "distributions");
    await panel.refreshWallet();
    expect(position).not.toHaveBeenCalled();
    expect(proof).not.toHaveBeenCalled();
    expect(panel.getSnapshot().wallet.address).toBeNull();
  });
});
