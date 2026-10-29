/** What the console needs from a browser wallet: connect, sign typed data, and fund the vault. */

import type { Fixed } from "../fixed";
import type { TypedRequest } from "./eip712";
import type { Address, SignedWithdrawal } from "./types";

export interface WalletOption {
  id: string;
  label: string;
  detail: string;
  /** A logo the option must show beside its label, served from the app's own origin. */
  icon?: string;
}

/** The typed data a wallet is asked to sign, as the engine's EIP-712 types define it. */
export interface SignRequest {
  /** A one-line statement of what the signature authorises, shown to the user before the wallet opens. */
  summary: string;
  typed: TypedRequest;
}

export interface Wallet {
  address: Address;
  label: string;
  /** Resolves with a 65-byte signature as `0x` hex, `v` 27 or 28. Rejects when the user declines. */
  sign(request: SignRequest): Promise<string>;
  /** Approves the vault for `amount` USDC if needed, deposits it to this account, and resolves with the deposit's transaction hash. */
  deposit(amount: Fixed): Promise<string>;
  /** Claims a signed withdrawal authorization on the vault and resolves with the transaction hash. */
  claim(withdrawal: SignedWithdrawal): Promise<string>;
  /** Whether the vault has paid this account's payout `nonce`. */
  claimed(nonce: number): Promise<boolean>;
}

export interface WalletConnector {
  options: readonly WalletOption[];
  /** Rejects when the user declines or the option is unknown. */
  connect(optionId: string): Promise<Wallet>;
}
