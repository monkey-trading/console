import { beforeEach, describe, expect, it } from "vitest";

import { ACCOUNT, factsAt, fullProof, SCOPE } from "../engine/exit-kit";
import { writeStoredExit } from "../engine/exit-file";
import { parseExitProof } from "../engine/exit-proof";
import { exitView } from "./exit-view";
import { exitWatchKit } from "./exit-watch-kit";

describe("ExitKeeper, with a node behind the vault", () => {
  let kit: ReturnType<typeof exitWatchKit>;
  const exit = () => kit.store.getSnapshot().exit;
  beforeEach(() => {
    kit = exitWatchKit();
    kit.exit.vault = factsAt(100);
    kit.client.exitAnswer = fullProof(50);
  });

  it("says so, and reads once in the settle that heard it", async () => {
    await kit.connect();
    expect(kit.client.exitReads).toBe(1);
    expect(exit().attempt).toEqual({ kind: "node-behind", nodeSeq: 50 });
    expect(exitView(exit(), { address: ACCOUNT }).lines.map((line) => line.text)).toContain("The node is behind the vault: its newest checkpoint is 50. It is read again by itself.");
  });
  it("asks again at each read of the vault, once each, though the vault has not moved", async () => {
    await kit.connect();
    await kit.store.exit.refresh();
    expect(kit.client.exitReads).toBe(2);
    await kit.store.exit.refresh();
    expect(kit.client.exitReads).toBe(3);
  });
  it("takes the proof once the node has caught up, with the vault unmoved", async () => {
    await kit.connect();
    kit.client.exitAnswer = fullProof(100);
    await kit.store.exit.refresh();
    expect(exit().record?.proof.seq).toBe(100);
    expect(exit().attempt).toBeNull();
    await kit.store.exit.refresh();
    expect(kit.client.exitReads).toBe(2); // a root it has answered for is read once
  });
  it("keeps a saved proof at an older root while it waits", async () => {
    writeStoredExit(() => kit.storage, { ...SCOPE, proof: parseExitProof(fullProof(40)), checkpointAt: 900, accountClaim: 1n, distributionOwed: 0n, paidApprovals: [] });
    await kit.connect();
    expect(exit().record?.proof.seq).toBe(40);
    expect(exit().attempt).toEqual({ kind: "node-behind", nodeSeq: 50 });
  });
  it("asks for the new root at once when the answer is older only because the vault moved while it was read", async () => {
    const asked = kit.client.exitProof.bind(kit.client);
    kit.client.exitProof = async () => {
      const answer = await asked();
      kit.exit.vault = factsAt(200);
      kit.client.exitAnswer = fullProof(200);
      return answer;
    };
    kit.client.exitAnswer = fullProof(100);
    const seen: (string | undefined)[] = [];
    kit.store.subscribe(() => seen.push(exit().attempt?.kind));
    await kit.connect();
    expect(kit.client.exitReads).toBe(2);
    expect(exit().record?.proof.seq).toBe(200);
    expect(seen).not.toContain("node-behind"); // nothing here says the node is behind
  });
});
