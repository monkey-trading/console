/** Tests for where the delegation forms choose a candidate from, whatever the node's state (monkey-trading/console#279). */

import { describe, expect, it } from "vitest";

import { failed, LOADING, ready } from "../monkey/figures";
import { candidateSource, nodeBlocked, offersTyped, pickedCandidate } from "./candidate-choice";
import { operatorsView } from "./operator-table";
import answer from "./operator-list-answer.json";
import type { OperatorList } from "../engine/staking-reads";

const view = operatorsView(answer as OperatorList);
const held = { view, verifiedAtMs: 1_793_000_000_000 };
const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";

describe("candidateSource", () => {
  it("chooses from the node's list while it is read, and waits for the first one while the node may be read", () => {
    expect(candidateSource(ready(view), held, null)).toEqual({ kind: "current" });
    expect(candidateSource(LOADING, null, null)).toEqual({ kind: "loading" });
  });

  it("falls back to the last list verified, saying why, when the node is unverified or its list cannot be read", () => {
    expect(candidateSource(LOADING, held, "unverified")).toEqual({ kind: "held", verifiedAtMs: held.verifiedAtMs, block: 269, why: "unverified" });
    expect(candidateSource(failed(new Error("stale"), view), held, null)).toEqual({ kind: "held", verifiedAtMs: held.verifiedAtMs, block: 269, why: "unread" });
    expect(candidateSource({ status: "unavailable", value: null, message: null }, null, null)).toEqual({ kind: "none", why: "unread" });
    expect(candidateSource(LOADING, null, "unverified")).toEqual({ kind: "none", why: "unverified" });
    expect(candidateSource(LOADING, held, null)).toEqual({ kind: "held", verifiedAtMs: held.verifiedAtMs, block: 269, why: "unread" });
    expect(candidateSource(LOADING, held, "clock")).toEqual({ kind: "held", verifiedAtMs: held.verifiedAtMs, block: 269, why: "clock" });
  });

  it("says why the node's answers may not be read: the device clock under that verdict, else that the node is not verified", () => {
    expect(nodeBlocked({ kind: "mock" })).toBeNull();
    expect(nodeBlocked({ kind: "clock", skewMs: 90_000 })).toBe("clock");
    expect(nodeBlocked({ kind: "reverifying" })).toBe("unverified");
    expect(nodeBlocked({ kind: "unverified", reason: "bad quote" })).toBe("unverified");
  });
});

describe("offersTyped and pickedCandidate", () => {
  it("offers the address field off the node's list, and while anything typed stays", () => {
    expect(offersTyped({ kind: "current" }, "")).toBe(false);
    expect(offersTyped({ kind: "loading" }, "")).toBe(true);
    expect(offersTyped({ kind: "none", why: "unverified" }, "")).toBe(true);
    expect(offersTyped({ kind: "current" }, "0xab")).toBe(true);
  });

  it("takes a well-formed typed address, lowercased, over the list's choice, and keeps it once the node's list is back", () => {
    expect(pickedCandidate(` ${B.toUpperCase().replace("0X", "0x")} `, A)).toBe(B);
    expect(pickedCandidate(B, null)).toBe(B);
    expect(pickedCandidate("", A)).toBe(A);
  });

  it("names nothing for typed text that is not an address", () => {
    expect(pickedCandidate("0x12", A)).toBeNull();
  });

  it("names nothing for the zero address or a mixed-case address whose checksum is wrong", () => {
    const mixed = "0x52908400098527886E0F7030069857D2E4169EE7";
    expect(pickedCandidate("0x0000000000000000000000000000000000000000", A)).toBeNull();
    expect(pickedCandidate(mixed.replace("EE7", "Ee7"), A)).toBeNull();
    expect(pickedCandidate(mixed, A)).toBe(mixed.toLowerCase());
    expect(pickedCandidate(mixed.toLowerCase(), A)).toBe(mixed.toLowerCase());
  });

  it("names nothing while nothing is chosen or typed", () => {
    expect(pickedCandidate("", "")).toBeNull();
    expect(pickedCandidate("  ", "")).toBeNull();
  });
});
