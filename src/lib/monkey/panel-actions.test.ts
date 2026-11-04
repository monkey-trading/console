/** Tests for the MONKEY page's transactions, over the mock node and its wallet. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MONKEY_UNIT } from "../format";
import { EPOCH_MS } from "../mock/monkey-state";
import { SIM_EPOCH_MS } from "../mock";
import { MonkeyPanel } from "./panel";
import { claimDistribution, completeUnstake, stakeMonkey, startUnstake } from "./actions";
import { DEMO_ADDRESS } from "../mock/demo";
import { flush, holdReads, setup } from "./panel-kit";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the page's transactions", () => {
  it("stakes, and the wallet's figures and the node's total follow", async () => {
    const { store, panel, stop } = await setup();
    await panel.refreshNode();
    const total = BigInt(panel.getSnapshot().overview.value?.staking?.total_staked ?? "0");
    expect(panel.getSnapshot().wallet.position.value).toMatchObject({ staked: 12_000n * MONKEY_UNIT, balance: 28_000n * MONKEY_UNIT });
    expect(await stakeMonkey(panel, 1_000n * MONKEY_UNIT)).toBe(true);
    expect(panel.getSnapshot().wallet.position.value).toMatchObject({ staked: 13_000n * MONKEY_UNIT, balance: 27_000n * MONKEY_UNIT });
    await panel.refreshNode();
    expect(BigInt(panel.getSnapshot().overview.value?.staking?.total_staked ?? "0")).toBe(total + 1_000n * MONKEY_UNIT);
    expect(store.getSnapshot().notices.stake).toBeUndefined();
    expect(store.getSnapshot().busy).toBe(false);
    stop();
  });

  it("stakes the exact amount, even one that two places would round to nothing", async () => {
    const { node, store, panel, stop } = await setup();
    node.client.state.monkey.seededBalance.set(DEMO_ADDRESS, 40_000n * MONKEY_UNIT + 5n * 10n ** 15n);
    expect(await stakeMonkey(panel, 5n * 10n ** 15n)).toBe(true);
    expect(panel.getSnapshot().wallet.position.value?.staked).toBe(12_000n * MONKEY_UNIT + 5n * 10n ** 15n);
    expect(store.getSnapshot().notices.stake).toBeUndefined();
    stop();
  });

  it("reports a refusal as an error and changes nothing", async () => {
    const { store, panel, stop } = await setup();
    expect(await stakeMonkey(panel, 29_000n * MONKEY_UNIT)).toBe(false);
    expect(store.getSnapshot().notices.stake).toMatchObject({ tone: "error", text: "Your wallet holds less MONKEY than that." });
    expect(panel.getSnapshot().wallet.position.value?.staked).toBe(12_000n * MONKEY_UNIT);
    stop();
  });

  it("starts an unstake that cannot complete until the cooldown has passed, then returns the tokens", async () => {
    const { node, store, panel, stop } = await setup();
    expect(await startUnstake(panel, 2_000n * MONKEY_UNIT)).toBe(true);
    expect(store.getSnapshot().notices.stake).toBeUndefined();
    const position = panel.getSnapshot().wallet.position.value;
    expect(position?.unstaking?.amount).toBe(2_000n * MONKEY_UNIT);
    expect(await completeUnstake(panel)).toBe(false);
    expect(store.getSnapshot().notices.stake?.tone).toBe("error");
    node.client.state.now = position?.unstaking?.claimableAtMs ?? 0;
    expect(await completeUnstake(panel)).toBe(true);
    expect(panel.getSnapshot().wallet.position.value).toMatchObject({ unstaking: null, staked: 10_000n * MONKEY_UNIT, balance: 30_000n * MONKEY_UNIT });
    stop();
  });

  it("holds the stake share back while the node's total has not caught up with a stake or a completed unstake", async () => {
    const { node, panel, stop } = await setup();
    const real = node.client.stats.monkey;
    let lagging = true;
    const stale = await real();
    node.client.stats.monkey = async () => (lagging ? stale : real());
    await panel.refreshNode();
    expect(panel.getSnapshot().unmirroredTotal).toBeNull();
    expect(await stakeMonkey(panel, 1_000n * MONKEY_UNIT)).toBe(true);
    expect(panel.getSnapshot().unmirroredTotal).toBe(stale.staking?.total_staked);
    await panel.refreshNode();
    expect(panel.getSnapshot().unmirroredTotal).toBe(stale.staking?.total_staked);
    lagging = false;
    await panel.refreshNode();
    expect(panel.getSnapshot().unmirroredTotal).toBeNull();
    stop();
  });

  it("holds the share after a completed unstake until the node's total has dropped", async () => {
    const { node, panel, stop } = await setup();
    expect(await startUnstake(panel, 2_000n * MONKEY_UNIT)).toBe(true);
    node.client.state.now = panel.getSnapshot().wallet.position.value?.unstaking?.claimableAtMs ?? 0;
    // The read the start left running settles before the node is made to lag.
    await flush();
    const real = node.client.stats.monkey;
    const stale = await real();
    node.client.stats.monkey = async () => stale;
    await panel.refreshNode();
    expect(await completeUnstake(panel)).toBe(true);
    expect(panel.getSnapshot().unmirroredTotal).toBe(stale.staking?.total_staked);
    await flush();
    node.client.stats.monkey = real;
    await panel.refreshNode();
    expect(panel.getSnapshot().unmirroredTotal).toBeNull();
    stop();
  });

  it("does not hold the share for an unstake that only starts, which leaves the counted stake as it was", async () => {
    const { panel, stop } = await setup();
    expect(await startUnstake(panel, 1_000n * MONKEY_UNIT)).toBe(true);
    expect(panel.getSnapshot().unmirroredTotal).toBeNull();
    stop();
  });

  it("claims the USDC a close distributed, once the vault's checkpoint has reached the node's proof", async () => {
    const { node, store, panel, stop } = await setup();
    node.client.tick(SIM_EPOCH_MS + EPOCH_MS);
    await panel.refreshWallet();
    const proof = panel.getSnapshot().wallet.proof.value;
    expect(BigInt(proof?.entitled ?? "0")).toBeGreaterThan(37_250_000n - 1n);
    expect(await claimDistribution(panel)).toBe(true);
    expect(panel.getSnapshot().wallet.position.value?.distributionsClaimed).toBe(BigInt(proof?.entitled ?? "0"));
    expect(store.getSnapshot().notices.distribution).toBeUndefined();
    // Nothing more is due.
    expect(await claimDistribution(panel)).toBe(false);
    expect(store.getSnapshot().notices.distribution).toBeUndefined();
    stop();
  });

  it("claims with a proof older than the vault's latest checkpoint", async () => {
    const { node, panel, stop } = await setup();
    node.client.tick(SIM_EPOCH_MS + EPOCH_MS);
    const real = node.client.stats.distributions;
    node.client.stats.distributions = async (address) => {
      const proof = await real(address);
      return proof === null ? null : { ...proof, seq: proof.seq - 1 };
    };
    const claims = vi.spyOn(node.controls, "claimDistribution");
    expect(await claimDistribution(panel)).toBe(true);
    expect(claims).toHaveBeenCalledOnce();
    stop();
  });

  it("waits on a verdict that may sign, says why, and sends no claim built from a node the vault has not judged", async () => {
    const { node, store, panel, stop } = await setup();
    node.client.tick(SIM_EPOCH_MS + EPOCH_MS);
    const claims = vi.spyOn(node.controls, "claimDistribution");
    store.patch({ attestation: { kind: "attested", release: "r", address: DEMO_ADDRESS, why: "Your wallet did not answer." } });
    expect(await claimDistribution(panel)).toBe(false);
    expect(claims).not.toHaveBeenCalled();
    expect(store.getSnapshot().notices.distribution).toMatchObject({ tone: "error", text: "The console will not claim the USDC distribution: the vault's current release has not been checked." });
    expect(store.getSnapshot()).toMatchObject({ busy: false, prompt: null });
    stop();
  });

  it("sends no claim when the verdict ends while the reads wait on the wallet", async () => {
    const { node, store, panel, stop } = await setup();
    node.client.tick(SIM_EPOCH_MS + EPOCH_MS);
    const real = node.client.stats.distributions;
    node.client.stats.distributions = async (address) => {
      store.patch({ attestation: { kind: "clock", skewMs: 60_000 } });
      return real(address);
    };
    const claims = vi.spyOn(node.controls, "claimDistribution");
    expect(await claimDistribution(panel)).toBe(false);
    expect(claims).not.toHaveBeenCalled();
    expect(store.getSnapshot().notices.distribution?.text).toBe("The console will not claim the USDC distribution: your device clock differs from the node's signed time.");
    stop();
  });

  it("keeps stake and unstake open under that verdict, as they use nothing from the node", async () => {
    const { store, panel, stop } = await setup();
    store.patch({ attestation: { kind: "attested", release: "r", address: DEMO_ADDRESS, why: "Your wallet did not answer." } });
    expect(await stakeMonkey(panel, MONKEY_UNIT)).toBe(true);
    expect(await startUnstake(panel, MONKEY_UNIT)).toBe(true);
    stop();
  });

  it("sends no claim when the wallet changes while it is prepared", async () => {
    const { node, store, panel, stop } = await setup();
    const real = node.client.stats.distributions;
    node.client.stats.distributions = async (address) => {
      store.liveWallet = null;
      return real(address);
    };
    const claims = vi.spyOn(node.controls, "claimDistribution");
    expect(await claimDistribution(panel)).toBe(false);
    expect(claims).not.toHaveBeenCalled();
    expect(store.getSnapshot().notices.distribution).toMatchObject({ tone: "info", text: "The wallet changed while the claim was prepared, so nothing was sent." });
    stop();
  });

  it("sends no claim when the node holds no proof for the account", async () => {
    const { node, store, panel, stop } = await setup();
    node.client.state.monkey.distEntitled.clear();
    const claims = vi.spyOn(node.controls, "claimDistribution");
    expect(await claimDistribution(panel)).toBe(false);
    expect(claims).not.toHaveBeenCalled();
    expect(store.getSnapshot().notices.distribution).toMatchObject({ tone: "info", text: "The node holds no distribution proof for this account right now." });
    stop();
  });

  it("sends nothing for an account that cannot sign", async () => {
    const { store, panel, stop } = await setup();
    const wallet = store.liveWallet;
    if (wallet === null) throw new Error("the wallet connected");
    store.liveWallet = { address: wallet.address, label: "Read-only", readOnly: true, sign: wallet.sign, deposit: wallet.deposit, claim: wallet.claim };
    expect(await stakeMonkey(panel, MONKEY_UNIT)).toBe(false);
    expect(store.getSnapshot().notices.stake).toMatchObject({ tone: "error", text: "This wallet cannot send transactions." });
    stop();
  });

  it("does not lock the console, or show a wallet prompt, while a transaction waits behind a read the wallet is slow to answer", async () => {
    const { store, panel, stop } = await setup();
    const held = holdReads(store);
    void panel.refreshWallet(true);
    await flush();
    const staked = stakeMonkey(panel, MONKEY_UNIT);
    await flush();
    expect(store.getSnapshot()).toMatchObject({ busy: false, prompt: null });
    held.release();
    expect(await staked).toBe(true);
    stop();
  });

  it("sends nothing when another request has taken the console's busy flag by its turn, and leaves its prompt alone", async () => {
    const { store, panel, stop } = await setup();
    const held = holdReads(store);
    void panel.refreshWallet(true);
    await flush();
    const staked = stakeMonkey(panel, MONKEY_UNIT);
    await flush();
    store.patch({ busy: true, prompt: "Confirm in your wallet: deposit." });
    held.release();
    expect(await staked).toBe(false);
    expect(held.stakes).toBe(0);
    expect(store.getSnapshot()).toMatchObject({ busy: true, prompt: "Confirm in your wallet: deposit." });
    expect(store.getSnapshot().notices.stake).toMatchObject({ text: "Another request is in progress, so nothing was sent." });
    stop();
  });

  it("sends nothing queued for a wallet that has been disconnected by the time its turn comes", async () => {
    const { store, panel, stop } = await setup();
    const held = holdReads(store);
    void panel.refreshWallet(true);
    await flush();
    const staked = stakeMonkey(panel, MONKEY_UNIT);
    await flush();
    store.liveWallet = null;
    held.release();
    expect(await staked).toBe(false);
    expect(held.stakes).toBe(0);
    expect(store.getSnapshot().notices.stake).toMatchObject({ tone: "info", text: "The wallet changed while this was waiting, so nothing was sent." });
    stop();
  });

  it("queues one transaction at a time: a second click while one waits sends nothing and says so", async () => {
    const { store, panel, stop } = await setup();
    const held = holdReads(store);
    void panel.refreshWallet(true);
    await flush();
    const first = stakeMonkey(panel, MONKEY_UNIT);
    await flush();
    expect(await stakeMonkey(panel, MONKEY_UNIT)).toBe(false);
    expect(store.getSnapshot().notices.stake).toMatchObject({ tone: "info", text: "Your earlier request is still with your wallet." });
    held.release();
    expect(await first).toBe(true);
    expect(held.stakes).toBe(1);
    stop();
  });

  it("refreshes the page that is open when a transaction lands, which may be a later opening than the one that started it", async () => {
    const { store, panel, stop } = await setup();
    const held = holdReads(store);
    void panel.refreshWallet(true);
    await flush();
    const staked = stakeMonkey(panel, 1_000n * MONKEY_UNIT);
    await flush();
    stop();
    const later = new MonkeyPanel(store, "staking");
    const restart = later.start(() => false);
    held.release();
    await staked;
    await flush();
    expect(later.getSnapshot().wallet.position.value?.staked).toBe(13_000n * MONKEY_UNIT);
    restart();
  });
});
