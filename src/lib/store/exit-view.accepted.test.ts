import { beforeEach, describe, expect, it } from "vitest";

import { writeStoredExit } from "../engine/exit-file";
import { acceptedState, ACCOUNT, factsAt, NO_CLAIMS, recordAt } from "../engine/exit-kit";
import { NO_EXIT, type ExitState } from "./exit-state";
import { exitView } from "./exit-view";
import { exitWatchKit } from "./exit-watch-kit";

const WALLET = { address: ACCOUNT };
const OPEN = factsAt(100, { exitStartedAt: 5_000, chainNow: 6_000 });
const text = (exit: ExitState) => exitView(exit, WALLET).lines.map((line) => line.text).join(" ");

describe("exitView, of a saved proof this connection's verifier has not accepted", () => {
  const unchecked = { ...NO_EXIT, vault: OPEN, record: recordAt(100), claims: NO_CLAIMS };

  it("says it is saved and unchecked, and draws nothing from it", () => {
    expect(text(unchecked)).toMatch(/A proof for snapshot 100, which the vault recorded [^.]* ago, is saved in this browser\. Your wallet has not yet checked the proof against the vault\./);
    expect(text(unchecked)).not.toMatch(/The proof covers|nothing left/);
    expect(text({ ...unchecked, ...acceptedState(recordAt(100)) })).toMatch(/The proof covers/);
  });
  it("does not take a record the verifier accepted for one that has replaced it", () => {
    expect(text({ ...unchecked, checked: recordAt(100) })).not.toMatch(/The proof covers/);
    expect(exitView({ ...unchecked, vault: factsAt(200, { exitStartedAt: 5_000, chainNow: 6_000 }), ...acceptedState(recordAt(100)) }, WALLET).refunds).toEqual([]);
  });
  it("offers no registration and no refund from it, but those that need no proof stay", () => {
    expect(exitView(unchecked, WALLET).register).toEqual([]);
    expect(exitView(unchecked, WALLET).refunds).toEqual([]);
    const unheld = { id: 7, amount: 9_000_000n };
    expect(exitView({ ...unchecked, claims: { ...NO_CLAIMS, unheld: [unheld] } }, WALLET).refunds).toEqual([{ kind: "refund-unheld", ...unheld }]);
    expect(exitView({ ...unchecked, claims: { ...NO_CLAIMS, exitClaim: 7n } }, WALLET).registered).toBe(7n);
  });
  it("tells every page once the failure has lasted, and not before", () => {
    const failing = { ...NO_EXIT, vault: factsAt(100), record: recordAt(100), attempt: { kind: "wallet-failed", reason: "no answer" } as const };
    expect(exitView({ ...failing, checkFailures: 4 }, WALLET).notice).toBeNull();
    expect(exitView({ ...failing, checkFailures: 5 }, WALLET).notice).toEqual({ tone: "warn", text: "Your wallet could not check your exit proof against the vault." });
    expect(exitView({ ...failing, ...acceptedState(recordAt(100)), checkFailures: 5 }, WALLET).notice).toBeNull();
    expect(exitView({ ...failing, vault: factsAt(200), checkFailures: 5 }, WALLET).notice).toBeNull();
  });
});

