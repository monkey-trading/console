import { beforeEach, describe, expect, it } from "vitest";

import { factsAt, fullProof, NO_CLAIMS } from "../engine/exit-kit";
import { settle } from "../engine/test-kit";
import type { Wallet } from "../engine/wallet";
import { claimVaultExit, importChosenFile, importExitFile, refundExitDeposit, registerExitClaims, startVaultExit } from "./exit-actions";
import { exitWatchKit } from "./exit-watch-kit";

describe("what the panel says of an exit action", () => {
  let kit: ReturnType<typeof exitWatchKit>;
  const exit = () => kit.store.getSnapshot().exit;
  const notice = () => kit.store.getSnapshot().notices.exit;
  const CLOSED = 5_000 + 2_592_000;

  beforeEach(() => {
    kit = exitWatchKit();
  });

  it("tells a screen reader what each action did, though the panel says nothing more of it", async () => {
    await kit.connect();
    kit.exit.vault = factsAt(100, { chainNow: 1_000 + 2_592_000 });
    await kit.store.exit.refresh();
    await startVaultExit(kit.store);
    expect(exit().announced).toBe("The vault's exit has started.");
    kit.exit.vault = factsAt(100, { exitStartedAt: 5_000, chainNow: 6_000 });
    await kit.store.exit.refresh();
    await registerExitClaims(kit.store);
    expect(exit().announced).toMatch(/^Your claim is registered\./);
    kit.exit.claimsHeld = { ...NO_CLAIMS, unheld: [{ id: 7, amount: 9n }] };
    await refundExitDeposit(kit.store, { kind: "refund-unheld", id: 7, amount: 9n });
    expect(exit().announced).toBe("Deposit 7 was refunded to the address that paid it.");
    kit.exit.vault = factsAt(100, { exitStartedAt: 5_000, chainNow: CLOSED });
    kit.exit.claimsHeld = { ...NO_CLAIMS, exitClaim: 5_000_000_000n };
    await kit.store.exit.refresh();
    await claimVaultExit(kit.store);
    expect(exit().announced).toBe("The vault paid 4,800 USDC to your wallet.");
    expect(notice()).toBeUndefined();
  });

  it("tells a screen reader of an import, and of a refusal", async () => {
    await kit.connect(0n);
    await importExitFile(kit.store, "{nope");
    expect(notice()).toMatchObject({ tone: "error", text: expect.stringMatching(/^The file was not imported/) });
    await importExitFile(kit.store, JSON.stringify({ seq: 100, root: fullProof(100).root, account: fullProof(100), house_pending_deposits: [], calls: [] }));
    expect(exit().announced).toBe("Imported the proof for checkpoint 100.");
  });

  it("says so when a file is for the checkpoint already saved, which moves nothing on the panel, and stays quiet when it moves the saved line", async () => {
    await kit.connect(0n);
    const file = JSON.stringify({ seq: 100, root: fullProof(100).root, account: fullProof(100), house_pending_deposits: [], calls: [] });
    await importExitFile(kit.store, file);
    expect(notice()).toBeUndefined();
    expect(exit().announced).toBe("Imported the proof for checkpoint 100.");
    await importExitFile(kit.store, file);
    expect(notice()).toMatchObject({ tone: "info", text: "This file is for the checkpoint already saved, and the vault accepts it." });
    expect(exit().announced).toBe("Imported the proof for checkpoint 100.");
  });

  it("says what went through when the read after it fails, which would otherwise not show it", async () => {
    await kit.connect();
    kit.exit.vault = factsAt(100, { exitStartedAt: 5_000, chainNow: 6_000 });
    await kit.store.exit.refresh();
    kit.exit.onSend = () => { kit.exit.claimsError = new Error("the wallet's RPC failed"); };
    await registerExitClaims(kit.store);
    expect(exit().claimsProblem).toMatch(/RPC failed/);
    expect(notice()).toMatchObject({ tone: "info", text: "Your claim is registered. The vault pays it once the claim window closes. What the vault holds is read again by itself." });
  });

  it("announces a result the same as the last again, or it would go unread", async () => {
    await kit.connect();
    await importExitFile(kit.store, "{nope");
    const refusal = notice()?.id;
    await importExitFile(kit.store, "{nope");
    expect(notice()?.id).not.toBe(refusal);
    kit.store.exit.announce("The vault's exit has started.");
    const first = exit().announced;
    kit.store.exit.announce("The vault's exit has started.");
    expect(exit().announced).not.toBe(first);
    expect(exit().announced.trim()).toBe(first);
  });

  it("shows the wallet's request in the panel while it waits", async () => {
    await kit.connect();
    kit.exit.vault = factsAt(100, { exitStartedAt: 5_000, chainNow: CLOSED });
    kit.exit.claimsHeld = { ...NO_CLAIMS, exitClaim: 5n };
    await kit.store.exit.refresh();
    let asked: string | null = null;
    kit.exit.onSend = () => { asked = kit.store.getSnapshot().promptAt; };
    await claimVaultExit(kit.store);
    expect(asked).toBe("exit");
    expect(kit.store.getSnapshot().promptAt).toBeNull();
  });

  it("tells a screen reader when a press found nothing left to do", async () => {
    await kit.connect();
    kit.exit.vault = factsAt(100, { exitStartedAt: 5_000, chainNow: 6_000 });
    kit.exit.claimsHeld = { ...NO_CLAIMS, accountRegistered: true, approvalsUsed: [1], queuedRegistered: [95], distributionRegistered: true };
    await kit.store.exit.refresh();
    await registerExitClaims(kit.store);
    expect(exit().announced).toBe("Everything this proof holds is registered.");
    await refundExitDeposit(kit.store, { kind: "refund-unheld", id: 7, amount: 9n });
    expect(exit().announced).toBe("Deposit 7 has been refunded already.");
    expect(kit.exit.sent).toEqual([]);
  });

  it("holds the buttons until the read after an action has answered", async () => {
    await kit.connect();
    kit.exit.vault = factsAt(100, { chainNow: 1_000 + 2_592_000 });
    await kit.store.exit.refresh();
    let busyDuringRead: boolean | null = null;
    const facts = kit.exit.facts.bind(kit.exit);
    kit.exit.onSend = () => { kit.exit.facts = async () => { busyDuringRead = kit.store.getSnapshot().busy; return facts(); }; };
    await startVaultExit(kit.store);
    expect(busyDuringRead).toBe(true);
    expect(kit.store.getSnapshot().busy).toBe(false);
  });

  describe("a file the trader chose", () => {
    const file = (text: () => Promise<string>, size = 10) => ({ size, text });
    it("is refused for its size, and for a read that fails", async () => {
      await kit.connect();
      await importChosenFile(kit.store, file(async () => "{}", 17 * 1024 * 1024));
      expect(notice()?.text).toMatch(/longer than any exit proof/);
      await importChosenFile(kit.store, file(async () => { throw new Error("gone"); }));
      expect(notice()?.text).toBe("The file could not be read.");
    });
    it("counts for no wallet connected since it was chosen", async () => {
      await kit.connect();
      let read: (text: string) => void = () => undefined;
      const pending = importChosenFile(kit.store, file(() => new Promise((resolve) => { read = resolve; })));
      kit.store.liveWallet = { ...kit.wallet };
      kit.store.patch({ wallet: { address: kit.wallet.address, label: "Next" } });
      await settle();
      read("{nope");
      await pending;
      expect(notice()).toBeUndefined();
    });
  });

  it("credits no payment to the wallet connected since it was sent", async () => {
    await kit.connect();
    kit.exit.vault = factsAt(100, { exitStartedAt: 5_000, chainNow: CLOSED });
    kit.exit.claimsHeld = { ...NO_CLAIMS, exitClaim: 5n };
    await kit.store.exit.refresh();
    kit.exit.onSend = () => {
      const next: Wallet = { ...kit.wallet };
      kit.store.liveWallet = next;
      kit.store.patch({ wallet: { address: next.address, label: "Next" } });
    };
    await claimVaultExit(kit.store);
    await settle();
    expect(exit().paid).toBeNull();
    expect(exit().announced).toBe("");
  });
});
