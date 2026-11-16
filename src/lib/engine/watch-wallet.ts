/** A read-only stand-in for the wallet: it follows one account's public reads and signs nothing. */

import type { Address } from "./types";
import type { Wallet, WalletConnector } from "./wallet";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HINT = "To view an account, add ?account=<address> to the page address. Connecting a wallet isn't available in this version yet.";

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
        throw new Error("This account is read-only, so it can't sign anything.");
      },
      deposit: async () => {
        throw new Error("This account is read-only, so you can't deposit to it.");
      },
      claim: async () => {
        throw new Error("This account is read-only, so you can't claim for it.");
      },
    };
  }
}
