/**
 * The ephemeral in-browser key a wallet authorizes once at login (monkey-trading/console#68):
 * the console generates one secp256k1 keypair per connection, the wallet signs the engine's
 * `RegisterSessionKey` typed data over it, and orders and cancels then sign with the key in
 * memory — no wallet prompt per request. The keypair never touches browser storage; it dies
 * with the connection, its registration capped at the engine's 24-hour bound
 * (`engine_core::session_keys::MAX_SESSION_KEY_EXPIRY_MS`).
 */

import { generatePrivateKey, privateKeyToAccount, type LocalAccount } from "viem/accounts";

import type { TypedRequest } from "./eip712";
import type { Address } from "./types";

/** How long one login authorizes the key: the engine's registration cap, less a minute so a clock step cannot pass it. */
export const SESSION_KEY_TTL_MS = 24 * 60 * 60 * 1000 - 60_000;

/** The expiry a registration signed at node time `nowMs` may name. */
export const sessionKeyExpiry = (nowMs: number): number => nowMs + SESSION_KEY_TTL_MS;

/** One generated session keypair and its signatures. */
export class SessionKeySigner {
  private constructor(private readonly account: LocalAccount) {}

  /** A fresh random keypair; the randomness is key material, so it comes from the platform CSPRNG, never the seeded generator. */
  static generate(): SessionKeySigner {
    return new SessionKeySigner(privateKeyToAccount(generatePrivateKey()));
  }

  /** The key's address: what the registration names and the node reads as the signer. */
  get address(): Address {
    return this.account.address;
  }

  /** Signs the engine's typed data with the key; resolves with 65-byte `0x` hex, `v` 27 or 28, as the engine's `recover` reads. */
  sign(typed: TypedRequest): Promise<string> {
    // `TypedRequest` holds exactly the fields viem reads: domain, types, primaryType and message.
    return this.account.signTypedData(typed as unknown as Parameters<typeof this.account.signTypedData>[0]);
  }
}