describe("exitView, of a pending deposit the vault's record disagrees with", () => {
  const exit = { ...NO_EXIT, vault: OPEN, ...acceptedState(recordAt(100)), claims: { ...NO_CLAIMS, mismatched: [2] } };
  it("does not offer its refund, says why, and keeps the proof's other figures", () => {
    const view = exitView(exit, WALLET);
    expect(view.refunds).toEqual([]);
    expect(view.lines).toContainEqual({ tone: "warn", text: "Deposit 2 does not match the vault's record of that deposit, so this proof cannot be used to refund it. The proof remains saved." });
    expect(text(exit)).toMatch(/The proof covers 5,083 USDC\./);
  });
  it("names each of several", () => {
    expect(text({ ...exit, claims: { ...NO_CLAIMS, mismatched: [2, 3] } })).toMatch(/Deposits 2, 3 do not match the vault's records of those deposits, so this proof cannot be used to refund them\./);
  });
  it("offers this account's own deposit at that number while claims register, and not once the window has closed", () => {
    const proof = recordAt(100).proof.pending_deposits[0];
    if (proof === undefined) throw new Error("the fixture holds a pending deposit");
    const ours = { ...exit, claims: { ...NO_CLAIMS, mismatched: [2], receiptRefunds: [{ id: 2, amount: 24_000_000n, proof, leafKind: 34 }] } };
    const view = exitView(ours, WALLET);
    expect(view.refunds).toEqual([{ kind: "refund-receipt", id: 2, amount: 24_000_000n, proof, leafKind: 34 }]);
    expect(text(ours)).not.toMatch(/Deposit 2 does not match/);
    expect(exitView({ ...ours, vault: factsAt(100, { exitStartedAt: 5_000, chainNow: 5_000 + 2_592_000 }) }, WALLET).refunds).toEqual([]);
  });
});

describe("exitView, of unconfirmed deposits the vault's records disagree with", () => {
  it("says they do not count towards the claim", () => {
    const exit = { ...NO_EXIT, vault: OPEN, ...acceptedState(recordAt(100)), claims: { ...NO_CLAIMS, creditsUnmatched: [5, 6] } };
    expect(exitView(exit, WALLET).lines).toContainEqual({ tone: "warn", text: "Unconfirmed deposits 5, 6 do not match the vault's records of those deposits, so they do not count towards your claim." });
  });
});

describe("exitView, of a saved proof the vault refused", () => {
  it("says no proof that passes is saved, whatever the node's read came to since", () => {
    expect(exitView({ ...NO_EXIT, vault: factsAt(100), refused: recordAt(100) }, WALLET).lines[0]).toEqual({ tone: "warn", text: "No proof that passes the vault's check is saved in this browser for this account." });
  });
  it("puts why the latest proof failed ahead of the age of the one kept", () => {
    const old = { ...NO_EXIT, vault: factsAt(200, { chainNow: 1_000 + 7_200 }), record: recordAt(100), attempt: { kind: "refused", reason: "the root does not prove it" } as const };
    expect(exitView(old, WALLET).notice?.text).toBe("Your exit proof failed the vault's check. The root does not prove it.");
  });
});

describe("exitView, of a proof the vault refused, once the exit is due or open", () => {
  const refused = { ...NO_EXIT, record: null, attempt: { kind: "refused", reason: "the vault's snapshot does not confirm its exit terms" } as const };
  it("puts why the proof failed ahead of the exit's start and its deadline", () => {
    expect(exitView({ ...refused, vault: factsAt(100, { chainNow: 1_000 + 2_592_000 }) }, WALLET).notice?.text).toBe("Your exit proof failed the vault's check. The vault's snapshot does not confirm its exit terms.");
    expect(exitView({ ...refused, vault: OPEN, claims: NO_CLAIMS }, WALLET).notice).toEqual({ tone: "bad", text: "The vault's exit has started, but your exit proof failed the vault's check. The vault's snapshot does not confirm its exit terms." });
  });
});

describe("the keeper, on a saved proof the wallet could not check", () => {
  let kit: ReturnType<typeof exitWatchKit>;
  const exit = () => kit.store.getSnapshot().exit;
  beforeEach(async () => {
    kit = exitWatchKit();
    writeStoredExit(() => kit.storage, recordAt(100));
    kit.exit.vault = OPEN;
    kit.exit.checkError = new Error("no answer");
    await kit.connect();
    await kit.store.exit.refresh();
  });

  it("keeps it, counts each failed check, and asks the vault about none of its parts", async () => {
    expect(exit().record?.proof.seq).toBe(100);
    expect(exit().checked).toBeNull();
    const failures = exit().checkFailures;
    await kit.store.exit.refresh();
    expect(exit().checkFailures).toBe(failures + 1);
    expect(kit.exit.claimsProofs.every((proof) => proof === null)).toBe(true);
  });
  it("asks about its parts as soon as a check answers, whatever brought the check on", async () => {
    kit.exit.checkError = null;
    await kit.store.exit.keeper.settle();
    expect(exit().checked).toBe(exit().record);
    expect(kit.exit.claimsProofs.at(-1)?.seq).toBe(100);
  });
  it("counts from nothing, with its parts asked about, once a check answers", async () => {
    kit.exit.checkError = null;
    await kit.store.exit.refresh();
    expect(exit().checkFailures).toBe(0);
    expect(exit().checked).toBe(exit().record);
    expect(kit.exit.claimsProofs.at(-1)?.seq).toBe(100);
  });
});
