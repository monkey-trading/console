import { describe, expect, it } from "vitest";

import { acceptedState, ACCOUNT, factsAt, fullProof, NO_CLAIMS, recordAt } from "../engine/exit-kit";
import { parseExitProof } from "../engine/exit-proof";
import { NO_EXIT, type ExitState } from "./exit-state";
import { exitView } from "./exit-view";

const WALLET = { address: ACCOUNT };
const OPEN = factsAt(100, { exitStartedAt: 5_000, chainNow: 6_000 });
const CLOSED = factsAt(100, { exitStartedAt: 5_000, chainNow: 5_000 + 2_592_000 });
const notice = (exit: ExitState) => exitView(exit, WALLET).notice?.text ?? null;
const text = (exit: ExitState) => exitView(exit, WALLET).lines.map((line) => line.text).join(" ");

/** A record of `fullProof(100)` with only the parts `keep` names left, as the verifier would read them. */
function recordOf(keep: { pending?: boolean; distribution?: boolean; approvals?: boolean }) {
  const proof = parseExitProof({ ...fullProof(100), account: null, queued: [], approvals: keep.approvals === true ? fullProof(100).approvals : [], distribution: keep.distribution === true ? fullProof(100).distribution : null, pending_deposits: keep.pending === true ? fullProof(100).pending_deposits : [] });
  return { ...recordAt(100), proof, accountClaim: 0n, distributionOwed: keep.distribution === true ? 3_000_000n : 0n };
}

