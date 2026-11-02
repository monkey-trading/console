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
  it("stakes, and the wallet's figures and the feed follow", async () => {
    const { store, panel, stop } = await setup();
    expect(panel.getSnapshot().wallet.position.value).toMatchObject({ staked: 12_000n * MONKEY_UNIT, balance: 28_000n * MONKEY_UNIT });
    expect(await stakeMonkey(panel, 1_000n * MONKEY_UNIT)).toBe(true);
    expect(panel.getSnapshot().wallet.position.value).toMatchObject({ staked: 13_000n * MONKEY_UNIT, balance: 27_000n * MONKEY_UNIT });
    await panel.refreshNode();
    expect(panel.getSnapshot().activity.value?.entries[0]).toMatchObject({ type: "stake", amount: (1_000n * MONKEY_UNIT).toString() });
    expect(store.getSnapshot().toasts.at(-1)).toMatchObject({ tone: "ok", text: "Staked 1,000 MONKEY." });
    expect(store.getSnapshot().busy).toBe(false);
    stop();
  });

  it("says the exact amount in the toast, even one that two places would round to nothing", async () => {
    const { node, store, panel, stop } = await setup();
    node.client.state.monkey.seededBalance.set(DEMO_ADDRESS, 40_000n * MONKEY_UNIT + 5n * 10n ** 15n);
    expect(await stakeMonkey(panel, 5n * 10n ** 15n)).toBe(true);
    expect(store.getSnapshot().toasts.at(-1)).toMatchObject({ tone: "ok", text: "Staked 0.005 MONKEY." });
    stop();
  });

  it("reports a refusal as an error and changes nothing", async () => {
    const { store, panel, stop } = await setup();
    expect(await stakeMonkey(panel, 29_000n * MONKEY_UNIT)).toBe(false);
    expect(store.getSnapshot().toasts.at(-1)).toMatchObject({ tone: "error", text: "Your wallet holds less MONKEY than that." });
    expect(panel.getSnapshot().wallet.position.value?.staked).toBe(12_000n * MONKEY_UNIT);
    stop();
  });

  it("starts an unstake that cannot complete until the cooldown has passed, then returns the tokens", async () => {
    const { node, store, panel, stop } = await setup();
    expect(await startUnstake(panel, 2_000n * MONKEY_UNIT)).toBe(true);
    expect(store.getSnapshot().toasts.at(-1)).toMatchObject({ tone: "ok", text: "Unstake of 2,000 MONKEY started. You can complete it once the cooldown has passed." });
    const position = panel.getSnapshot().wallet.position.value;
    expect(position?.unstaking?.amount).toBe(2_000n * MONKEY_UNIT);
    expect(await completeUnstake(panel)).toBe(false);
    expect(store.getSnapshot().toasts.at(-1)?.tone).toBe("error");
    node.client.state.now = position?.unstaking?.claimableAtMs ?? 0;
    expect(await completeUnstake(panel)).toBe(true);
    expect(panel.getSnapshot().wallet.position.value).toMatchObject({ unstaking: null, staked: 10_000n * MONKEY_UNIT, balance: 30_000n * MONKEY_UNIT });
    stop();
  });

  it("claims the USDC a close distributed, once the vault's checkpoint and the node's proof meet", async () => {
    const { node, store, panel, stop } = await setup();
    node.client.tick(SIM_EPOCH_MS + EPOCH_MS);
    await panel.refreshWallet();
    const proof = panel.getSnapshot().wallet.proof.value;
    expect(BigInt(proof?.entitled ?? "0")).toBeGreaterThan(37_250_000n - 1n);
    expect(await claimDistribution(panel)).toBe(true);
    expect(panel.getSnapshot().wallet.position.value?.distributionsClaimed).toBe(BigInt(proof?.entitled ?? "0"));
    expect(store.getSnapshot().toasts.at(-1)?.text).toMatch(/^The vault paid .* USDC to your wallet\.$/);
    // Nothing more is due.
    expect(await claimDistribution(panel)).toBe(false);
    expect(store.getSnapshot().toasts.at(-1)).toMatchObject({ tone: "info", text: "All distributed USDC is claimed." });
    stop();
  });

  it("sends no claim, and says why, while the vault's checkpoint and the node's proof have not met", async () => {
    const { node, store, panel, stop } = await setup();
    const real = node.client.stats.distributions;
    node.client.stats.distributions = async (address) => {
      const proof = await real(address);
      return proof === null ? null : { ...proof, seq: proof.seq + 1 };
    };
    const claims = vi.spyOn(node.controls, "claimDistribution");
    expect(await claimDistribution(panel)).toBe(false);
    expect(claims).not.toHaveBeenCalled();
    expect(store.getSnapshot().toasts.at(-1)).toMatchObject({ tone: "info", text: expect.stringContaining("have not met yet") });
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
    expect(store.getSnapshot().toasts.at(-1)).toMatchObject({ tone: "info", text: "The wallet changed while the claim was prepared, so nothing was sent." });
    stop();
  });

  it("sends no claim when the node holds no proof for the account", async () => {
    const { node, store, panel, stop } = await setup();
    node.client.state.monkey.distEntitled.clear();
    const claims = vi.spyOn(node.controls, "claimDistribution");
    expect(await claimDistribution(panel)).toBe(false);
    expect(claims).not.toHaveBeenCalled();
    expect(store.getSnapshot().toasts.at(-1)).toMatchObject({ tone: "info", text: "The node holds no distribution proof for this account right now." });
    stop();
  });

  it("sends nothing for an account that cannot sign", async () => {
    const { store, panel, stop } = await setup();
    const wallet = store.liveWallet;
    if (wallet === null) throw new Error("the wallet connected");
    store.liveWallet = { address: wallet.address, label: "Read-only", readOnly: true, sign: wallet.sign, deposit: wallet.deposit, claim: wallet.claim };
    expect(await stakeMonkey(panel, MONKEY_UNIT)).toBe(false);
    expect(store.getSnapshot().toasts.at(-1)).toMatchObject({ tone: "error", text: "This wallet cannot send transactions." });
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
    expect(store.getSnapshot().toasts.at(-1)).toMatchObject({ text: "Another request is in progress, so nothing was sent." });
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
    expect(store.getSnapshot().toasts.at(-1)).toMatchObject({ tone: "info", text: "The wallet changed while this was waiting, so nothing was sent." });
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
    expect(store.getSnapshot().toasts.at(-1)).toMatchObject({ tone: "info", text: "Your earlier request is still with your wallet." });
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
    const later = new MonkeyPanel(store);
    const restart = later.start(() => false);
    held.release();
    await staked;
    await flush();
    expect(later.getSnapshot().wallet.position.value?.staked).toBe(13_000n * MONKEY_UNIT);
    restart();
  });
});
