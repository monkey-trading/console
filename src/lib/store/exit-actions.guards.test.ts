import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { factsAt, FakeExitWallet, fullProof, NO_CLAIMS } from "../engine/exit-kit";
import { settle } from "../engine/test-kit";
import type { Wallet } from "../engine/wallet";
import { claimVaultExit, importChosenFile, registerExitClaims, startVaultExit } from "./exit-actions";
import { readingProof } from "./exit-state";
import { exitView } from "./exit-view";
import { exitWatchKit } from "./exit-watch-kit";

const CLOSED = 5_000 + 2_592_000;

describe("an exit action, once the connection that asked has ended", () => {
  let kit: ReturnType<typeof exitWatchKit>;
  beforeEach(async () => {
    kit = exitWatchKit();
    await kit.connect();
    kit.exit.vault = factsAt(100, { exitStartedAt: 5_000, chainNow: 6_000 });
    await kit.store.exit.refresh();
  });
  const disconnect = () => {
    kit.store.liveWallet = null;
    kit.store.patch({ wallet: null });
  };
  const moveTo = (next: Wallet) => {
    kit.store.liveWallet = next;
    kit.store.patch({ wallet: { address: next.address, label: "Next" } });
  };

  it.each<[string, () => void]>([
    ["is disconnected", disconnect],
    ["moves to another wallet", () => moveTo({ ...kit.wallet, exit: new FakeExitWallet() })],
  ])("sends no further step when it %s between steps", async (_name, end) => {
    kit.exit.onSend = () => { if (kit.exit.sent.length === 1) end(); };
    await registerExitClaims(kit.store);
    expect(kit.exit.sent.map((step) => step.kind)).toEqual(["account"]);
  });
  it("sends every step while it lasts", async () => {
    await registerExitClaims(kit.store);
    expect(kit.exit.sent.map((step) => step.kind)).toEqual(["account", "approval", "queued", "distribution"]);
  });
  it("sends nothing when it ends while the vault is read before the first step", async () => {
    kit.exit.vault = factsAt(100, { chainNow: 1_000 + 2_592_000 });
    await kit.store.exit.refresh();
    const facts = kit.exit.facts.bind(kit.exit);
    kit.exit.facts = async () => {
      const answer = await facts();
      disconnect();
      return answer;
    };
    await startVaultExit(kit.store);
    expect(kit.exit.sent).toEqual([]);
  });
  it("gives back the buttons of the connection that came next, and tells it nothing", async () => {
    kit.exit.onSend = () => moveTo({ ...kit.wallet, exit: new FakeExitWallet() });
    await registerExitClaims(kit.store);
    expect(kit.store.getSnapshot().exit.announced).toBe("");
    expect(kit.store.getSnapshot().notices.exit).toBeUndefined();
  });
});

describe("a claim this page has had paid", () => {
  let kit: ReturnType<typeof exitWatchKit>;
  const view = () => exitView(kit.store.getSnapshot().exit, { address: kit.wallet.address });
  beforeEach(async () => {
    kit = exitWatchKit();
    await kit.connect();
    kit.exit.vault = factsAt(100, { exitStartedAt: 5_000, chainNow: CLOSED });
    kit.exit.claimsHeld = { ...NO_CLAIMS, exitClaim: 7n };
    await kit.store.exit.refresh();
    kit.exit.onSend = () => { kit.exit.claimsError = new Error("the wallet's RPC failed"); }; // the read after it fails, so `claims` stays as it was
  });

  it.each<[string, bigint | null]>([["named in its receipt", 4_800_000_000n], ["its receipt does not name", null]])("is not offered again, for an amount %s, while the read after it fails", async (_name, paid) => {
    expect(view().canClaim).toBe(true);
    kit.exit.paidAnswer = paid;
    await claimVaultExit(kit.store);
    expect(kit.store.getSnapshot().exit.claims?.exitClaim).toBe(7n);
    expect(kit.store.getSnapshot().exit.paid).toBe(paid);
    expect(view().canClaim).toBe(false);
    expect(view().notice).toBeNull();
  });
  it("is offered still when the claim did not go through", async () => {
    kit.exit.sendError = new Error("You declined to claim your exit from the vault in your wallet.");
    await claimVaultExit(kit.store);
    expect(kit.store.getSnapshot().exit.claimed).toBe(false);
    expect(view().canClaim).toBe(true);
  });
});

