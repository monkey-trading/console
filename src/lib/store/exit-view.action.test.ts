import { describe, expect, it } from "vitest";

import { acceptedState, ACCOUNT, factsAt, NO_CLAIMS, recordAt } from "../engine/exit-kit";
import { NO_EXIT, type ExitState } from "./exit-state";
import { exitView } from "./exit-view";

const WALLET = { address: ACCOUNT };
const text = (exit: ExitState) => exitView(exit, WALLET).lines.map((line) => line.text).join(" ");

describe("exitView, after an action", () => {
  it("gives no figure from the proof once the vault holds a registration, as registering spends an approval's nonce", () => {
    const record = { ...recordAt(100), paidApprovals: [1], proof: { ...recordAt(100).proof, pending_deposits: [] } };
    expect(text({ ...NO_EXIT, vault: factsAt(100), ...acceptedState(record), claims: { ...NO_CLAIMS, accountRegistered: true, exitClaim: 5n } })).toMatch(/posted [^.]* ago\.$/);
    expect(text({ ...NO_EXIT, vault: factsAt(100), ...acceptedState(recordAt(100)), claims: { ...NO_CLAIMS, exitClaim: 5n } })).toMatch(/ago\. It proves a deposit still pending\.$/);
  });
  it("does not count an approval the vault shows used, once it is paid and nothing is left registered", () => {
    const record = { ...recordAt(100), accountClaim: 0n, distributionOwed: 0n, proof: { ...recordAt(100).proof, queued: [], pending_deposits: [] } };
    expect(text({ ...NO_EXIT, vault: factsAt(100), ...acceptedState(record), claims: { ...NO_CLAIMS, approvalsUsed: [1] } })).toMatch(/It has nothing left to claim\.$/);
  });
  it("says a read that failed even of an account known to hold nothing", () => {
    const exit = { ...NO_EXIT, vault: factsAt(100), nothing: true };
    expect(text({ ...exit, attempt: { kind: "wallet-failed", reason: "no answer" } })).toMatch(/could not check the proof: no answer\. It is checked again by itself\.$/);
    expect(text({ ...exit, attempt: { kind: "node-failed", reason: "no answer" } })).toMatch(/It is read again by itself\.$/);
    expect(text({ ...exit, attempt: { kind: "node-ahead", nodeSeq: 300 } })).not.toMatch(/node-ahead|does not hold/);
  });
  it("tells every page when what the vault holds keeps failing to read", () => {
    const closed = factsAt(100, { exitStartedAt: 5_000, chainNow: 5_000 + 2_592_000 });
    expect(exitView({ ...NO_EXIT, vault: closed, claimsProblem: "x", claimsFailures: 4 }, WALLET).notice).toBeNull();
    expect(exitView({ ...NO_EXIT, vault: closed, claimsProblem: "x", claimsFailures: 5 }, WALLET).notice?.text).toBe("Your wallet could not read what the vault holds for you.");
  });
});
