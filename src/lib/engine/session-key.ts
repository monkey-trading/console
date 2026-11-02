/**
 * The in-browser key a wallet authorizes once (monkey-trading/console#68, #168): the console
 * generates one secp256k1 keypair, the wallet signs the engine's `RegisterSessionKey` typed data
 * over it, and orders and cancels then sign with the key, no wallet prompt per request. It can never
 * move funds, and its registration is capped at the engine's 24-hour bound
 * (`engine_core::session_keys::MAX_SESSION_KEY_EXPIRY_MS`). `session-key-store.ts` keeps it in
 * `localStorage` until it expires, so a reload is not a new connect.
 */

import { generatePrivateKey, privateKeyToAccount, type LocalAccount } from "viem/accounts";

import type { TypedRequest } from "./eip712";
import type { Address } from "./types";

/** The engine's registration cap (`MAX_SESSION_KEY_EXPIRY_MS`). */
export const MAX_SESSION_KEY_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** The engine's live-key cap (`MAX_SESSION_KEYS_PER_ACCOUNT`); a refusal naming any other maximum is its budget of new keys, which no revocation refills. */
export const MAX_SESSION_KEYS_PER_ACCOUNT = 10;

/** How long one login authorizes the key: the engine's registration cap, less a minute so a clock step cannot pass it. */
export const SESSION_KEY_TTL_MS = MAX_SESSION_KEY_EXPIRY_MS - 60_000;

/** The expiry a registration signed at node time `nowMs` may name. */
export const sessionKeyExpiry = (nowMs: number): number => nowMs + SESSION_KEY_TTL_MS;

/** One session keypair and its signatures. The private key sits in a true private field, so no serialization or inspection of a signer shows it. */
export class SessionKeySigner {
  readonly #privateKey: `0x${string}`;
  private readonly account: LocalAccount;

  private constructor(privateKey: `0x${string}`) {
    this.#privateKey = privateKey;
    this.account = privateKeyToAccount(privateKey);
  }

  /** A fresh random keypair; the randomness is key material, so it comes from the platform CSPRNG, never the seeded generator. */
  static generate(): SessionKeySigner {
    return new SessionKeySigner(generatePrivateKey());
  }

  /**
   * The keypair of a stored private key.
   * Error cases:
   * - the value is not a valid secp256k1 private key
   */
  static fromPrivateKey(privateKey: `0x${string}`): SessionKeySigner {
    return new SessionKeySigner(privateKey);
  }

  /** The key's address: what the registration names and the node reads as the signer. */
  get address(): Address {
    return this.account.address;
  }

  /** The private key, for `session-key-store.ts` to write and nothing else: it never reaches the snapshot, a message or a log. */
  exportPrivateKey(): `0x${string}` {
    return this.#privateKey;
  }

  /** Signs the engine's typed data with the key; resolves with 65-byte `0x` hex, `v` 27 or 28, as the engine's `recover` reads. */
  sign(typed: TypedRequest): Promise<string> {
    // `TypedRequest` holds exactly the fields viem reads: domain, types, primaryType and message.
    return this.account.signTypedData(typed as unknown as Parameters<typeof this.account.signTypedData>[0]);
  }
}
