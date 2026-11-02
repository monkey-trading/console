/** The MONKEY page reads the claim proofs by itself in the window between an epoch closing and its proof existing (monkey-trading/console#260). */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EPOCH_MS } from "../mock/monkey-state";
import { SIM_EPOCH_MS } from "../mock";
import { pendingDistribution } from "./pending";
import { flush, setup } from "./panel-kit";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the page while a distribution proof is awaited", () => {
  it("says what is known between the close and the proof, reads the proof every tick, and shows the claim as soon as it exists", async () => {
    const { node, panel, stop } = await setup();
    node.client.tick(SIM_EPOCH_MS + EPOCH_MS);
    const real = node.client.stats.distributions;
    let proofAvailable = false;
    node.client.stats.distributions = async (address) => (proofAvailable ? real(address) : null);
    await panel.refreshNode();
    await panel.refreshWallet();
    const state = () => panel.getSnapshot();
    expect(state().wallet.proof).toMatchObject({ status: "ready", value: null });
    expect(pendingDistribution(state().overview, state().wallet.position, state().unmirroredTotal).kind).toBe("awaiting");
    // Each tick asks the node again; nothing is read from the wallet for it.
    const reads = vi.spyOn(node.client.stats, "distributions");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reads.mock.calls.length).toBeGreaterThanOrEqual(2);
    proofAvailable = true;
    await vi.advanceTimersByTimeAsync(5_000);
    await flush();
    expect(state().wallet.proof.value).not.toBeNull();
    // With the proof there, no further proof reads run until the page's own 15 s wallet read.
    const settled = reads.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(reads.mock.calls.length).toBe(settled);
    stop();
  });
});
