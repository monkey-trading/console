import { beforeEach, describe, expect, it } from "vitest";

import { writeStoredExit } from "../engine/exit-file";
import { factsAt, fullProof, NO_CLAIMS, recordAt } from "../engine/exit-kit";
import { parseExitProof } from "../engine/exit-proof";
import { claimVaultExit, refundExitDeposit, registerExitClaims } from "./exit-actions";
import { exitWatchKit } from "./exit-watch-kit";

const CLOSED_AT = 5_000 + 2_592_000;
const CLOSED = factsAt(100, { exitStartedAt: 5_000, chainNow: CLOSED_AT });
const OPEN = factsAt(100, { exitStartedAt: 5_000, chainNow: 6_000 });

describe("an exit action, on what the vault holds as it is pressed", () => {
  let kit: ReturnType<typeof exitWatchKit>;
  const said = () => kit.store.getSnapshot().notices.exit?.text ?? null;
  const pending = () => ({ kind: "refund" as const, proof: parseExitProof(fullProof(100)).pending_deposits[0] ?? (() => { throw new Error("the fixture holds a deposit"); })(), amount: 25_000_000n });
  /** Connects with the node gone, a proof saved at the vault's root, and the vault as `vault` says. */
  const connected = async (vault = OPEN) => {
    writeStoredExit(() => kit.storage, recordAt(100));
    kit.exit.vault = vault;
    kit.client.exitError = new Error("the node is gone");
    await kit.attach({ attestation: { kind: "unverified", reason: "The node did not answer." }, stream: "stale" });
    await kit.store.exit.refresh();
  };
  beforeEach(() => { kit = exitWatchKit(); });

  describe("claimVaultExit", () => {
    it("sends the claim when the vault still holds it", async () => {
      kit.exit.claimsHeld = { ...NO_CLAIMS, exitClaim: 7n };
      await connected(CLOSED);
      await claimVaultExit(kit.store);
      expect(kit.exit.sent).toEqual([{ kind: "claim" }]);
    });
    it("sends nothing once another tab or a relayer has claimed it, and says so", async () => {
      kit.exit.claimsHeld = { ...NO_CLAIMS, exitClaim: 7n };
      await connected(CLOSED);
      kit.exit.claimsHeld = NO_CLAIMS;
      await claimVaultExit(kit.store);
      expect(kit.exit.sent).toEqual([]);
      expect(said()).toBe("Nothing is registered for this account, or the vault has paid it, so nothing was sent.");
    });
    it("reads a distribution's claim as registered too", async () => {
      kit.exit.claimsHeld = { ...NO_CLAIMS, exitDistributionClaim: 1n };
      await connected(CLOSED);
      await claimVaultExit(kit.store);
      expect(kit.exit.sent).toEqual([{ kind: "claim" }]);
    });
    it.each<[string, (exit: typeof kit.exit) => void]>([
      ["the vault", (exit) => { exit.factsError = new Error("wrong chain"); }],
      ["its record", (exit) => { exit.claimsError = new Error("the wallet's RPC failed"); }],
    ])("sends nothing when %s cannot be read, and says so", async (_name, fail) => {
      kit.exit.claimsHeld = { ...NO_CLAIMS, exitClaim: 7n };
      await connected(CLOSED);
      fail(kit.exit);
      await claimVaultExit(kit.store);
      expect(kit.exit.sent).toEqual([]);
      expect(said()).toBe("The vault's record could not be read, so nothing was sent.");
    });
    it("sends nothing while the window is open, and says so", async () => {
      kit.exit.claimsHeld = { ...NO_CLAIMS, exitClaim: 7n };
      await connected(OPEN);
      await claimVaultExit(kit.store);
      expect(kit.exit.sent).toEqual([]);
      expect(said()).toBe("The vault's claim window has not closed, so nothing was sent.");
    });
  });

  describe("registerExitClaims", () => {
    it("sends nothing from a proof the verifier has not accepted in this connection", async () => {
      kit.exit.checkError = new Error("no answer");
      await connected();
      await registerExitClaims(kit.store);
      expect(kit.exit.sent).toEqual([]);
      expect(said()).toBe("The vault has not accepted a proof at its latest checkpoint, so nothing was sent.");
    });
  });

  describe("refundExitDeposit", () => {
    it("sends nothing from a proof the verifier has not accepted in this connection", async () => {
      kit.exit.checkError = new Error("no answer");
      await connected();
      await refundExitDeposit(kit.store, pending());
      expect(kit.exit.sent).toEqual([]);
      expect(said()).toBe("The vault has not accepted a proof at its latest checkpoint, so nothing was sent.");
    });
    it("still refunds what needs no proof, with a proof the verifier has not accepted", async () => {
      kit.exit.checkError = new Error("no answer");
      kit.exit.claimsHeld = { ...NO_CLAIMS, unheld: [{ id: 7, amount: 9n }] };
      await connected();
      const step = { kind: "refund-unheld" as const, id: 7, amount: 9n };
      await refundExitDeposit(kit.store, step);
      expect(kit.exit.sent).toEqual([step]);
    });
    it("sends nothing for a deposit the vault's record disagrees with, says why, and keeps the proof", async () => {
      kit.exit.claimsHeld = { ...NO_CLAIMS, mismatched: [2] };
      await connected();
      await refundExitDeposit(kit.store, pending());
      expect(kit.exit.sent).toEqual([]);
      expect(said()).toBe("The vault's record of deposit 2 is not what this proof says, so nothing was sent.");
      expect(kit.store.getSnapshot().exit.record?.proof.seq).toBe(100);
    });
  });
});