describe("the notice, while the claim window is open", () => {
  const onlyPending = { ...NO_EXIT, vault: OPEN, ...acceptedState(recordOf({ pending: true })), claims: NO_CLAIMS };

  it("does not ask for a registration when nothing can register, and says a refund is waiting instead", () => {
    expect(exitView(onlyPending, WALLET).register).toEqual([]);
    expect(notice(onlyPending)).toBe("The vault can refund a deposit of yours.");
  });
  it("says nothing with nothing to register and no refund", () => {
    expect(notice({ ...onlyPending, claims: { ...NO_CLAIMS, refunded: [2] } })).toBeNull();
    const empty = { ...NO_EXIT, vault: OPEN, ...acceptedState({ ...recordAt(100), accountClaim: 0n, distributionOwed: 0n, proof: { ...recordOf({}).proof, account: fullProof(100).account } }), claims: NO_CLAIMS };
    expect(notice(empty)).toBeNull();
  });
  it("counts several refunds", () => {
    expect(notice({ ...onlyPending, claims: { ...NO_CLAIMS, unheld: [{ id: 7, amount: 9n }] } })).toBe("The vault can refund 2 deposits of yours.");
  });
  it.each<[string, Partial<ExitState>]>([
    ["with something left to register", { ...acceptedState(recordOf({ approvals: true })), claims: NO_CLAIMS }],
    ["before the vault's record is read", { ...acceptedState(recordOf({})), claims: null }],
    ["with a proof the verifier has not accepted", { record: recordOf({}), claims: NO_CLAIMS }],
    ["with no proof at the exit's root", { claims: NO_CLAIMS }],
  ])("asks for one %s", (_name, change) => {
    expect(notice({ ...NO_EXIT, vault: OPEN, ...change })).toMatch(/^The vault's exit has started\. Register your claim by/);
  });
  it("still says a registered claim is paid later, a refund or not", () => {
    expect(notice({ ...onlyPending, claims: { ...NO_CLAIMS, exitClaim: 7n } })).toMatch(/^Your claim is registered\./);
  });
});

describe("an account known to hold nothing, when the vault lists a refund", () => {
  const unheld = [{ id: 7, amount: 9_000_000n }];
  const nothing = { ...NO_EXIT, vault: OPEN, nothing: true, claims: { ...NO_CLAIMS, unheld } };

  it("does not say it holds nothing", () => {
    expect(text(nothing)).toMatch(/Nothing to save: this account's only holding in the vault is the deposit below, which needs no proof\./);
    expect(text(nothing)).not.toMatch(/holds nothing/);
    expect(text({ ...nothing, claims: { ...NO_CLAIMS, unheld: [...unheld, { id: 8, amount: 1n }] } })).toMatch(/the deposits below, which need no proof\./);
  });
  it("tells every page, in the window and after it", () => {
    expect(notice(nothing)).toBe("The vault can refund a deposit of yours.");
    expect(notice({ ...nothing, vault: CLOSED })).toBe("The vault can refund a deposit of yours.");
  });
  it("offers the refund", () => {
    expect(exitView(nothing, WALLET).refunds).toEqual([{ kind: "refund-unheld", ...unheld[0] }]);
  });
  it("is left alone with no refund listed", () => {
    const quiet = { ...nothing, claims: NO_CLAIMS };
    expect(text(quiet)).toMatch(/Nothing to save: this account holds nothing in the vault\./);
    expect(notice(quiet)).toBeNull();
    expect(notice({ ...quiet, vault: CLOSED })).toBeNull();
  });
});

describe("the notice, once the claim window has closed", () => {
  const accepted = acceptedState(recordOf({ pending: true }));
  it("says the claim can be paid above all", () => {
    expect(notice({ ...NO_EXIT, vault: CLOSED, ...accepted, claims: { ...NO_CLAIMS, exitClaim: 7n } })).toMatch(/can be paid/);
  });
  it("says a refund is waiting with nothing to claim", () => {
    expect(notice({ ...NO_EXIT, vault: CLOSED, ...accepted, claims: NO_CLAIMS })).toBe("The vault can refund a deposit of yours.");
  });
});

describe("a distribution, in the exit", () => {
  const SENTENCE = "A staking distribution is paid only from what client claims leave.";
  it.each<[string, Partial<ExitState>]>([
    ["a proof that holds one owed", { ...acceptedState(recordOf({ distribution: true })), claims: NO_CLAIMS }],
    ["a record that holds one registered, with no proof", { claims: { ...NO_CLAIMS, exitDistributionClaim: 1n } }],
  ])("says it is paid only from what client claims leave, for %s", (_name, change) => {
    expect(exitView({ ...NO_EXIT, vault: OPEN, ...change }, WALLET).lines).toContainEqual({ tone: "calm", text: SENTENCE });
    expect(text({ ...NO_EXIT, vault: CLOSED, ...change })).toContain(SENTENCE);
  });
  it.each<[string, Partial<ExitState>]>([
    ["no distribution", { ...acceptedState(recordOf({ pending: true })), claims: NO_CLAIMS }],
    ["a distribution the vault has paid", { ...acceptedState({ ...recordOf({ distribution: true }), distributionOwed: 0n }), claims: NO_CLAIMS }],
    ["a proof the verifier has not accepted", { record: recordOf({ distribution: true }), claims: NO_CLAIMS }],
  ])("says nothing of it with %s", (_name, change) => {
    expect(text({ ...NO_EXIT, vault: OPEN, ...change })).not.toContain(SENTENCE);
  });
  it("says nothing of it before the exit starts", () => {
    expect(text({ ...NO_EXIT, vault: factsAt(100), ...acceptedState(recordOf({ distribution: true })) })).not.toContain(SENTENCE);
  });
});

describe("a browser that will not keep a proof", () => {
  const denied = "this browser's storage is not available";
  it("tells nobody who holds nothing and has no proof", () => {
    const view = exitView({ ...NO_EXIT, vault: factsAt(100), nothing: true, storageProblem: denied }, WALLET);
    expect(view.notice).toBeNull();
    expect(view.lines.map((line) => line.text).join(" ")).not.toMatch(/cannot be saved|did not keep/);
  });
  it("still tells an account with a proof in the page, though it now holds nothing", () => {
    const view = exitView({ ...NO_EXIT, vault: factsAt(100), nothing: true, record: recordAt(50), storageProblem: denied }, WALLET);
    expect(view.notice?.text).toBe("This browser did not keep your exit proof.");
  });
  it("still tells an account not known to hold nothing, before the vault has answered too", () => {
    expect(notice({ ...NO_EXIT, vault: factsAt(100), storageProblem: denied })).toBe("This browser did not keep your exit proof.");
    expect(notice({ ...NO_EXIT, storageProblem: denied })).toBe("This browser did not keep your exit proof.");
  });
});
