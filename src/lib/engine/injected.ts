/** The browser wallet a page is given (an EIP-1193 provider such as MetaMask's or Rabby's), as a `WalletConnector`. */

import { ProviderWallet, type Eip1193Provider, type ProviderWalletDeps, type WalletChain } from "./provider-wallet";
import { serialized } from "./serialized-provider";
import type { Wallet, WalletChanges, WalletConnector } from "./wallet";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

type Listener = (payload: unknown) => void;

/** EIP-1193's events, where the provider has them: `on` to listen and `removeListener` to stop. */
interface ProviderEvents {
  on(event: string, listener: Listener): void;
  removeListener(event: string, listener: Listener): void;
}

const hasEvents = (provider: Eip1193Provider): provider is Eip1193Provider & ProviderEvents =>
  "on" in provider && typeof provider.on === "function" && "removeListener" in provider && typeof provider.removeListener === "function";

/** The page's injected provider as the "Browser wallet" option. */
export class InjectedConnector implements WalletConnector {
  readonly options = [{ id: "injected", label: "Browser wallet", detail: "An extension such as MetaMask or Rabby" }] as const;

  /** The queue of the page's provider, kept while the page gives the same provider: every wallet this connector returns, and its own account request, share it. */
  private queued: { raw: Eip1193Provider; asked: Eip1193Provider } | null = null;

  /** `provider` returns the page's injected provider, or undefined when there is none. */
  constructor(private readonly provider: () => Eip1193Provider | undefined, private readonly chain: WalletChain, private readonly deps: ProviderWalletDeps) {}

  /**
   * Asks the wallet for its account and puts it on the deployment's chain.
   * Error cases:
   * - the page has no browser wallet, the user declines, or the wallet stays on another chain
   */
  async connect(): Promise<Wallet> {
    const raw = this.provider();
    if (raw === undefined) throw new Error("No browser wallet was found. Install one, such as MetaMask or Rabby, or use WalletConnect.");
    if (this.queued?.raw !== raw) this.queued = { raw, asked: serialized(raw) };
    const queued = this.queued;
    let accounts: unknown;
    try {
      accounts = await queued.asked.request({ method: "eth_requestAccounts" });
    } catch (error) {
      throw new Error("The browser wallet did not share an account.", { cause: error });
    }
    const first: unknown = Array.isArray(accounts) ? accounts[0] : undefined;
    if (typeof first !== "string" || !ADDRESS.test(first)) throw new Error("The browser wallet did not share an account.");
    const wallet = this.walletFor(queued, first.toLowerCase());
    await wallet.ensureChain();
    return wallet;
  }

  /** The wallet for `address` over the page's provider, following its `accountsChanged` and `chainChanged` when it sends them. */
  private walletFor(queued: { raw: Eip1193Provider; asked: Eip1193Provider }, address: string): ProviderWallet {
    const wallet: ProviderWallet & Pick<Wallet, "follow"> = new ProviderWallet(address, "Browser wallet", queued.asked, this.chain, this.deps);
    const { raw } = queued;
    if (hasEvents(raw)) wallet.follow = (changes) => follow(raw, address, (next) => this.walletFor(queued, next), changes);
    return wallet;
  }
}

/**
 * Tells `changes` what the provider says after connecting: an `accountsChanged` naming another
 * account first is a switch to it, and one naming none is the wallet locked or the site
 * disconnected; a `chainChanged` names the chain the wallet is on. Returns the stop.
 */
function follow(provider: ProviderEvents, address: string, walletFor: (address: string) => Wallet, changes: WalletChanges): () => void {
  const onAccounts: Listener = (accounts) => {
    if (!Array.isArray(accounts)) return;
    if (accounts.length === 0) return changes.gone();
    const first: unknown = accounts[0];
    if (typeof first !== "string" || !ADDRESS.test(first)) return;
    if (first.toLowerCase() !== address) changes.account(walletFor(first.toLowerCase()));
  };
  const onChain: Listener = (chainId) => {
    const id = typeof chainId === "string" || typeof chainId === "number" ? Number(chainId) : NaN;
    if (Number.isSafeInteger(id) && id > 0) changes.chain(id);
  };
  provider.on("accountsChanged", onAccounts);
  provider.on("chainChanged", onChain);
  return () => {
    provider.removeListener("accountsChanged", onAccounts);
    provider.removeListener("chainChanged", onChain);
  };
}
