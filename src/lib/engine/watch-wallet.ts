/** A read-only stand-in for the wallet: it follows one account's public reads and signs nothing. */

import type { Address } from "./types";
import type { Wallet, WalletConnector } from "./wallet";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HINT = "Add ?account=<address> to the page address to watch an account. Connecting a wallet is not available in this build yet.";

export class WatchConnector implements WalletConnector {
  readonly options = [{ id: "watch", label: "Watch an account", detail: "Read-only, from ?account= in the page address" }] as const;

  /** `search` returns the page's query string, such as `?account=0x…`. */
  constructor(private readonly search: () => string) {}

  /** The address the page address names, or null. */
  address(): Address | null {
    const value = new URLSearchParams(this.search()).get("account");
    return value !== null && ADDRESS.test(value) ? value.toLowerCase() : null;
  }

  /**
   * Error cases:
   * - the page address names no valid `account`: rejects with how to add one
   */
  async connect(): Promise<Wallet> {
    const address = this.address();
    if (address === null) throw new Error(HINT);
    return {
      address,
      label: "Read-only",
      readOnly: true,
      sign: async () => {
        throw new Error("This account is read-only: nothing can be signed for it.");
      },
      deposit: async () => {
        throw new Error("This account is read-only: nothing can be deposited for it.");
      },
      claim: async () => {
        throw new Error("This account is read-only: nothing can be claimed for it.");
      },
    };
  }
}
