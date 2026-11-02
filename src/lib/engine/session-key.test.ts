/** Tests for the ephemeral session key: it generates as a valid address and signs typed data it owns. */

import { recoverTypedDataAddress } from "viem";
import { describe, expect, it } from "vitest";

import vectors from "./eip712-vectors.json";
import { registerSessionKeyTypedData, requestDomain } from "./eip712";
import { SESSION_KEY_TTL_MS, sessionKeyExpiry, SessionKeySigner } from "./session-key";

const domain = requestDomain(vectors.chain_id, vectors.vault);

describe("the session key signer", () => {
  it("generates a keypair whose address is a checksummed 20-byte address, not an engine fixture's", () => {
    const key = SessionKeySigner.generate();
    expect(key.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(key.address).not.toBe(vectors.account);
  });

  it("signs the register-session-key typed data so it recovers to the session key, not the account", async () => {
    const key = SessionKeySigner.generate();
    const vector = vectors.requests.find((r) => r.kind === "register_session_key");
    if (!vector) throw new Error("no register vector");
    const body = vector.body as { account: string; session_key: string; expires_at: number };
    // The engine's vector signs sessionKey 0x7099… with the account key; the same structure over
    // this key signed by the key itself must recover to the session key.
    const typed = registerSessionKeyTypedData(domain, body.account, key.address, body.expires_at, { nonce: vector.nonce, expiresAt: vector.expires_at });
    expect(typed.message.sessionKey).toBe(key.address.toLowerCase());
    const signature = await key.sign(typed);
    expect(signature).toMatch(/^0x[0-9a-f]{130}$/);
    const recovered = await recoverTypedDataAddress({ ...(typed as unknown as Parameters<typeof recoverTypedDataAddress>[0]), signature: signature as `0x${string}` });
    expect(recovered.toLowerCase()).toBe(key.address.toLowerCase());
  });

  it("expires within the engine's 24-hour registration cap", () => {
    expect(sessionKeyExpiry(1_792_540_800_000)).toBe(1_792_540_800_000 + SESSION_KEY_TTL_MS);
    expect(SESSION_KEY_TTL_MS).toBeLessThan(24 * 60 * 60 * 1000);
    expect(SESSION_KEY_TTL_MS).toBeGreaterThan(23 * 60 * 60 * 1000);
  });
});
