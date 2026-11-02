import { beforeEach, describe, expect, it } from "vitest";

import { EngineError } from "../engine/client";
import { ACCOUNT, emptyProof, factsAt, fullProof } from "../engine/exit-kit";
import { exitView } from "./exit-view";
import { exitWatchKit } from "./exit-watch-kit";

describe("ExitKeeper", () => {
  let kit: ReturnType<typeof exitWatchKit>;
  beforeEach(() => { kit = exitWatchKit(); });

  describe("how long a funded account has been without a proof, across page loads", () => {
    const NOW = 10_000;
    const OLDEST = 5_000;
    const heard = (seconds: number) => kit.store.patch({ history: [{ cursor: "90:1", seq: 90, index: 1, ts: NOW * 1000, type: "deposited", account: ACCOUNT, amount: "1" }, { cursor: "90:0", seq: 90, index: 0, ts: seconds * 1000, type: "deposited", account: ACCOUNT, amount: "1" }] as never });
    const notice = () => exitView(kit.store.getSnapshot().exit, { address: ACCOUNT }).notice?.text;
    const WARNED = "This browser holds no exit proof at the vault's latest checkpoint.";
    beforeEach(() => { kit.exit.vault = factsAt(100, { chainNow: NOW }); });

    it("warns at once when the node's answer brought no proof and the account's history goes back an hour", async () => {
      heard(OLDEST);
      kit.client.exitAnswer = fullProof(200);
      await kit.connect();
      expect(kit.store.getSnapshot().exit.attempt).toEqual({ kind: "node-ahead", nodeSeq: 200 });
      expect(kit.store.getSnapshot().exit.missingSince).toBe(OLDEST);
      expect(notice()).toBe(WARNED);
    });
    it("warns when the read failed too", async () => {
      heard(OLDEST);
      kit.client.exitError = new EngineError(0, "The node did not answer.");
      await kit.connect();
      expect(notice()).toBe(WARNED);
    });
    it("leaves a newer account alone for its first hour", async () => {
      heard(NOW - 3_599);
      kit.client.exitAnswer = fullProof(200);
      await kit.connect();
      expect(notice()).toBeUndefined();
    });
    it("leaves a funded account alone while the vault's root only predates its funds", async () => {
      heard(OLDEST);
      kit.client.exitAnswer = emptyProof(100);
      await kit.connect();
      expect(kit.store.getSnapshot().exit.attempt).toEqual({ kind: "not-covered" });
      expect(kit.store.getSnapshot().exit.missingSince).toBe(NOW);
    });
    it("does not date it from the history of an account that shows no funds", async () => {
      heard(OLDEST);
      await kit.attach({ attestation: { kind: "unverified", reason: "The node did not answer." }, stream: "stale", accountRead: true, accountHistory: "read", account: null });
      expect(kit.store.getSnapshot().exit.attempt?.kind).toBe("node-away");
      expect(kit.store.getSnapshot().exit.missingSince).toBe(NOW);
    });
    it("ends once a proof is saved", async () => {
      heard(OLDEST);
      kit.client.exitAnswer = fullProof(200);
      await kit.connect();
      kit.client.exitAnswer = fullProof(300);
      kit.exit.vault = factsAt(300, { chainNow: NOW });
      await kit.store.exit.refresh();
      expect(kit.store.getSnapshot().exit.missingSince).toBeNull();
      expect(notice()).toBeUndefined();
    });
  });
});
