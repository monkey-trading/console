/** The browser wallet a page is given (an EIP-1193 provider such as MetaMask's or Rabby's), as a `WalletConnector`. */

import { ProviderWallet, type Eip1193Provider, type ProviderWalletDeps, type WalletChain } from "./provider-wallet";
import type { Wallet, WalletConnector } from "./wallet";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export class InjectedConnector implements WalletConnector {
  readonly options = [{ id: "injected", label: "Browser wallet", detail: "An extension such as MetaMask or Rabby" }] as const;

  /** `provider` returns the page's injected provider, or undefined when there is none. */
  constructor(private readonly provider: () => Eip1193Provider | undefined, private readonly chain: WalletChain, private readonly deps: ProviderWalletDeps) {}

  /**
   * Asks the wallet for its account and puts it on the deployment's chain.
   * Error cases:
   * - the page has no browser wallet, the user declines, or the wallet stays on another chain
   */
  async connect(): Promise<Wallet> {
    const provider = this.provider();
    if (provider === undefined) throw new Error("No browser wallet was found. Install one, such as MetaMask or Rabby, or use WalletConnect.");
    let accounts: unknown;
    try {
      accounts = await provider.request({ method: "eth_requestAccounts" });
    } catch (error) {
      throw new Error("The browser wallet did not share an account.", { cause: error });
    }
    const first: unknown = Array.isArray(accounts) ? accounts[0] : undefined;
    if (typeof first !== "string" || !ADDRESS.test(first)) throw new Error("The browser wallet did not share an account.");
    const wallet = new ProviderWallet(first.toLowerCase(), "Browser wallet", provider, this.chain, this.deps);
    await wallet.ensureChain();
    return wallet;
  }
}
