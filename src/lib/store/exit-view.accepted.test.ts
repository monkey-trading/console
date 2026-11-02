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
    expect(text(unchecked)).toMatch(/Saved in this browser: checkpoint 100, posted [^.]* ago\. Your wallet has not checked it against the vault yet\./);
    expect(text(unchecked)).not.toMatch(/It proves|nothing left/);
    expect(text({ ...unchecked, ...acceptedState(recordAt(100)) })).toMatch(/It proves/);
  });
  it("does not take a record the verifier accepted for one that has replaced it", () => {
    expect(text({ ...unchecked, checked: recordAt(100) })).not.toMatch(/It proves/);
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
    expect(view.lines).toContainEqual({ tone: "warn", text: "Deposit 2 is not on the vault as this proof says, so the vault would refuse its refund. The proof stays saved." });
    expect(text(exit)).toMatch(/It proves 5,083 USDC\./);
  });
  it("names each of several", () => {
    expect(text({ ...exit, claims: { ...NO_CLAIMS, mismatched: [2, 3] } })).toMatch(/Deposits 2, 3 are not on the vault as this proof says, so the vault would refuse their refunds\./);
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
