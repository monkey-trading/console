/** Tests for the persisted wallet connection choice: strict parsing, round-trip, and clearing. */

import { describe, expect, it } from "vitest";

import { clearChoice, loadChoice, saveChoice, WALLET_CHOICE_KEY, type ChoiceStorage } from "./wallet-persist";

/** A ChoiceStorage a test can seed and read back. */
function storage(seed: string | null = null): ChoiceStorage & { readonly held: Map<string, string> } {
  const held = new Map<string, string>();
  if (seed !== null) held.set(WALLET_CHOICE_KEY, seed);
  return {
    held,
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
    removeItem: (key) => void held.delete(key),
  };
}

describe("the persisted wallet choice", () => {
  it("round-trips the injected choice and the WalletConnect topic", () => {
    for (const choice of [{ kind: "injected" as const }, { kind: "walletconnect" as const, topic: "topic-1" }]) {
      const held = storage();
      saveChoice(held, choice);
      expect(loadChoice(held)).toEqual(choice);
    }
  });

  it("reads no choice when none is stored", () => {
    expect(loadChoice(storage())).toBeNull();
  });

  it("ignores a value it did not write, whatever its shape", () => {
    for (const seed of [
      "not json",
      "42",
      '"injected"',
      "[]",
      JSON.stringify({ kind: "unknown" }),
      JSON.stringify({ kind: "walletconnect" }),
      JSON.stringify({ kind: "walletconnect", topic: "" }),
      JSON.stringify({ kind: "walletconnect", topic: "x".repeat(201) }),
    ]) {
      expect(loadChoice(storage(seed))).toBeNull();
    }
  });

  it("clearChoice drops the stored value", () => {
    const held = storage();
    saveChoice(held, { kind: "injected" });
    clearChoice(held);
    expect(loadChoice(held)).toBeNull();
    expect(held.held.has(WALLET_CHOICE_KEY)).toBe(false);
  });

  it("is best-effort: a denied or full storage reads as none and never throws", () => {
    const denied: ChoiceStorage = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    };
    expect(loadChoice(denied)).toBeNull();
    expect(() => saveChoice(denied, { kind: "injected" })).not.toThrow();
    expect(() => clearChoice(denied)).not.toThrow();
  });
});