describe("a chosen file", () => {
  let kit: ReturnType<typeof exitWatchKit>;
  const exit = () => kit.store.getSnapshot().exit;
  const notice = () => kit.store.getSnapshot().notices.exit?.text;
  const slow = () => {
    let finish: (text: string) => void = () => undefined;
    const reads = { count: 0 };
    return { reads, finish: (text: string) => finish(text), file: { size: 2, text: () => { reads.count += 1; return new Promise<string>((resolve) => { finish = resolve; }); } } };
  };
  const BUILDER = JSON.stringify({ seq: 100, root: fullProof(100).root, account: fullProof(100), house_pending_deposits: [], calls: [] });
  beforeEach(async () => {
    kit = exitWatchKit();
    await kit.connect(0n);
  });
  afterEach(() => { vi.useRealTimers(); });

  it("holds the controls from the moment it is chosen, while its text is read", async () => {
    const chosen = slow();
    const pending = importChosenFile(kit.store, chosen.file);
    expect(readingProof(exit())).toBe(true);
    chosen.finish(BUILDER);
    await pending;
    expect(readingProof(exit())).toBe(false);
  });
  it("holds them through a node's read that ends meanwhile", async () => {
    const chosen = slow();
    const pending = importChosenFile(kit.store, chosen.file);
    kit.store.patch({ exit: { ...exit(), reading: false } });
    expect(readingProof(exit())).toBe(true);
    chosen.finish(BUILDER);
    await pending;
  });
  it("takes no second file while the first is out, so the first cannot replace the second's result", async () => {
    const first = slow();
    const second = slow();
    const pending = importChosenFile(kit.store, first.file);
    await importChosenFile(kit.store, second.file);
    expect(second.reads.count).toBe(0);
    first.finish("{nope");
    await pending;
    expect(notice()).toMatch(/not JSON/);
    expect(readingProof(exit())).toBe(false);
  });
  it("clears the last result when it is chosen", async () => {
    kit.store.exit.note({ ok: false, text: "An earlier refusal." });
    const chosen = slow();
    const pending = importChosenFile(kit.store, chosen.file);
    expect(notice()).toBeUndefined();
    chosen.finish("{nope");
    await pending;
  });
  it("gives the controls back when a read fails", async () => {
    await importChosenFile(kit.store, { size: 2, text: () => Promise.reject(new Error("gone")) });
    expect(notice()).toBe("The file could not be read.");
    expect(readingProof(exit())).toBe(false);
  });
  it("gives them back when a read never ends", async () => {
    vi.useFakeTimers();
    const pending = importChosenFile(kit.store, { size: 2, text: () => new Promise<string>(() => undefined) });
    expect(readingProof(exit())).toBe(true);
    await vi.advanceTimersByTimeAsync(120_000);
    await pending;
    expect(notice()).toBe("The file could not be read.");
    expect(readingProof(exit())).toBe(false);
  });
  it("holds nothing for a file refused for its length", async () => {
    await importChosenFile(kit.store, { size: 17 * 1024 * 1024, text: async () => "{}" });
    expect(notice()).toMatch(/longer than any exit proof/);
    expect(readingProof(exit())).toBe(false);
  });
  it("holds nothing with no wallet to check it", async () => {
    kit.store.liveWallet = null;
    await importChosenFile(kit.store, { size: 2, text: async () => "{}" });
    expect(readingProof(exit())).toBe(false);
  });
  it("leaves the next wallet's controls free when the read ends after it connected", async () => {
    const chosen = slow();
    const pending = importChosenFile(kit.store, chosen.file);
    const next: Wallet = { ...kit.wallet, exit: new FakeExitWallet() };
    kit.store.liveWallet = next;
    kit.store.patch({ wallet: { address: next.address, label: "Next" } });
    await settle();
    expect(readingProof(exit())).toBe(false);
    chosen.finish("{nope");
    await pending;
    expect(notice()).toBeUndefined();
    expect(readingProof(exit())).toBe(false);
  });
});
