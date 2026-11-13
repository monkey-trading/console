/** Tests for the lazily loaded session key signer (monkey-trading/console#338). */

import { describe, expect, it, vi } from "vitest";

describe("the session key signer's loader", () => {
  it("refuses a reader that runs before the signer is loaded, rather than reading it as a bad key, and serves it once loaded", async () => {
    vi.resetModules();
    const fresh = await import("./session-key-class");
    expect(() => fresh.sessionKeySigner()).toThrow("The session key signer is not loaded.");
    await fresh.loadSessionKeySigner();
    const signer = fresh.sessionKeySigner().generate();
    expect(signer.address).toMatch(/^0x[0-9a-f]{40}$/i);
    // Loading again changes nothing: the one class stays.
    const first = fresh.sessionKeySigner();
    await fresh.loadSessionKeySigner();
    expect(fresh.sessionKeySigner()).toBe(first);
  });

  it("restores a stored key through the loaded class and reads a bad one as no key", async () => {
    const { saveSessionKey, loadSessionKey } = await import("./session-key-store");
    const { sessionKeySigner } = await import("./session-key-class");
    const signer = sessionKeySigner().generate();
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), keys: () => [...data.keys()] };
    const scope = { chainId: 31337, vault: "0x00000000000000000000000000000000000000aa", account: "0x00000000000000000000000000000000000000bb" };
    saveSessionKey(storage, scope, signer, 2_000_000);
    const found = loadSessionKey(storage, scope, 1_000_000);
    expect(found.kind === "live" && found.signer.address).toBe(signer.address);
  });
});
