/** Tests for the distribution proof the MONKEY page holds: reads that overlap, an answer at an older checkpoint, and a read-only account. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { accruedOf } from "../engine/claim-standing";
import type { DistributionProof } from "../engine/stats-types";
import { DEMO_ADDRESS } from "../mock/demo";
import { flush, setup } from "./panel-kit";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** USDC base units well above the 37.25 USDC the demo account is seeded with, so no answer here sits below what it held. */
const USDC = 1_000_000_000n;

/** The node's answer at checkpoint `seq`, naming `entitled` times a billion base units, while its newest checkpoint names `newest`. */
const answer = (seq: number, entitled: bigint, newest = entitled): DistributionProof => ({
  seq, root: `0x${"11".repeat(32)}`, account: DEMO_ADDRESS, entitled: String(entitled * USDC), siblings: [],
  accepted_seq: seq, newest_seq: 44, newest_entitled: String(newest * USDC), claimable: true,
});

/** Makes each read of the proof wait to be answered, in the order the reads were asked. */
function hold(store: Awaited<ReturnType<typeof setup>>["store"]) {
  const reads: { answer: (proof: DistributionProof | Error) => void }[] = [];
  vi.spyOn(store.deps.client.stats, "distributions").mockImplementation(
    () => new Promise((resolve, reject) => { reads.push({ answer: (proof) => (proof instanceof Error ? reject(proof) : resolve(proof)) }); }),
  );
  return reads;
}

describe("the page's distribution proof", () => {
  it("drops an answer that a read begun after it has already overtaken", async () => {
    const { store, panel, stop } = await setup();
    const reads = hold(store);
    void panel.refreshWallet(true);
    void panel.refreshWallet(true);
    await flush();
    expect(reads).toHaveLength(2);
    reads[1]?.answer(answer(12, 900n));
    await flush();
    expect(panel.getSnapshot().wallet.proof.value?.seq).toBe(12);
    reads[0]?.answer(answer(10, 500n));
    await flush();
    expect(panel.getSnapshot().wallet.proof.value?.seq).toBe(12);
    stop();
  });

  it("drops a failure that a later read has overtaken, and keeps the figure the later read gave", async () => {
    const { store, panel, stop } = await setup();
    const reads = hold(store);
    void panel.refreshWallet(true);
    void panel.refreshWallet(true);
    await flush();
    reads[1]?.answer(answer(12, 900n));
    await flush();
    reads[0]?.answer(new Error("the node did not answer"));
    await flush();
    expect(panel.getSnapshot().wallet.proof).toMatchObject({ status: "ready" });
    stop();
  });

  it("takes a later read that names an older checkpoint, since the node may now answer at the vault's, and does not let the accrued figure fall with it", async () => {
    const { store, panel, stop } = await setup();
    const reads = hold(store);
    void panel.refreshWallet(true);
    await flush();
    reads[0]?.answer({ ...answer(44, 1_400n), accepted_seq: null, claimable: false });
    await flush();
    void panel.refreshWallet(true);
    await flush();
    reads[1]?.answer(answer(40, 900n, 1_400n));
    await flush();
    const held = panel.getSnapshot().wallet.proof.value;
    expect(held).toMatchObject({ seq: 40, entitled: String(900n * USDC) });
    expect(held === null || held === undefined ? null : accruedOf(held)).toBe(1_400n * USDC);
    stop();
  });

  it("keeps the earned figure when a later answer from the node understates the newest checkpoint", async () => {
    const { store, panel, stop } = await setup();
    const reads = hold(store);
    void panel.refreshWallet(true);
    await flush();
    reads[0]?.answer(answer(44, 1_400n));
    await flush();
    void panel.refreshWallet(true);
    await flush();
    reads[1]?.answer(answer(40, 900n));
    await flush();
    const held = panel.getSnapshot().wallet.proof.value;
    expect(held === null || held === undefined ? null : accruedOf(held)).toBe(1_400n * USDC);
    stop();
  });

  it("is read again for a watched account, which can sign nothing, after a read failed", async () => {
    const { store, panel, stop } = await setup();
    const wallet = store.liveWallet;
    if (wallet === null) throw new Error("the wallet connected");
    store.liveWallet = { address: wallet.address, label: "Read-only", readOnly: true, sign: wallet.sign, deposit: wallet.deposit, claim: wallet.claim };
    const reads = hold(store);
    void panel.refreshWallet(true);
    await flush();
    reads[0]?.answer(new Error("the node did not answer"));
    await flush();
    expect(panel.getSnapshot().wallet.proof.status).toBe("failed");
    void panel.refreshWallet(true);
    await flush();
    reads[1]?.answer(answer(40, 900n));
    await flush();
    expect(panel.getSnapshot().wallet.proof).toMatchObject({ status: "ready", value: { seq: 40 } });
    stop();
  });
});
