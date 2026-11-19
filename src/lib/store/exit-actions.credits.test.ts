/** An account's unfinalised credits: registered in the same press as its equity, which they wait for, and valued again with each read of the vault. */

import { beforeEach, describe, expect, it } from "vitest";

import { accepts, factsAt, fullProof } from "../engine/exit-kit";
import type { ExitPendingProof } from "../engine/exit-types";
import { refundExitDeposit, registerExitClaims } from "./exit-actions";
import { exitWatchKit } from "./exit-watch-kit";

describe("registering an account with unfinalised credits", () => {
  let kit: ReturnType<typeof exitWatchKit>;
  const proof = fullProof(100);
  const credit = (id: number): ExitPendingProof => ({ seq: proof.seq, root: proof.root, siblings: [], chain_ref: `0xfeed:${id}`, deposit: { deposit_id: id, account: proof.account?.account ?? null, payer: proof.account?.account ?? null, amount: "40" } });

  beforeEach(async () => {
    kit = exitWatchKit();
    kit.client.exitAnswer = { ...proof, unfinalised_credits: Array.from({ length: 33 }, (_, id) => credit(id + 10)) };
    await kit.connect();
    kit.exit.vault = factsAt(100, { exitStartedAt: 5_000, chainNow: 6_000 });
    await kit.store.exit.refresh();
  });

  it("sends the credits right after the account's equity in one press, a batch at a time, each counted in the press", async () => {
    await registerExitClaims(kit.store);
    expect(kit.exit.sent.map((step) => (step.kind === "credits" ? `credits:${step.part}/${step.parts}:${step.proofs.length}` : step.kind))).toEqual(["account", "credits:1/2:32", "credits:2/2:1", "approval", "queued", "distribution"]);
    expect(kit.store.getSnapshot().exit.announced).toMatch(/^Your claim is registered, and/);
  });

  it("values the proof again with each read of the vault, before the exit and during it, as a credit counts only while the vault holds its deposit", async () => {
    for (const vault of [factsAt(100), factsAt(100, { exitStartedAt: 5_000, chainNow: 6_000 })]) {
      kit.exit.vault = vault;
      const claim = BigInt(kit.exit.previews + 9);
      kit.exit.verdict = () => accepts({ accountClaim: claim });
      await kit.store.exit.refresh();
      const { record, checked } = kit.store.getSnapshot().exit;
      expect(record?.accountClaim).toBe(claim);
      expect(checked).toBe(record);
    }
  });

  it("keeps the figures it has when the verifier now refuses, or its read fails, and still reads what the vault holds", async () => {
    const before = kit.store.getSnapshot().exit.record;
    kit.exit.verdict = () => ({ ok: false, reason: "the vault's snapshot does not confirm its balance and positions" });
    await kit.store.exit.refresh();
    expect(kit.store.getSnapshot().exit.record).toBe(before);
    kit.exit.previewError = new Error("the wallet's RPC timed out");
    expect(await kit.store.exit.readFresh()).toBe(true);
    expect(await kit.store.exit.readClaims()).toBe(true);
    expect(kit.store.getSnapshot().exit).toMatchObject({ record: before, claimsProblem: null });
  });

  it("says so when a valuation fails, holds up registering until one answers, and clears once one does", async () => {
    kit.exit.previewError = new Error("the wallet's RPC timed out");
    await kit.store.exit.refresh();
    expect(kit.store.getSnapshot().exit.attempt).toEqual({ kind: "wallet-failed", reason: "the wallet's RPC timed out" });
    await registerExitClaims(kit.store);
    expect(kit.exit.sent).toEqual([]);
    expect(kit.store.getSnapshot().notices.exit?.text).toBe("Your wallet could not value your unconfirmed deposits against the vault, so nothing was sent.");
    kit.exit.previewError = null;
    await kit.store.exit.refresh();
    expect(kit.store.getSnapshot().exit).toMatchObject({ attempt: null, checkFailures: 0 });
  });

  it("leaves a proof that another took the place of while it was valued", async () => {
    const other = { ...(kit.store.getSnapshot().exit.record ?? fail()), accountClaim: 1n };
    kit.exit.verdict = () => {
      kit.store.patch({ exit: { ...kit.store.getSnapshot().exit, record: other, checked: other } });
      return accepts({ accountClaim: 9n });
    };
    await kit.store.exit.refresh();
    expect(kit.store.getSnapshot().exit.record).toBe(other);
  });
});

describe("a proof with no unfinalised credits", () => {
  it("is not valued again by each read of the vault", async () => {
    const kit = exitWatchKit();
    await kit.connect();
    await kit.store.exit.refresh();
    expect(kit.exit.previews).toBe(0);
  });
});

const fail = (): never => {
  throw new Error("the kit saved a proof");
};

describe("a refund through an unmatched receipt", () => {
  it("is not sent once the claim window has closed", async () => {
    const kit = exitWatchKit();
    await kit.connect();
    const proof = fullProof(100).pending_deposits[0];
    if (proof === undefined) throw new Error("the fixture holds a pending deposit");
    kit.exit.vault = factsAt(100, { exitStartedAt: 5_000, chainNow: 5_000 + 2_592_000 });
    await refundExitDeposit(kit.store, { kind: "refund-receipt", id: 2, amount: 24_000_000n, proof, leafKind: 34 });
    expect(kit.exit.sent).toEqual([]);
    expect(kit.store.getSnapshot().notices.exit?.text).toBe("The claim window has closed, so deposit 2 can no longer be refunded through the proof, and nothing was sent.");
  });
});
