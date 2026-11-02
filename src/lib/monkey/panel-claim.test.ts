/** The USDC distribution claim decides on the node's word that its proof is claimable, and falls back to the vault's latest seq for a node that does not say. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SIM_EPOCH_MS } from "../mock";
import { EPOCH_MS } from "../mock/monkey-state";
import { WAITING_ON_VAULT } from "../store/emissions";
import { claimDistribution } from "./actions";
import { setup } from "./panel-kit";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("claimDistribution on the node's word", () => {
  it("claims on the node's word when the wallet's read of the vault's latest seq is behind the proof", async () => {
    const { node, store, panel, stop } = await setup();
    node.client.tick(SIM_EPOCH_MS + EPOCH_MS);
    await panel.refreshWallet();
    // The wallet's read of the vault's latest seq runs behind the proof the node serves.
    const staking = store.liveWallet?.staking;
    if (staking === undefined) throw new Error("the kit's wallet has no staking");
    const position = staking.position.bind(staking);
    vi.spyOn(staking, "position").mockImplementation(async () => ({ ...(await position()), latestSeq: 0 }));
    const claims = vi.spyOn(node.controls, "claimDistribution");
    expect(await claimDistribution(panel)).toBe(true);
    expect(claims).toHaveBeenCalledOnce();
    expect(store.getSnapshot().notices.distribution).toBeUndefined();
    stop();
  });

  it("sends no claim, and says why, with one read of each, when the node says the proof is not claimable", async () => {
    const { node, store, panel, stop } = await setup();
    node.client.tick(SIM_EPOCH_MS + EPOCH_MS);
    await panel.refreshWallet();
    const real = node.client.stats.distributions;
    let reads = 0;
    node.client.stats.distributions = async (address) => {
      reads++;
      const proof = await real(address);
      return proof === null ? null : { ...proof, accepted_seq: null, claimable: false };
    };
    const claims = vi.spyOn(node.controls, "claimDistribution");
    expect(await claimDistribution(panel)).toBe(false);
    expect(claims).not.toHaveBeenCalled();
    expect(reads).toBe(2); // the claim's one read, and the page's read after it
    expect(store.getSnapshot().notices.distribution).toMatchObject({ tone: "info", text: WAITING_ON_VAULT });
    stop();
  });

  it("falls back to the vault's latest seq against a node that does not say: no claim while it is behind, and bounded rounds", async () => {
    const { node, store, panel, stop } = await setup();
    node.client.tick(SIM_EPOCH_MS + EPOCH_MS);
    await panel.refreshWallet();
    const real = node.client.stats.distributions;
    let reads = 0;
    node.client.stats.distributions = async (address) => {
      reads++;
      const proof = await real(address);
      if (proof === null) return null;
      return { account: proof.account, root: proof.root, entitled: proof.entitled, siblings: proof.siblings, seq: proof.seq + 1 };
    };
    const claims = vi.spyOn(node.controls, "claimDistribution");
    expect(await claimDistribution(panel)).toBe(false);
    expect(claims).not.toHaveBeenCalled();
    expect(reads).toBe(4); // the claim's three bounded rounds, and the page's read after them
    expect(store.getSnapshot().notices.distribution).toMatchObject({ tone: "info", text: WAITING_ON_VAULT });
    stop();
  });

  it("shows the vault's refusal in the panel in plain words and leaves the page usable", async () => {
    const { node, store, panel, stop } = await setup();
    node.client.tick(SIM_EPOCH_MS + EPOCH_MS);
    await panel.refreshWallet();
    vi.spyOn(node.controls, "claimDistribution").mockImplementation(() => { throw new Error("The vault has no signer right now, so it accepts no claims and nothing was sent. Try again once governance has installed one."); });
    expect(await claimDistribution(panel)).toBe(false);
    expect(store.getSnapshot().notices.distribution).toMatchObject({ tone: "error", text: expect.stringContaining("has no signer right now") });
    expect(store.getSnapshot().busy).toBe(false);
    stop();
  });
});
