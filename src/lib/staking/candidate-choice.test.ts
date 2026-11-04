/** Tests for where the delegation forms choose a candidate from, whatever the node's state (monkey-trading/console#279). */

import { describe, expect, it } from "vitest";

import { failed, LOADING, ready } from "../monkey/figures";
import { candidateSource, offersTyped, pickedCandidate } from "./candidate-choice";
import { operatorsView } from "./operator-table";
import answer from "./operator-list-answer.json";
import type { OperatorList } from "../engine/staking-reads";

const view = operatorsView(answer as OperatorList);
const held = { view, verifiedAtMs: 1_793_000_000_000 };
const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";

describe("candidateSource", () => {
  it("chooses from the node's list while it is read, and waits for the first one while the node may be read", () => {
    expect(candidateSource(ready(view), held, true)).toEqual({ kind: "current" });
    expect(candidateSource(LOADING, null, true)).toEqual({ kind: "loading" });
  });

  it("falls back to the last list verified, saying why, when the node is unverified or its list cannot be read", () => {
    expect(candidateSource(LOADING, held, false)).toEqual({ kind: "held", verifiedAtMs: held.verifiedAtMs, block: 269, why: "unverified" });
    expect(candidateSource(failed(new Error("stale"), view), held, true)).toEqual({ kind: "held", verifiedAtMs: held.verifiedAtMs, block: 269, why: "unread" });
    expect(candidateSource({ status: "unavailable", value: null, message: null }, null, true)).toEqual({ kind: "none", why: "unread" });
    expect(candidateSource(LOADING, null, false)).toEqual({ kind: "none", why: "unverified" });
  });
});

describe("offersTyped and pickedCandidate", () => {
  it("offers the address field off the node's list, and while anything typed stays", () => {
    expect(offersTyped({ kind: "current" }, "")).toBe(false);
    expect(offersTyped({ kind: "loading" }, "")).toBe(false);
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
});
