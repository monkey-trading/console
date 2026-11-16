import { describe, expect, it } from "vitest";

import { acceptedState, ACCOUNT, factsAt, fullProof, NO_CLAIMS, recordAt } from "../engine/exit-kit";
import { NO_EXIT, type ExitState } from "./exit-state";
import { exitUrgent, exitView, stepKey, stepLabel } from "./exit-view";

const WALLET = { address: ACCOUNT };
const text = (exit: ExitState) => exitView(exit, WALLET).lines.map((line) => line.text).join(" ");
const tones = (exit: ExitState) => exitView(exit, WALLET).lines.map((line) => line.tone);
const DUE = 1_000 + 2_592_000;

describe("exitView, before anything goes wrong", () => {
  it("asks for a wallet with none connected, and offers nothing", () => {
    expect(exitView(NO_EXIT, null)).toMatchObject({ lines: [{ tone: "calm", text: "Connect a wallet to see your exit proof." }], canImport: false, notice: null });
  });
  it("says a watched account keeps none", () => {
    expect(exitView(NO_EXIT, { ...WALLET, readOnly: true }).lines[0]?.text).toMatch(/read-only account/);
  });
  it("reads calmly while the vault's first read is out", () => {
    expect(exitView(NO_EXIT, WALLET).lines).toEqual([{ tone: "calm", text: "Checking the vault…" }]);
  });
  it("says there is nothing to prove against before a first checkpoint", () => {
    expect(text({ ...NO_EXIT, vault: factsAt(0, { hasCheckpoint: false, latestRoot: `0x${"0".repeat(64)}` }) })).toMatch(/no snapshot yet/);
  });
  it("says how old a proof at the vault's latest root is, and what it proves, without any warning", () => {
    const view = exitView({ ...NO_EXIT, vault: factsAt(100, { chainNow: 1_300 }), ...acceptedState(recordAt(100)) }, WALLET);
    expect(view.lines).toEqual([{ tone: "calm", text: "Saved in this browser: snapshot 100, posted 5 min ago. It covers 5,083 USDC, and a deposit still pending." }]);
    expect(view.notice).toBeNull();
    expect(view.rebuild).toBeNull();
  });
  it("says a proof holds only a pending deposit when that is all it holds", () => {
    const record = { ...recordAt(100), accountClaim: 0n, distributionOwed: 0n, proof: { ...recordAt(100).proof, approvals: [], queued: [] } };
    expect(text({ ...NO_EXIT, vault: factsAt(100), ...acceptedState(record) })).toMatch(/It covers a deposit still pending\.$/);
  });
  it("stops counting a pending deposit once the vault has refunded it", () => {
    const record = recordAt(100);
    expect(text({ ...NO_EXIT, vault: factsAt(100), ...acceptedState(record), claims: { ...NO_CLAIMS, refunded: [2] } })).toMatch(/It covers 5,083 USDC\.$/);
  });
  it("says a proof has nothing left once all of it is paid or refunded", () => {
    const record = { ...recordAt(100), accountClaim: 0n, distributionOwed: 0n, paidApprovals: [1], proof: { ...recordAt(100).proof, queued: [] } };
    expect(text({ ...NO_EXIT, vault: factsAt(100), ...acceptedState(record), claims: { ...NO_CLAIMS, refunded: [2] } })).toMatch(/It has nothing left to claim\.$/);
  });
  it("is calm about an account with nothing at stake", () => {
    const exit = { ...NO_EXIT, vault: factsAt(100), nothing: true };
    expect(exitView(exit, WALLET).lines).toEqual([{ tone: "calm", text: "Nothing to save: this account has nothing in the vault." }]);
    expect(exitView(exit, WALLET).notice).toBeNull();
  });
  it("is calm before a first proof has been tried", () => {
    expect(exitView({ ...NO_EXIT, vault: factsAt(100) }, WALLET).lines).toEqual([{ tone: "calm", text: "No proof is saved in this browser yet." }]);
  });
  it("says it is updating only while a file is read, and holds its line through the node's reads", () => {
    const exit = { ...NO_EXIT, vault: factsAt(200), record: recordAt(100), attempt: { kind: "node-ahead", nodeSeq: 300 } as const };
    expect(exitView({ ...exit, importing: true }, WALLET).lines).toEqual([{ tone: "calm", text: "Updating your proof to the vault's latest snapshot…" }]);
    expect(exitView({ ...exit, reading: true }, WALLET).lines).toEqual(exitView(exit, WALLET).lines);
  });
});

