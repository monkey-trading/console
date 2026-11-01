/** What the console needs from a browser wallet: connect, sign typed data, and fund the vault. */

import type { Fixed } from "../fixed";
import type { EntitlementProof } from "./emissions";
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
  /** Set for an account that is only watched: it cannot sign or deposit, so no control offers to. */
  readOnly?: boolean;
  /** Resolves with a 65-byte signature as `0x` hex, `v` 27 or 28. Rejects when the user declines. */
  sign(request: SignRequest): Promise<string>;
  /**
   * Approves the vault for `amount` USDC if needed, deposits it to this account, and resolves with the
   * deposit's transaction hash; `progress` hears what each step waits for.
   */
  deposit(amount: Fixed, progress?: Progress): Promise<string>;
  /** Claims a signed withdrawal authorization on the vault and resolves with the transaction hash; `progress` as for `deposit`. */
  claim(withdrawal: SignedWithdrawal, progress?: Progress): Promise<string>;
  /**
   * Claims the account's MONKEY emissions on the vault for what `proof`'s posted root entitles it
   * to, and resolves with the transaction hash; `progress` as for `deposit`.
   */
  claimEmissions?(proof: EntitlementProof, progress?: Progress): Promise<string>;
  /**
   * The vault's own record of this account's MONKEY — what it has minted against the entitlement
   * so far and the seq of its latest posted checkpoint — from the wallet's chain reads. Absent
   * from a wallet that reads no chain, such as a watched account's.
   */
  emissionsClaimed?(): Promise<{ claimed: bigint; latestSeq: number }>;
  /**
   * Offers to add the vault's MONKEY token to the wallet so its balance shows there; resolves true
   * when the wallet added it. Absent from a wallet with no token to suggest, such as the mock's.
   */
  suggestMonkey?(): Promise<boolean>;
  /**
   * Dev-only, live-dev builds: mints `amount` of the deployment's mock USDC to this account through
   * the wallet and resolves with the transaction hash; `progress` as for `deposit`. Absent on
   * wallets with nothing to mint from, such as the mock's own.
   */
  fund?(amount: Fixed, progress?: Progress): Promise<string>;
  /** Whether the vault has paid this account's payout `nonce`; absent from a wallet that reads no chain, such as a watched account's. */
  claimed?(nonce: number): Promise<boolean>;
  /**
   * Offers to add the deployment's USDC token to the wallet so its balance shows there; resolves
   * true when the wallet added it. Absent from a wallet with no token to suggest, such as the mock's.
   */
  suggestUsdc?(): Promise<boolean>;
  /** Ends the wallet's connection, such as a WalletConnect session, when the user disconnects; absent when there is nothing to end. */
  disconnect?(): Promise<void>;
  /** The WalletConnect session topic, when the wallet connects over one: persisted as the connection choice only once the wallet is adopted, never for a connect the console refused. */
  topic?: string;
}

/** Told, as a sentence for the user, what a wallet's transaction waits for: the user's confirmation, then the chain. */
export type Progress = (waitingFor: string) => void;

export interface WalletConnector {
  options: readonly WalletOption[];
  /** Rejects when the user declines or the option is unknown. */
  connect(optionId: string): Promise<Wallet>;
}
