/** The MONKEY and Staking pages read their claim proofs by themselves in the window between a close and its proof existing (monkey-trading/console#260). */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClientEvent, EngineClient } from "../engine/client";
import { MONKEY_UNIT } from "../format";
import { SIM_EPOCH_MS } from "../mock";
import { DEMO_ADDRESS } from "../mock/demo";
import { noteLossClose } from "../mock/monkey";
import { EPOCH_MS } from "../mock/monkey-state";
import { LIVE_READ_MS, MonkeyPanel } from "./panel";
import type { PanelPage } from "./panel-state";
import { pendingDistribution, pendingEmission } from "./pending";
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

/**
 * A panel for `page` whose account lost in the emission period just closed, with no entitlement
 * proof yet: the node answers none until `proofAvailable` says so. `checkpoint` delivers a signed
 * checkpoint frame, which the mock's own stream never sends.
 */
async function awaitingEmission(page: PanelPage) {
  const { node, store, stop: stopFirst } = await setup(page);
  stopFirst();
  const { state } = node.client;
  noteLossClose(state, DEMO_ADDRESS, state.monkey.periodAt(state.now) - 1, MONKEY_UNIT);
  store.patch({ entitlement: null });
  const watching: { send: (event: ClientEvent) => void } = { send: () => {} };
  // The mock's own `watch` sends nothing; the panel subscribes through the client interface.
  const client: EngineClient = node.client;
  vi.spyOn(client, "watch").mockImplementation((onEvent) => { watching.send = onEvent; return () => {}; });
  const gate = { proofAvailable: false };
  const real = node.client.emissions.bind(node.client);
  const reads = vi.spyOn(node.client, "emissions").mockImplementation(async (address) => (gate.proofAvailable ? real(address) : null));
  const panel = new MonkeyPanel(store, page);
  const stop = panel.start(() => false);
  await flush();
  return { node, store, panel, stop, reads, gate, checkpoint: () => watching.send({ type: "checkpoint", offset: "1:1", seq: 1, root: `0x${"ab".repeat(32)}` } as ClientEvent) };
}

describe("the MONKEY page while an emission proof is awaited", () => {
  it("reads the entitlement on every tick and on each checkpoint frame until a proof exists, then stops", async () => {
    const { node, panel, stop, reads, gate, checkpoint } = await awaitingEmission("monkey");
    expect(pendingEmission(panel.getSnapshot().activity, panel.getSnapshot().overview, DEMO_ADDRESS).kind).toBe("awaiting");
    reads.mockClear();
    await vi.advanceTimersByTimeAsync(LIVE_READ_MS);
    expect(reads).toHaveBeenCalledTimes(1);
    checkpoint();
    await flush();
    expect(reads).toHaveBeenCalledTimes(2);
    gate.proofAvailable = true;
    node.client.state.entitledMonkey.set(DEMO_ADDRESS.toLowerCase(), MONKEY_UNIT);
    await vi.advanceTimersByTimeAsync(LIVE_READ_MS);
    const settled = reads.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2 * LIVE_READ_MS);
    checkpoint();
    await flush();
    expect(reads.mock.calls.length).toBe(settled);
    stop();
  });

  it("is not the Staking page's to read: its panel asks for no entitlement on a tick or a checkpoint frame", async () => {
    const { stop, reads, checkpoint } = await awaitingEmission("staking");
    reads.mockClear();
    await vi.advanceTimersByTimeAsync(2 * LIVE_READ_MS);
    checkpoint();
    await flush();
    expect(reads).not.toHaveBeenCalled();
    stop();
  });
});