describe("exitView, when the proof has gone stale", () => {
  const behind = { ...NO_EXIT, vault: factsAt(200, { chainNow: 1_600 }), record: recordAt(100) };
  it("says calmly which checkpoint it is from, while being behind has not lasted", () => {
    expect(exitView(behind, WALLET).lines).toEqual([{ tone: "calm", text: "Saved in this browser: snapshot 100, posted 10 min ago." }]);
  });
  it("leaves the other pages alone for the first hour, then tells them", () => {
    expect(exitView(behind, WALLET).notice).toBeNull();
    const old = { ...behind, vault: factsAt(200, { chainNow: 1_000 + 3_600 }) };
    const warned = { tone: "warn", text: "Your exit proof is 1 h old and behind the vault's latest snapshot." };
    expect(exitView({ ...old, attempt: { kind: "node-failed", reason: "x" } }, WALLET).notice).toEqual(warned);
    expect(exitView({ ...old, missingSince: 1_000 }, WALLET).notice).toEqual(warned);
  });
  it("does not warn over an old proof before the keeper has tried for a newer one", () => {
    const old = { ...behind, vault: factsAt(200, { chainNow: 1_000 + 86_400 }) };
    expect(exitView(old, WALLET).notice).toBeNull();
    expect(exitView({ ...old, reading: true, attempt: { kind: "node-failed", reason: "x" } }, WALLET).notice).toBeNull();
  });
  it.each<[string, ExitState["attempt"], RegExp, string]>([
    ["a failed read", { kind: "node-failed", reason: "timed out" }, /Couldn't get the proof from the server: timed out\. Trying again automatically\./, "calm"],
    ["the node away", { kind: "node-away", reason: "prices aren't updating" }, /Can't get a proof from the server right now: prices aren't updating/, "warn"],
    ["a refused proof", { kind: "refused", reason: "its exit terms do not prove" }, /failed the vault's check, so it wasn't saved: its exit terms do not prove/, "bad"],
    ["a wallet that could not check", { kind: "wallet-failed", reason: "no answer" }, /Your wallet couldn't check the proof: no answer\. Trying again automatically\./, "calm"],
    ["no proof at the node yet", { kind: "no-proof" }, /has no proof to give yet/, "calm"],
    ["the node behind the vault", { kind: "node-behind", nodeSeq: 50 }, /The server is behind the vault: its newest snapshot is 50\. Trying again automatically\./, "calm"],
  ])("says why for %s", (_name, attempt, message, tone) => {
    const view = exitView({ ...behind, attempt }, WALLET);
    expect(view.lines.map((line) => line.text).join(" ")).toMatch(message);
    expect(view.lines.at(-1)?.tone).toBe(tone);
  });
  it("says calmly that a vault read which failed is read again by itself, until it has gone on failing", () => {
    for (const exit of [{ ...behind, vaultProblem: "wrong chain" }, { ...NO_EXIT, vaultProblem: "wrong chain" }]) {
      expect(exitView(exit, WALLET).lines.at(-1)?.text).toMatch(/wrong chain\. Trying again automatically\.$/);
      expect(exitView(exit, WALLET).lines.at(-1)?.tone).toBe("calm");
      expect(exitView({ ...exit, vaultFailures: 5 }, WALLET).lines.at(-1)?.tone).toBe("warn");
    }
  });
  it("says a wallet could not check a proof it still shows as saved, which no action trusts yet", () => {
    const view = exitView({ ...NO_EXIT, vault: factsAt(100), record: recordAt(100), attempt: { kind: "wallet-failed", reason: "no answer" } }, WALLET);
    expect(view.lines.at(-1)).toEqual({ tone: "calm", text: "Your wallet couldn't check the proof: no answer. Trying again automatically." });
  });
  it("says a saved proof the vault refused was removed", () => {
    const view = exitView({ ...NO_EXIT, vault: factsAt(100), attempt: { kind: "saved-refused", reason: "the root does not prove it" } }, WALLET);
    expect(view.lines.at(-1)).toEqual({ tone: "bad", text: "The proof saved in this browser failed the vault's check, so it was removed: the root does not prove it." });
    expect(view.notice?.text).toBe("Your exit proof failed the vault's check.");
  });
  it("is calm when the vault's latest checkpoint is only older than the account's funds", () => {
    const view = exitView({ ...NO_EXIT, vault: factsAt(100), attempt: { kind: "not-covered" } }, WALLET);
    expect(view.lines).toEqual([{ tone: "calm", text: "No proof is saved in this browser for this account." }, { tone: "calm", text: "The vault's latest snapshot is older than this account's current holdings, so the proof comes with the next one." }]);
    expect(view.notice).toBeNull();
  });
  it("tells every page once an account has gone an hour with no proof", () => {
    const missing = { ...NO_EXIT, vault: factsAt(100, { chainNow: 5_000 }), attempt: { kind: "node-ahead", nodeSeq: 200 } as const };
    expect(exitView({ ...missing, missingSince: 5_000 - 3_599 }, WALLET).notice).toBeNull();
    expect(exitView({ ...missing, missingSince: 5_000 - 3_600 }, WALLET).notice?.text).toBe("This browser has no exit proof for the vault's latest snapshot.");
    expect(exitView({ ...missing, missingSince: 5_000 - 3_600, nothing: true }, WALLET).notice).toBeNull();
  });
  it("tells every page when the vault's reads keep failing, and not for one", () => {
    expect(exitView({ ...behind, vaultProblem: "x", vaultFailures: 4 }, WALLET).notice).toBeNull();
    expect(exitView({ ...behind, vaultProblem: "x", vaultFailures: 5 }, WALLET).notice?.text).toBe("Your wallet couldn't reach the vault, so your exit proof may be out of date.");
    expect(exitView({ ...NO_EXIT, vaultProblem: "x", vaultFailures: 5 }, WALLET).notice?.text).toBe("Your wallet couldn't reach the vault, so your exit proof may be out of date.");
  });
  it("says calmly that a node read which failed is read again by itself", () => {
    expect(exitView({ ...behind, attempt: { kind: "node-failed", reason: "x" } }, WALLET).lines.at(-1)).toEqual({ tone: "calm", text: "Couldn't get the proof from the server: x. Trying again automatically." });
    expect(exitView({ ...NO_EXIT, vault: factsAt(100), attempt: { kind: "node-failed", reason: "x" } }, WALLET).lines[0]?.tone).toBe("calm");
  });
  it("tells every page when the node's proof fails the vault's check", () => {
    expect(exitView({ ...behind, attempt: { kind: "refused", reason: "x" } }, WALLET).notice?.text).toBe("Your exit proof failed the vault's check.");
  });
  it("still shows the proof when the vault's read fails, saying it is from the last read", () => {
    expect(text({ ...NO_EXIT, vault: factsAt(100), record: recordAt(100), vaultProblem: "no answer" })).toMatch(/couldn't reach the vault just now, so this shows the last check: no answer/);
  });
  it("says so when the vault cannot be read at all", () => {
    expect(exitView({ ...NO_EXIT, vaultProblem: "wrong chain" }, WALLET).lines).toEqual([{ tone: "calm", text: "Your wallet couldn't reach the vault: wrong chain. Trying again automatically." }]);
  });
});

describe("exitView, when the browser will not keep it", () => {
  it("tells this page to export it, and every other page to look", () => {
    const exit = { ...NO_EXIT, vault: factsAt(100), record: recordAt(100), storageProblem: "the quota is exceeded" };
    const view = exitView(exit, WALLET);
    expect(view.lines.at(-1)).toEqual({ tone: "bad", text: "This browser didn't save your proof: the quota is exceeded. Export it now, or it's lost when you close this page." });
    expect(view.notice?.text).toBe("This browser didn't save your exit proof.");
  });
  it("ends the browser's own sentence once", () => {
    const line = exitView({ ...NO_EXIT, vault: factsAt(100), record: recordAt(100), storageProblem: "The quota has been exceeded." }, WALLET).lines.at(-1);
    expect(line?.text).toBe("This browser didn't save your proof: The quota has been exceeded. Export it now, or it's lost when you close this page.");
  });
  it("says so with no proof to export", () => {
    expect(text({ ...NO_EXIT, vault: factsAt(100), storageProblem: "denied" })).toMatch(/Your proof can't be saved: denied/);
  });
});

describe("exitView, as the vault's exit comes", () => {
  it("offers to start it once it is due, with a proof at the vault's root", () => {
    const view = exitView({ ...NO_EXIT, vault: factsAt(100, { chainNow: DUE }), record: recordAt(100), terms: recordAt(100).proof.terms }, WALLET);
    expect(view.phase).toBe("due");
    expect(view.canStart).toBe(true);
    expect(view.lines[0]?.text).toMatch(/The server hasn't posted a snapshot for 30 d, so anyone can start the vault's exit. Starting it is permanent/);
    expect(view.notice?.text).toBe("The server hasn't posted a snapshot for 30 d, so the vault's exit can now start.");
  });
  it("does not offer to start it with a proof at another root", () => {
    const view = exitView({ ...NO_EXIT, vault: factsAt(200, { chainNow: DUE }), record: recordAt(100) }, WALLET);
    expect(view.canStart).toBe(false);
    expect(view.rebuild).toBe(`engine exit-proof --log <mirrored log> --seq 200 --account ${ACCOUNT}`);
  });

  const open = factsAt(100, { exitStartedAt: 5_000, chainNow: 6_000 });
  it("offers each registration while the window is open, with a proof at the exit's root", () => {
    const view = exitView({ ...NO_EXIT, vault: open, ...acceptedState(recordAt(100)), claims: NO_CLAIMS }, WALLET);
    expect(view.phase).toBe("open");
    expect(view.register.map((step) => step.kind)).toEqual(["account", "approval", "queued", "distribution"]);
    expect(view.refunds.map((step) => step.kind === "refund" && step.proof.deposit.deposit_id)).toEqual([2]);
    expect(view.rebuild).toBeNull();
    expect(view.canClaim).toBe(false);
    expect(view.lines[0]?.tone).toBe("bad");
    expect(view.notice?.text).toMatch(/The vault's exit has started. Register your claim by/);
  });
  it("offers no claim from a proof at another root: it says it is out of date, and how to get a current one", () => {
    const view = exitView({ ...NO_EXIT, vault: factsAt(200, { exitStartedAt: 5_000, chainNow: 6_000 }), record: recordAt(100), claims: NO_CLAIMS }, WALLET);
    expect(view.register).toEqual([]);
    expect(view.refunds).toEqual([]);
    expect(view.canClaim).toBe(false);
    expect(view.lines[1]?.text).toMatch(/Your saved proof is from snapshot 100.*The vault's latest snapshot is 200, so the vault would refuse a claim based on it/);
    expect(view.rebuild).toBe(`engine exit-proof --log <mirrored log> --seq 200 --account ${ACCOUNT}`);
  });
  it("does not send an account with nothing at stake to the offline builder, or interrupt its other pages", () => {
    expect(exitView({ ...NO_EXIT, vault: open, nothing: true }, WALLET).rebuild).toBeNull();
    expect(exitView({ ...NO_EXIT, vault: open, nothing: true }, WALLET).notice).toBeNull();
    expect(exitView({ ...NO_EXIT, vault: factsAt(100, { chainNow: DUE }), nothing: true }, WALLET).notice).toBeNull();
  });
  it("points a cleared browser to the same place", () => {
    const view = exitView({ ...NO_EXIT, vault: open, claims: NO_CLAIMS }, WALLET);
    expect(view.rebuild).toBe(`engine exit-proof --log <mirrored log> --seq 100 --account ${ACCOUNT}`);
    expect(view.register).toEqual([]);
  });
  it("says what is registered, and that it is paid once the window closes", () => {
    const view = exitView({ ...NO_EXIT, vault: open, ...acceptedState(recordAt(100)), claims: { ...NO_CLAIMS, accountRegistered: true, approvalsUsed: [1], queuedRegistered: [95], distributionRegistered: true, exitClaim: 7n, exitDistributionClaim: 1n } }, WALLET);
    expect(view.register).toEqual([]);
    expect(view.registered).toBe(8n);
    expect(view.canClaim).toBe(false);
    expect(view.notice?.text).toMatch(/Your claim is registered. The vault pays it after/);
  });

  const closed = factsAt(100, { exitStartedAt: 5_000, chainNow: 5_000 + 2_592_000 });
  it("offers the claim once the window has closed, and no registration", () => {
    const view = exitView({ ...NO_EXIT, vault: closed, record: recordAt(100), claims: { ...NO_CLAIMS, exitClaim: 7n } }, WALLET);
    expect(view.phase).toBe("closed");
    expect(view.canClaim).toBe(true);
    expect(view.register).toEqual([]);
    expect(view.notice?.text).toMatch(/You can now collect your registered 0.000007 USDC/);
  });
  it("offers to start from exit terms the vault accepted, though the proof gave this account nothing", () => {
    const view = exitView({ ...NO_EXIT, vault: factsAt(100, { chainNow: DUE }), terms: fullProof(100).terms }, WALLET);
    expect(view.canStart).toBe(true);
    expect(exitView({ ...NO_EXIT, vault: factsAt(200, { chainNow: DUE }), terms: fullProof(100).terms }, WALLET).canStart).toBe(false);
  });
  it("promises no next checkpoint once the exit has started", () => {
    const started = factsAt(200, { exitStartedAt: 5_000, chainNow: 6_000 });
    const said = (attempt: ExitState["attempt"]) => exitView({ ...NO_EXIT, vault: started, record: recordAt(100), attempt }, WALLET).lines.map((line) => line.text).join(" ");
    expect(said({ kind: "node-ahead", nodeSeq: 300 })).toMatch(/doesn't have\. The vault takes no more snapshots now\./);
    expect(said({ kind: "node-failed", reason: "x" })).toMatch(/Trying again automatically\./);
    expect(said({ kind: "no-proof" })).toMatch(/The vault takes no more snapshots now\./);
    expect(said({ kind: "not-covered" })).toMatch(/final snapshot is older than this account's current holdings/);
    expect(said({ kind: "node-ahead", nodeSeq: 300 })).not.toMatch(/next snapshot/);
  });
  it("offers a claim with no proof, which it does not need", () => {
    expect(exitView({ ...NO_EXIT, vault: closed, claims: { ...NO_CLAIMS, exitClaim: 7n } }, WALLET).canClaim).toBe(true);
  });
  it("offers a refund of a deposit the root does not hold, with no proof", () => {
    const view = exitView({ ...NO_EXIT, vault: closed, claims: { ...NO_CLAIMS, unheld: [{ id: 7, amount: 9_000_000n }] } }, WALLET);
    expect(view.refunds).toEqual([{ kind: "refund-unheld", id: 7, amount: 9_000_000n }]);
    expect(stepLabel({ kind: "refund-unheld", id: 7, amount: 9_000_000n })).toBe("Deposit 7: 9 USDC back to your wallet");
  });
  it("lets a vault that has never had a checkpoint start its exit, with no proof to send", () => {
    const view = exitView({ ...NO_EXIT, vault: factsAt(0, { hasCheckpoint: false, latestRoot: `0x${"0".repeat(64)}`, chainNow: DUE }) }, WALLET);
    expect(view.phase).toBe("due");
    expect(view.canStart).toBe(true);
    expect(view.rebuild).toBeNull();
    expect(view.lines[0]?.text).toMatch(/every deposit is refunded to the address that paid it/);
  });
  it("offers no claim with nothing registered", () => {
    const view = exitView({ ...NO_EXIT, vault: closed, record: recordAt(100), claims: NO_CLAIMS }, WALLET);
    expect(view.canClaim).toBe(false);
    expect(view.notice).toBeNull();
  });
  it("still offers a refund once the window has closed", () => {
    expect(exitView({ ...NO_EXIT, vault: closed, ...acceptedState(recordAt(100)), claims: NO_CLAIMS }, WALLET).refunds.length).toBe(1);
  });
});

describe("exitUrgent", () => {
  it("leads the page only once the exit can start or has", () => {
    expect(exitUrgent(NO_EXIT)).toBe(false);
    expect(exitUrgent({ ...NO_EXIT, vault: factsAt(100) })).toBe(false);
    expect(exitUrgent({ ...NO_EXIT, vault: factsAt(100, { chainNow: DUE }) })).toBe(true);
    expect(exitUrgent({ ...NO_EXIT, vault: factsAt(100, { exitStartedAt: 5_000 }) })).toBe(true);
  });
});

describe("stepKey", () => {
  it("tells two queued requests of one amount apart", () => {
    const { proof } = recordAt(100);
    const held = proof.queued[0];
    if (held === undefined) throw new Error("the fixture holds a queued request");
    const other = { ...held, queued: { ...held.queued, requested_seq: 96 } };
    expect(stepKey({ kind: "queued", proof: held, amount: 1n })).not.toBe(stepKey({ kind: "queued", proof: other, amount: 1n }));
  });
});

describe("stepLabel", () => {
  it("names each registration with its worth", () => {
    const view = exitView({ ...NO_EXIT, vault: factsAt(100, { exitStartedAt: 5_000, chainNow: 6_000 }), ...acceptedState(recordAt(100)), claims: NO_CLAIMS }, WALLET);
    expect(view.register.map(stepLabel)).toEqual(["Balance and positions: 5,010 USDC", "Withdrawal 1: 50 USDC", "Queued withdrawal: 20 USDC", "Staking distribution: 3 USDC"]);
    expect(view.refunds.map(stepLabel)).toEqual(["Deposit 2: 25 USDC back to 0x709979…79c8"]);
  });
});

describe("tones", () => {
  it("keep the whole panel calm while nothing is wrong", () => {
    expect(tones({ ...NO_EXIT, vault: factsAt(100), ...acceptedState(recordAt(100)) })).toEqual(["calm"]);
  });
});
