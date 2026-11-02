import { describe, expect, it } from "vitest";

import { acceptedState, ACCOUNT, factsAt, recordAt } from "../engine/exit-kit";
import { BEHIND_NOTICE_SECONDS, NO_EXIT, type ExitState } from "./exit-state";
import { exitView } from "./exit-view";

const WALLET = { address: ACCOUNT };
const POSTED = 1_000;
/** A vault at checkpoint 200, its latest posted `postedFor` seconds ago. */
const vaultAt = (postedFor = 13, seq = 200) => factsAt(seq, { lastCheckpointAt: POSTED, chainNow: POSTED + postedFor });
const AHEAD = { kind: "node-ahead", nodeSeq: 300 } as const;
const view = (exit: ExitState) => exitView(exit, WALLET);
const text = (exit: ExitState) => view(exit).lines.map((line) => line.text).join(" ");
const tones = (exit: ExitState) => view(exit).lines.map((line) => line.tone);
/** A proof accepted in this connection, a checkpoint behind the vault. */
const behind = { ...NO_EXIT, vault: vaultAt(), ...acceptedState(recordAt(100, POSTED - 13)) };

describe("the panel, while checkpoints keep arriving", () => {
  it.each<[string, ExitState]>([
    ["a checkpoint behind the vault", behind],
    ["with the node's answer held for the vault's next", { ...behind, attempt: AHEAD }],
    ["while the node is read", { ...behind, attempt: AHEAD, reading: true }],
    ["with no proof yet, and the node's answer held", { ...NO_EXIT, vault: vaultAt(), attempt: AHEAD }],
  ])("is calm %s, and speaks of no refusal", (_name, exit) => {
    expect(tones(exit).every((tone) => tone === "calm")).toBe(true);
    expect(text(exit)).not.toMatch(/refuse|does not hold/);
    expect(view(exit).notice).toBeNull();
  });
  it("says plainly which checkpoint the proof is from, with what it proves", () => {
    expect(view(behind).lines).toEqual([{ tone: "calm", text: "Saved in this browser: checkpoint 100, posted under a minute ago. It proves 5,083 USDC, and a deposit still pending." }]);
  });
  it("says the same of a proof at the vault's latest as of one a checkpoint behind, so nothing flips as they land", () => {
    const at = { ...NO_EXIT, vault: vaultAt(26, 100), ...acceptedState(recordAt(100, POSTED - 13)) };
    expect(text(at)).toBe(text({ ...behind, attempt: AHEAD }));
  });
  it("draws no figure from a proof no verifier has accepted in this connection", () => {
    expect(text({ ...NO_EXIT, vault: vaultAt(), record: recordAt(100, POSTED - 13) })).toBe("Saved in this browser: checkpoint 100, posted under a minute ago.");
  });
  it("takes no alarm from an old proof the first checkpoint after a quiet spell has only just left behind", () => {
    const quiet = { ...NO_EXIT, vault: vaultAt(), record: recordAt(100, POSTED - 86_400), attempt: AHEAD };
    expect(tones(quiet)).toEqual(["calm"]);
    expect(view(quiet).notice).toBeNull();
  });
});

describe("the panel, once being behind has lasted", () => {
  const lasting = { ...NO_EXIT, vault: vaultAt(), ...acceptedState(recordAt(100, vaultAt().chainNow - BEHIND_NOTICE_SECONDS)), missingSince: vaultAt().chainNow - BEHIND_NOTICE_SECONDS };
  it("warns only from the stated time", () => {
    expect(view({ ...lasting, missingSince: lasting.vault.chainNow - BEHIND_NOTICE_SECONDS + 1 }).lines.map((line) => line.tone)).toEqual(["calm"]);
    expect(view(lasting).lines[0]?.tone).toBe("warn");
  });
  it("says for how long, and what it means", () => {
    expect(text(lasting)).toMatch(/Your saved proof is from checkpoint 100, posted 1 h ago\. It has been behind the vault's latest, checkpoint 200, for over 1 h, so the vault would refuse a claim from it if the operator stopped now\./);
    expect(view(lasting).notice).toEqual({ tone: "warn", text: "Your exit proof is 1 h old, behind the vault's latest checkpoint." });
  });
  it("holds through the node's reads, so it does not flip with them", () => {
    expect(view({ ...lasting, reading: true }).notice).toEqual(view(lasting).notice);
    expect(text({ ...lasting, reading: true })).toBe(text(lasting));
  });
  it("warns when a vault has taken no checkpoint for that long though the node has gone on", () => {
    const stalled = { ...behind, vault: vaultAt(BEHIND_NOTICE_SECONDS), attempt: AHEAD };
    expect(text(stalled)).toMatch(/The node's answer is for checkpoint 300, which the vault does not hold\. It is kept, and saved once the vault reaches it\./);
    expect(view(stalled).lines.map((line) => line.tone)).toEqual(["warn", "warn"]);
    expect(view({ ...stalled, vault: vaultAt(BEHIND_NOTICE_SECONDS - 1) }).lines.map((line) => line.tone)).toEqual(["calm"]);
  });
  it("warns of no proof at all from the same time", () => {
    const none = { ...NO_EXIT, vault: vaultAt(), attempt: AHEAD };
    expect(view({ ...none, missingSince: none.vault.chainNow - BEHIND_NOTICE_SECONDS }).notice?.text).toBe("This browser holds no exit proof at the vault's latest checkpoint.");
    expect(view({ ...none, missingSince: none.vault.chainNow - BEHIND_NOTICE_SECONDS + 1 }).notice).toBeNull();
  });
});

describe("the panel, when the vault takes no more checkpoints", () => {
  const started = factsAt(200, { exitStartedAt: 5_000, chainNow: 6_000 });
  const due = factsAt(200, { chainNow: 1_000 + 2_592_000 });
  it.each<[string, typeof started]>([["once the exit has started", started], ["once the exit is due", due]])("warns at once of a proof not at its root, %s", (_name, vault) => {
    const exit = { ...behind, vault };
    const line = view(exit).lines.find((held) => held.text.startsWith("Your saved proof"));
    expect(line).toEqual({ tone: "warn", text: expect.stringMatching(/The vault's latest is checkpoint 200, so the vault would refuse a claim from it\.$/) });
    expect(view(exit).rebuild).not.toBeNull();
  });
  it("says of the node's answer that nothing more is coming", () => {
    expect(text({ ...behind, vault: started, attempt: AHEAD })).toMatch(/which the vault does not hold\. The vault takes no more checkpoints now\./);
  });
});

describe("failures, which are not the ordinary gap", () => {
  it.each<[string, ExitState["attempt"]]>([
    ["a read that failed", { kind: "node-failed", reason: "x" }],
    ["a wallet that could not check", { kind: "wallet-failed", reason: "x" }],
    ["the node away", { kind: "node-away", reason: "x" }],
    ["a refused proof", { kind: "refused", reason: "x" }],
  ])("still say so at once, for %s", (_name, attempt) => {
    expect(text({ ...behind, attempt })).toMatch(/x\./);
  });
});
