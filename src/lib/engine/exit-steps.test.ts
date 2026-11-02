import { describe, expect, it } from "vitest";

import { factsAt, fullProof, NO_CLAIMS, recordAt } from "./exit-kit";
import { claimWindowEnd, exitPhase, holdsLess, provenTotal, refundSteps, registeredTotal, registerSteps } from "./exit-steps";

const DUE = 1_000 + 2_592_000;

describe("exitPhase", () => {
  it.each<[string, Parameters<typeof factsAt>[1], string]>([
    ["a second before the exit period has passed", { chainNow: DUE - 1 }, "none"],
    ["the second it has, as startExit takes it", { chainNow: DUE }, "due"],
    ["a vault with no checkpoint, which startExit takes too and refunds every deposit", { chainNow: DUE, hasCheckpoint: false }, "due"],
    ["started, a second before the window closes", { exitStartedAt: 5_000, chainNow: 5_000 + 2_592_000 - 1 }, "open"],
    ["the second it closes, as _requireClaimWindow refuses it", { exitStartedAt: 5_000, chainNow: 5_000 + 2_592_000 }, "closed"],
  ])("%s", (_name, change, phase) => {
    expect(exitPhase(factsAt(100, change))).toBe(phase);
  });

  it("puts the window's end at the start plus the claim window", () => {
    expect(claimWindowEnd(factsAt(100, { exitStartedAt: 5_000 }))).toBe(5_000 + 2_592_000);
  });
});

describe("registerSteps", () => {
  const record = recordAt(100);

  it("lists every part in the order the vault takes them, with what each is worth", () => {
    expect(registerSteps(record, NO_CLAIMS).map((step) => [step.kind, "amount" in step ? step.amount : null])).toEqual([
      ["account", 5_010_000_000n], ["approval", 50_000_000n], ["queued", 20_000_000n], ["distribution", 3_000_000n],
    ]);
  });

  it("leaves out what the vault's record shows done", () => {
    const left = registerSteps(record, { ...NO_CLAIMS, accountRegistered: true, approvalsUsed: [1], queuedRegistered: [95], distributionRegistered: true });
    expect(left).toEqual([]);
  });

  it("leaves out what would add nothing to the claim", () => {
    const worthless = { ...record, accountClaim: 0n, proof: { ...record.proof, queued: record.proof.queued.map((held) => ({ ...held, queued: { ...held.queued, remaining: "0" } })) } };
    expect(registerSteps(worthless, { ...NO_CLAIMS, distributionPaid: 3_000_000n }).map((step) => step.kind)).toEqual(["approval"]);
  });

  it("names a distribution at what the root entitles it to, less what the vault has paid by now", () => {
    const step = registerSteps(record, { ...NO_CLAIMS, distributionPaid: 1_000_000n }).at(-1);
    expect(step?.kind === "distribution" && step.amount).toBe(2_000_000n);
  });

  it("does not register a pending deposit, which is refunded and not claimed", () => {
    expect(registerSteps(record, NO_CLAIMS).some((step) => step.kind === "refund")).toBe(false);
  });
});

describe("refundSteps", () => {
  it("lists the pending deposits not yet refunded, at what each paid", () => {
    const record = recordAt(100);
    expect(refundSteps(record, NO_CLAIMS).map((step) => step.amount)).toEqual([25_000_000n]);
    expect(refundSteps(record, { ...NO_CLAIMS, refunded: [2] })).toEqual([]);
  });
  it("lists the deposits the root does not hold, which need no proof", () => {
    const unheld = { ...NO_CLAIMS, unheld: [{ id: 7, amount: 9n }] };
    expect(refundSteps(null, unheld)).toEqual([{ kind: "refund-unheld", id: 7, amount: 9n }]);
    expect(refundSteps(recordAt(100), unheld).map((step) => step.kind)).toEqual(["refund", "refund-unheld"]);
  });
});

describe("holdsLess", () => {
  const saved = fullProof(100);
  it("finds nothing wrong with the same parts, or more", () => {
    expect(holdsLess(saved, saved)).toBe(false);
    expect(holdsLess(saved, { ...saved, approvals: [] })).toBe(false);
  });
  it.each<[string, Partial<ReturnType<typeof fullProof>>]>([
    ["the account", { account: null }],
    ["the distribution", { distribution: null }],
    ["an approval", { approvals: [] }],
    ["a queued request", { queued: [] }],
    ["a pending deposit", { pending_deposits: [] }],
  ])("sees a file that leaves out %s", (_name, change) => {
    expect(holdsLess({ ...saved, ...change }, saved)).toBe(true);
  });
});

describe("the totals", () => {
  it("adds what a proof registers, leaving the pending deposits and paid approvals out", () => {
    expect(provenTotal(recordAt(100))).toBe(5_010_000_000n + 50_000_000n + 20_000_000n + 3_000_000n);
    expect(provenTotal({ ...recordAt(100), paidApprovals: [1] })).toBe(5_010_000_000n + 20_000_000n + 3_000_000n);
  });
  it("adds what the vault holds registered", () => {
    expect(registeredTotal({ ...NO_CLAIMS, exitClaim: 7n, exitDistributionClaim: 2n })).toBe(9n);
  });
});
