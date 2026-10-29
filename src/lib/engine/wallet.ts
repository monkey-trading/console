/** What the console needs from a browser wallet: connect, sign typed data, and fund the vault. */

import type { Fixed } from "../fixed";
import type { Address } from "./types";

export interface WalletOption {
  id: string;
  label: string;
  detail: string;
}

/** The typed data a wallet is asked to sign, as the engine's EIP-712 domain defines the types. */
export interface SignRequest {
  primaryType: "Order" | "Cancel" | "Withdrawal" | "Eligibility";
  /** A one-line statement of what the signature authorises, shown to the user. */
  summary: string;
  message: Record<string, string | number>;
}

export interface Wallet {
  address: Address;
  label: string;
  /** Resolves with a 65-byte signature as `0x` hex. Rejects when the user declines. */
  sign(request: SignRequest): Promise<string>;
  /** Sends a USDC deposit to the vault for this account and resolves with its transaction hash. */
  deposit(amount: Fixed): Promise<string>;
}

export interface WalletConnector {
  options: readonly WalletOption[];
  /** Rejects when the user declines or the option is unknown. */
  connect(optionId: string): Promise<Wallet>;
}
