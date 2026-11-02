import { describe, expect, it } from "vitest";

import { exitPhase, registerSteps } from "../engine/exit-steps";
import { parseExitProof } from "../engine/exit-proof";
import { fixedFromInt } from "../fixed";
import { MockVaultExit } from "./exit";
import { MockState } from "./state";

const ACCOUNT = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";

/** A mock vault with `ACCOUNT` credited, at a posted checkpoint. */
function funded() {
  const state = new MockState(1_000_000);
  state.account(ACCOUNT).balance = fixedFromInt(5_000);
  state.credited.add(ACCOUNT);
  state.postedSeq = 40;
  const vault = new MockVaultExit(state);
  return { state, vault, exit: vault.wallet(ACCOUNT) };
}

describe("MockVaultExit", () => {
  it("serves what the parser reads, at the vault's latest root", async () => {
    const { vault, exit } = funded();
    const proof = parseExitProof(vault.proof(ACCOUNT));
    expect(proof.root).toBe((await exit.facts()).latestRoot);
    expect(await exit.check(proof, proof.root)).toEqual({ ok: true, paidApprovals: [], accountClaim: 5_000_000_000n, distributionOwed: 0n, finalPaidApprovals: [], finalDistributionOwed: 0n });
  });

  it("holds nothing for an account it never credited", () => {
    const { vault } = funded();
    expect(parseExitProof(vault.proof("0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc")).account).toBeNull();
  });

  it("answers ahead of the vault when told to, as a node with an unposted checkpoint does", async () => {
    const { vault, exit } = funded();
    vault.postCheckpoint(true);
    const proof = parseExitProof(vault.proof(ACCOUNT));
    expect(proof.root).not.toBe((await exit.facts()).latestRoot);
    expect(await exit.check(proof, (await exit.facts()).latestRoot)).toMatchObject({ ok: false });
  });

  it("answers the node's 404 before a checkpoint", () => {
    const { state, vault } = funded();
    state.postedSeq = 0;
    expect(vault.proof(ACCOUNT)).toBeNull();
  });

  it("walks the exit: due, started, registered, closed, paid", async () => {
    const { vault, exit } = funded();
    expect(exitPhase(await exit.facts())).toBe("none");
    vault.comeDue();
    expect(exitPhase(await exit.facts())).toBe("due");
    const proof = parseExitProof(vault.proof(ACCOUNT));
    await exit.send({ kind: "start", terms: proof.terms });
    expect(exitPhase(await exit.facts())).toBe("open");
    const facts = await exit.facts();
    const record = { chainId: 31337, vault: "0x", account: ACCOUNT, proof, checkpointAt: facts.lastCheckpointAt, accountClaim: 5_000_000_000n, distributionOwed: 0n, paidApprovals: [] };
    const [step] = registerSteps(record, await exit.claims(proof));
    if (step === undefined) throw new Error("the proof holds a balance to register");
    await exit.send(step);
    expect((await exit.claims(proof)).exitClaim).toBe(5_000_000_000n);
    vault.closeWindow();
    expect(exitPhase(await exit.facts())).toBe("closed");
    expect((await exit.send({ kind: "claim" })).paid).toBe(5_000_000_000n);
    expect((await exit.claims(proof)).exitClaim).toBe(0n);
  });

  it("freezes the vault's root once the exit starts", async () => {
    const { state, vault, exit } = funded();
    vault.comeDue();
    const { latestRoot } = await exit.facts();
    await exit.send({ kind: "start", terms: parseExitProof(vault.proof(ACCOUNT)).terms });
    state.postedSeq = 99;
    expect((await exit.facts()).latestRoot).toBe(latestRoot);
  });

  it("moves to a new root when a checkpoint is posted", async () => {
    const { state, vault, exit } = funded();
    const { latestRoot } = await exit.facts();
    state.seq = 77;
    vault.postCheckpoint(false);
    expect((await exit.facts()).latestRoot).not.toBe(latestRoot);
  });

  it("says a stake is held", async () => {
    const { state, exit } = funded();
    expect(await exit.stakeHeld()).toBe(false);
    state.monkey.staked.set(ACCOUNT, 1n);
    expect(await exit.stakeHeld()).toBe(true);
  });
});
