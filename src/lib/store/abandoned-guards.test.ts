/** Tests for the guards at the payout, emissions and MONKEY call sites: an old wallet's late decline shows nothing to the connection that replaced it, and clears none of its state. */

import { describe, expect, it } from "vitest";

import type { EntitlementProof } from "../engine/emissions";
import { settle } from "../engine/test-kit";
import type { Wallet } from "../engine/wallet";
import { ACCOUNT, memoryStorage } from "../engine/wallet-kit";
import { fixedFromInt } from "../fixed";
import { MONKEY_UNIT } from "../format";
import { MonkeyPanel } from "../monkey/panel";
import { stakeMonkey } from "../monkey/actions";
import { connectWallet, deposit } from "./actions";
import { claimEmissions } from "./emissions";
import { tab } from "./live-kit";
import { claim, reissue } from "./payouts";
import { signed } from "./payouts-kit";

/** What a wallet answers when the user declines. */
const decline = () => Promise.reject(new Error("You declined in your wallet.", { cause: { code: 4001 } }));

/** A tab connected with the first wallet; an action of it can wait on `hold` until `declineLate` lets it decline. */
async function connectedTab() {
  const kit = await tab(memoryStorage());
  kit.client.credited = true;
  await connectWallet(kit.store, "injected");
  let declineLate!: () => void;
  const hold = new Promise<void>((resolve) => { declineLate = resolve; });
  return { ...kit, hold, declineLate };
}

/** Connects the next wallet, for the same account, and starts its own deposit, left waiting at a prompt. */
async function nextWalletWaiting(kit: Awaited<ReturnType<typeof connectedTab>>) {
  let progress!: (waitingFor: string) => void;
  const next: Wallet = { address: ACCOUNT, label: "Next", sign: async () => "0x", claim: async () => "0x", deposit: (_amount, report) => new Promise<string>(() => { progress = report ?? (() => {}); }) };
  await connectWallet(kit.store, "other", false, next);
  void deposit(kit.store, fixedFromInt(10));
  await settle();
  progress("Confirm the deposit in your wallet.");
  return kit.store.getSnapshot();
}

/** Lets the old wallet decline and checks the next connection saw nothing of it. */
async function expectUntouched(kit: Awaited<ReturnType<typeof connectedTab>>, before: ReturnType<typeof kit.store.getSnapshot>) {
  kit.declineLate();
  await settle();
  const after = kit.store.getSnapshot();
  expect(after.toasts).toEqual(before.toasts);
  expect([after.busy, after.prompt]).toEqual([true, "Confirm the deposit in your wallet."]);
  return after;
}

describe("a vault claim whose wallet is replaced while it prompts", () => {
  it("shows the next connection nothing, keeps its busy state and prompt, and leaves its unpaid list alone", async () => {
    const kit = await connectedTab();
    kit.store.patch({ authorizations: [signed(1, 2_000_000_000)] });
    kit.wallet.claim = async () => { await kit.hold; return decline(); };
    const claiming = claim(kit.store, 1);
    await settle();
    const before = await nextWalletWaiting(kit);
    kit.store.patch({ unpaid: [1, 7] });
    const after = await expectUntouched(kit, { ...before, unpaid: [1, 7] });
    await claiming;
    expect(after.unpaid).toEqual([1, 7]);
    expect(kit.store.getSnapshot().unpaid).toEqual([1, 7]);
  });
});

describe("a reissue whose wallet is replaced while it prompts", () => {
  it("shows the next connection nothing, keeps its busy state and prompt, and leaves its unpaid list alone", async () => {
    const kit = await connectedTab();
    kit.store.patch({ authorizations: [signed(1, 2_000_000_000)] });
    kit.wallet.sign = async () => { await kit.hold; return decline(); };
    const reissuing = reissue(kit.store, 1, 2_000_000_000);
    await settle();
    const before = await nextWalletWaiting(kit);
    kit.store.patch({ unpaid: [1, 7] });
    await expectUntouched(kit, { ...before, unpaid: [1, 7] });
    await reissuing;
    expect(kit.store.getSnapshot().unpaid).toEqual([1, 7]);
  });
});

describe("a MONKEY claim whose wallet is replaced while it prompts", () => {
  it("shows the next connection nothing and keeps its busy state and prompt", async () => {
    const kit = await connectedTab();
    const entitlement: EntitlementProof = { seq: 40, root: `0x${"11".repeat(32)}`, account: ACCOUNT, entitled: (5n * MONKEY_UNIT).toString(), siblings: [] };
    kit.client.entitlement = entitlement;
    kit.wallet.emissionsClaimed = async () => ({ claimed: 0n, latestSeq: 40 });
    kit.wallet.claimEmissions = async () => { await kit.hold; return decline(); };
    const claiming = claimEmissions(kit.store);
    await settle();
    const before = await nextWalletWaiting(kit);
    await expectUntouched(kit, before);
    await claiming;
    expect([kit.store.getSnapshot().busy, kit.store.getSnapshot().prompt]).toEqual([true, "Confirm the deposit in your wallet."]);
  });
});

describe("a MONKEY stake whose wallet is replaced while it prompts", () => {
  it("shows the next connection nothing and keeps its busy state and prompt", async () => {
    const kit = await connectedTab();
    const { staking } = kit.wallet;
    if (staking === undefined) throw new Error("the wallet stakes");
    kit.wallet.staking = { ...staking, stake: async () => { await kit.hold; return decline(); } };
    const staked = stakeMonkey(new MonkeyPanel(kit.store), MONKEY_UNIT);
    await settle();
    const before = await nextWalletWaiting(kit);
    await expectUntouched(kit, before);
    expect(await staked).toBe(false);
    expect([kit.store.getSnapshot().busy, kit.store.getSnapshot().prompt]).toEqual([true, "Confirm the deposit in your wallet."]);
  });
});
