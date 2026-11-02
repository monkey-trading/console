/** Tests for the stored session key: one entry per account, chain and vault, and anything else in storage never trusted. */

import { describe, expect, it } from "vitest";

import { SessionKeySigner } from "./session-key";
import { loadSessionKey, readStoredKey, removeSessionKey, saveSessionKey, sessionKeyName, sweepSessionKeys, type KeyScope } from "./session-key-store";
import { memoryStorage } from "./wallet-kit";

const SCOPE: KeyScope = { account: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", chainId: 31337, vault: "0x5fbdb2315678afecb367f032d93f642f64180aa3" };
const NOW = 1_792_540_800_000;
const DAY = 24 * 60 * 60 * 1000;
const SIGNER = SessionKeySigner.generate();
const entry = (overrides: Record<string, unknown> = {}) => JSON.stringify({ privateKey: SIGNER.exportPrivateKey(), address: SIGNER.address, account: SCOPE.account, chainId: SCOPE.chainId, vault: SCOPE.vault, expiresAt: NOW + 1000, ...overrides });

describe("the stored session key", () => {
  it("round-trips the key and its expiry, and signs as the key it stored", async () => {
    const storage = memoryStorage();
    saveSessionKey(storage, SCOPE, SIGNER, NOW + 1000);
    const found = loadSessionKey(storage, SCOPE, NOW);
    if (found.kind !== "live") throw new Error(`expected a live key, found ${found.kind}`);
    expect(found.expiresAt).toBe(NOW + 1000);
    expect(found.signer.address).toBe(SIGNER.address);
    expect(found.signer.exportPrivateKey()).toBe(SIGNER.exportPrivateKey());
  });

  it("names one entry per account, chain and vault, whatever their case", () => {
    const name = sessionKeyName(SCOPE);
    expect(sessionKeyName({ ...SCOPE, account: SCOPE.account.toUpperCase().replace("0X", "0x") })).toBe(name);
    expect(sessionKeyName({ ...SCOPE, account: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" })).not.toBe(name);
    expect(sessionKeyName({ ...SCOPE, chainId: 1 })).not.toBe(name);
    expect(sessionKeyName({ ...SCOPE, vault: "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512" })).not.toBe(name);
  });

  it("never uses another account's, chain's or vault's key, even under this scope's name", () => {
    for (const other of [{ account: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" }, { chainId: 1 }, { vault: "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512" }]) {
      expect(readStoredKey(entry(other), SCOPE, NOW)).toEqual({ kind: "none" });
    }
  });

  it.each([
    ["nothing", null],
    ["text that is not JSON", "not json"],
    ["JSON that is not an object", "42"],
    ["null", "null"],
    ["a missing private key", entry({ privateKey: undefined })],
    ["a private key of the wrong length", entry({ privateKey: "0x1234" })],
    ["a private key that is not hex", entry({ privateKey: `0x${"zz".repeat(32)}` })],
    ["the zero private key, which is no scalar", entry({ privateKey: `0x${"00".repeat(32)}` })],
    ["a private key past the curve's order", entry({ privateKey: `0x${"ff".repeat(32)}` })],
    ["an address another key derives", entry({ address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" })],
    ["a missing address", entry({ address: undefined })],
    ["a chain id that is text", entry({ chainId: "31337" })],
    ["an expiry that is text", entry({ expiresAt: String(NOW + 1000) })],
    ["an expiry of zero", entry({ expiresAt: 0 })],
    ["a negative expiry", entry({ expiresAt: -1 })],
    ["a fractional expiry", entry({ expiresAt: NOW + 0.5 })],
    ["an expiry past the safe integers", entry({ expiresAt: 2 ** 60 })],
  ])("discards %s and removes the entry", (_name, raw) => {
    const storage = memoryStorage();
    expect(readStoredKey(raw, SCOPE, NOW)).toEqual({ kind: "none" });
    if (raw !== null) storage.setItem(sessionKeyName(SCOPE), raw);
    expect(loadSessionKey(storage, SCOPE, NOW)).toEqual({ kind: "none" });
    expect(storage.held.size).toBe(0);
  });

  it("takes an expiry a lagging clock reads as past the 24-hour cap: a frozen tab keeps a key the node just registered", () => {
    expect(readStoredKey(entry({ expiresAt: NOW + DAY + 60_000 }), SCOPE, NOW).kind).toBe("live");
  });

  it("judges nothing until the clock is known", () => {
    expect(readStoredKey(entry({ expiresAt: 1 }), SCOPE, 0).kind).toBe("live");
  });

  it("calls a key dead at its exact expiry and live a millisecond before, and removes the dead one", () => {
    expect(readStoredKey(entry({ expiresAt: NOW + 1 }), SCOPE, NOW).kind).toBe("live");
    expect(readStoredKey(entry({ expiresAt: NOW }), SCOPE, NOW).kind).toBe("expired");
    const storage = memoryStorage();
    storage.setItem(sessionKeyName(SCOPE), entry({ expiresAt: NOW }));
    expect(loadSessionKey(storage, SCOPE, NOW).kind).toBe("expired");
    expect(storage.held.size).toBe(0);
  });

  it("removes only the named key when told one, so a newer key another tab wrote stays", () => {
    const storage = memoryStorage();
    saveSessionKey(storage, SCOPE, SIGNER, NOW + 1000);
    removeSessionKey(storage, SCOPE, SessionKeySigner.generate().address);
    expect(storage.held.size).toBe(1);
    removeSessionKey(storage, SCOPE, SIGNER.address.toLowerCase());
    expect(storage.held.size).toBe(0);
    saveSessionKey(storage, SCOPE, SIGNER, NOW + 1000);
    removeSessionKey(storage, SCOPE);
    expect(storage.held.size).toBe(0);
  });

  it("sweeps dead and malformed entries of any scope, and leaves live ones and everything else", () => {
    const storage = memoryStorage();
    const live = { ...SCOPE, account: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" };
    saveSessionKey(storage, live, SIGNER, NOW + 1);
    saveSessionKey(storage, SCOPE, SIGNER, NOW);
    storage.setItem(sessionKeyName({ ...SCOPE, chainId: 1 }), "not json");
    storage.setItem("monkeytrading.wallet-choice", "{\"kind\":\"injected\"}");
    sweepSessionKeys(storage, NOW);
    expect([...storage.held.keys()].sort()).toEqual(["monkeytrading.wallet-choice", sessionKeyName(live)].sort());
  });

  it("carries on when storage is denied: reads find nothing, and writes and removals do nothing", () => {
    const denied = { getItem(): string { throw new Error("denied"); }, setItem(): void { throw new Error("denied"); }, removeItem(): void { throw new Error("denied"); }, keys(): string[] { throw new Error("denied"); } };
    expect(loadSessionKey(denied, SCOPE, NOW)).toEqual({ kind: "none" });
    expect(() => saveSessionKey(denied, SCOPE, SIGNER, NOW)).not.toThrow();
    expect(() => removeSessionKey(denied, SCOPE)).not.toThrow();
    expect(() => removeSessionKey(denied, SCOPE, SIGNER.address)).not.toThrow();
    expect(() => sweepSessionKeys(denied, NOW)).not.toThrow();
  });
});
