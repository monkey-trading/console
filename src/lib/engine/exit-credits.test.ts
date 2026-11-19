/** An account's unfinalised credits from V77: read with its proof, and registered after its equity, each batch once. */

import { describe, expect, it } from "vitest";

import { ACCOUNT, fullProof, NO_CLAIMS, OTHER, recordAt } from "./exit-kit";
import { ExitProofError, holdsAnything, parseExitProof } from "./exit-proof";
import { CREDITS_PER_STEP, holdsLess, registerSteps } from "./exit-steps";
import type { ExitPendingProof } from "./exit-types";
import { stepKey, stepLabel } from "../store/exit-view";

const stand = { seq: 100, root: fullProof(100).root, siblings: [`0x${"ab".repeat(32)}`] };
const credit = (id: number, account: string | null = ACCOUNT): ExitPendingProof => ({ ...stand, chain_ref: `0xfeed:${id}`, deposit: { deposit_id: id, account, payer: account, amount: "40" } });
const withCredits = (credits: unknown[]): unknown => ({ ...fullProof(100), unfinalised_credits: credits });

describe("parseExitProof, of an account's unfinalised credits", () => {
  it("reads none from a proof saved before V77, which has no such list", () => {
    const older: Record<string, unknown> = { ...fullProof(100) };
    delete older.unfinalised_credits;
    expect(parseExitProof(older).unfinalised_credits).toEqual([]);
  });

  it("reads them in increasing deposit id, as the verifier takes them", () => {
    expect(parseExitProof(withCredits([credit(7), credit(3)])).unfinalised_credits.map((held) => held.deposit.deposit_id)).toEqual([3, 7]);
  });

  it.each<[string, unknown, string]>([
    ["repeats a deposit", withCredits([credit(3), credit(3)]), "the proof lists an unconfirmed deposit twice"],
    ["is another account's", withCredits([credit(3, OTHER)]), "the proof names more than one account"],
    ["is the house's", withCredits([credit(3, null)]), "an unconfirmed deposit is the house's, not an account's"],
    ["has no account leaf beside it", { ...(withCredits([credit(3)]) as object), account: null, approvals: [], queued: [], distribution: null, pending_deposits: [] }, "the proof lists unconfirmed deposits for an account it does not include"],
  ])("refuses a credit that %s", (_name, value, message) => {
    expect(() => parseExitProof(value)).toThrow(new ExitProofError(message));
  });
});

describe("registerSteps, for an account with credits", () => {
  const record = { ...recordAt(100), proof: parseExitProof(withCredits([credit(3), credit(4)])) };
  const kinds = (claims: typeof NO_CLAIMS) => registerSteps(record, claims).filter((step) => step.kind === "account" || step.kind === "credits");

  it("lists the credits right after the account's equity, whose amount includes them, so the press counts every transaction", () => {
    expect(kinds(NO_CLAIMS)).toEqual([
      { kind: "account", proof: record.proof.account, amount: 5_010_000_000n, withCredits: true },
      { kind: "credits", account: ACCOUNT, proofs: record.proof.unfinalised_credits, part: 1, parts: 1, amount: null },
    ]);
  });

  it("lists the credits not yet counted once the equity is registered, while the claim holds more than has come to it", () => {
    expect(kinds({ ...NO_CLAIMS, accountRegistered: true, accountClaimed: 5_000_000_000n, creditsCounted: [3] })).toEqual([
      { kind: "credits", account: ACCOUNT, proofs: [record.proof.unfinalised_credits[1]], part: 1, parts: 1, amount: 10_000_000n },
    ]);
  });

  it("leaves out a credit the vault's records do not match, which adds nothing", () => {
    expect(kinds({ ...NO_CLAIMS, creditsUnmatched: [3] }).flatMap((step) => (step.kind === "credits" ? step.proofs.map((held) => held.deposit.deposit_id) : []))).toEqual([4]);
    expect(kinds({ ...NO_CLAIMS, creditsUnmatched: [3, 4] })).toEqual([{ kind: "account", proof: record.proof.account, amount: 5_010_000_000n, withCredits: false }]);
  });

  it("leaves them out once counted, or when they would add nothing", () => {
    expect(kinds({ ...NO_CLAIMS, accountRegistered: true, accountClaimed: 5_000_000_000n, creditsCounted: [3, 4] })).toEqual([]);
    expect(kinds({ ...NO_CLAIMS, accountRegistered: true, accountClaimed: 5_010_000_000n })).toEqual([]);
  });

  it("splits them into batches the vault takes in one transaction each", () => {
    const many = { ...record, proof: parseExitProof(withCredits(Array.from({ length: CREDITS_PER_STEP + 1 }, (_, id) => credit(id + 10)))) };
    const batches = registerSteps(many, NO_CLAIMS).flatMap((step) => (step.kind === "credits" ? [[step.part, step.parts, step.proofs.length]] : []));
    expect(batches).toEqual([[1, 2, CREDITS_PER_STEP], [2, 2, 1]]);
  });

  it("names the steps for the trader", () => {
    const [account, credits] = kinds(NO_CLAIMS);
    if (account === undefined || credits === undefined) throw new Error("both steps are listed");
    expect([stepKey(account), stepLabel(account)]).toEqual(["account", "Balance and positions, including unconfirmed deposits: 5,010 USDC"]);
    expect([stepKey(credits), stepLabel(credits)]).toEqual(["credits-1", "Unconfirmed deposits"]);
    expect(stepLabel({ kind: "credits", account: ACCOUNT, proofs: [], part: 2, parts: 3, amount: null })).toBe("Unconfirmed deposits, part 2 of 3");
    expect(stepLabel({ kind: "credits", account: ACCOUNT, proofs: [], part: 1, parts: 1, amount: 10_000_000n })).toBe("Unconfirmed deposits: 10 USDC");
    expect(stepLabel({ kind: "credits", account: ACCOUNT, proofs: [], part: 1, parts: 2, amount: 10_000_000n })).toBe("Unconfirmed deposits, part 1 of 2: 10 USDC in all");
  });

  it("keeps a proof whose root holds a credit for the account though its claim is nothing now", () => {
    const bare = { ...record.proof, account: record.proof.account === null ? null : { ...record.proof.account, positions: [] }, approvals: [], queued: [], distribution: null, pending_deposits: [] };
    expect(holdsAnything(bare, 0n, 0n, [])).toBe(true);
    expect(holdsAnything({ ...bare, unfinalised_credits: [] }, 0n, 0n, [])).toBe(false);
  });

  it("counts a proof that drops a credit as holding less, since the verifier would prove it too", () => {
    expect(holdsLess({ ...record.proof, unfinalised_credits: [] }, record.proof)).toBe(true);
    expect(holdsLess(record.proof, record.proof)).toBe(false);
  });
});
