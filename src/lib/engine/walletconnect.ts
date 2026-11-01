/**
 * A wallet app paired through WalletConnect, as a `WalletConnector`. Every request goes to the wallet
 * over WalletConnect's relay, none to an HTTP RPC; the SDK keeps its keys and sessions in memory, sends
 * no telemetry, and loads only when the user picks WalletConnect or a stored choice reconnects (#82).
 */

import { WALLETCONNECT_RELAY } from "./deploy";
import { ProviderWallet, type Eip1193Provider, type ProviderWalletDeps, type WalletChain } from "./provider-wallet";
import type { Wallet, WalletConnector } from "./wallet";
import { detail, MemoryStorage, sessionScope, type WcModule, type WcProvider, type WcSession } from "./walletconnect-sdk";

export type PairingState =
  | { status: "idle" }
  /** The SDK is loading or reaching the relay; no link yet. */
  | { status: "preparing" }
  /** The `wc:` link a wallet app scans or opens to pair. */
  | { status: "ready"; uri: string };

const IDLE: PairingState = { status: "idle" };
/** WalletConnect's logo, which its licence asks the connect screens to show. */
export const WALLETCONNECT_ICON = "/walletconnect/icon.svg";
const SIGN = "eth_signTypedData_v4";
/** What `ProviderWallet` asks of a wallet: signatures, the vault's transactions, and the chain reads around them. */
const WALLET_METHODS: readonly string[] = [SIGN, "eth_sendTransaction", "eth_call", "eth_getTransactionReceipt"];
const EVENTS = ["accountsChanged", "chainChanged"];
const CLOSED = "You closed the WalletConnect pairing, so no wallet was connected.";
const ENDED = "Your wallet ended the WalletConnect session. Connect it again to continue.";

/** One connect in progress, which `cancel` stops. */
class Attempt {
  /** Rejects once the attempt is cancelled; the connect races it. */
  readonly stopped: Promise<never>;
  private error: Error | null = null;
  private reject: (error: Error) => void = () => undefined;

  constructor() {
    this.stopped = new Promise<never>((_, reject) => {
      this.reject = reject;
    });
  }

  cancel(error: Error): void {
    this.error = error;
    this.reject(error);
  }

  /** Throws once the attempt is cancelled, so a step after an `await` goes no further. */
  check(): void {
    if (this.error !== null) throw this.error;
  }
}

/** A wallet app paired over WalletConnect, as the "WalletConnect" option, with its pairing state for the dialog. */
export class WalletConnectConnector implements WalletConnector {
  readonly options = [{ id: "walletconnect", label: "WalletConnect", detail: "A wallet app on your phone or computer, by QR code or link", icon: WALLETCONNECT_ICON }] as const;
  private state: PairingState = IDLE;
  private readonly listeners = new Set<() => void>();
  private attempt: Attempt | null = null;
  /** The SDK's provider, started on the first use and kept for the page's life, as the SDK keeps its core. */
  private starting: Promise<WcProvider> | null = null;
  private started: WcProvider | null = null;
  /** The topic of the session the last connect returned, until it ends. */
  private live: string | null = null;
  /** The teardown a cancel or disconnect started, resolving to its failure or null; the next connect waits for it. */
  private closing: Promise<unknown> = Promise.resolve(null);
  /** The last request sent over the session; each waits for the one before (see `sessionProvider`). */
  private requests: Promise<unknown> = Promise.resolve();

  /**
   * `app.url` returns the page's origin, which the wallet shows; `load` imports the SDK, which the page
   * loads only when the user picks WalletConnect.
   */
  constructor(
    private readonly app: { projectId: string; url: () => string },
    private readonly chain: WalletChain,
    private readonly deps: ProviderWalletDeps,
    private readonly load: () => Promise<WcModule>,
    /** Told when the wallet app ends the live session, so the console can show it disconnected. */
    private readonly onEnded: () => void = () => undefined,
  ) {}

  /** Calls `listener` whenever the pairing state changes; returns the unsubscribe. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The pairing in progress, for a dialog to show. */
  readonly pairing = (): PairingState => this.state;

  /** Stops the pairing in progress: its connect rejects, and the unanswered pairing and the relay socket close. */
  readonly cancel = (): void => {
    const attempt = this.attempt;
    if (attempt === null) return;
    this.attempt = null;
    this.publish(IDLE);
    attempt.cancel(new Error(CLOSED));
    if (this.started !== null) this.closing = this.close(this.started).then(() => null, (error: unknown) => error);
  };

  /**
   * Pairs with a wallet app and returns its account on the deployment's chain.
   * Error cases:
   * - a pairing is already open, the SDK does not start, or the user closes the pairing
   * - the wallet declines, or approves no account on the deployment's chain that signs typed data
   */
  async connect(): Promise<Wallet> {
    if (this.attempt !== null) throw new Error("A WalletConnect pairing is already open.");
    const attempt = new Attempt();
    this.attempt = attempt;
    this.publish({ status: "preparing" });
    try {
      return await Promise.race([this.pair(attempt), attempt.stopped]);
    } finally {
      if (this.attempt === attempt) {
        this.attempt = null;
        this.publish(IDLE);
      }
    }
  }

  private publish(state: PairingState): void {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }

  /** Starts the SDK, ends any session left from before, pairs, and checks what the wallet approved. */
  private async pair(attempt: Attempt): Promise<Wallet> {
    const closing = this.closing;
    this.closing = Promise.resolve(null);
    const failure = await closing;
    if (failure !== null) throw new Error("WalletConnect could not close the last pairing. Try again.", { cause: failure });
    const provider = await this.provider();
    attempt.check();
    if (provider.session !== undefined) {
      // A session this connector left, because the user disconnected in the console or closed a pairing as the wallet approved it.
      this.live = null;
      await provider.disconnect().catch((cause: unknown) => {
        throw new Error(`WalletConnect could not end the last session: ${detail(cause)}`, { cause });
      });
      attempt.check();
    }
    const onUri = (uri: unknown) => {
      if (this.attempt !== attempt) {
        // A cancelled attempt's proposal, published late, reopened the relay socket: close it again, but
        // never under a newer pairing or a live session, whose link this may be.
        if (this.idle()) this.closing = this.close(provider).then(() => null, (error: unknown) => error);
        return;
      }
      if (typeof uri === "string" && uri.startsWith("wc:")) this.publish({ status: "ready", uri });
      else attempt.cancel(new Error("WalletConnect produced a pairing link the console does not recognise."));
    };
    provider.on("display_uri", onUri);
    let session: WcSession | undefined;
    try {
      session = await provider.connect({ optionalNamespaces: { eip155: { chains: [`eip155:${this.chain.chainId}`], methods: [...WALLET_METHODS], events: [...EVENTS] } } });
    } catch (cause) {
      // A declined or expired pairing leaves nothing to keep the relay socket open for; a cancelled one closed it already.
      if (this.attempt === attempt) await this.close(provider);
      throw new Error(`Your wallet did not connect over WalletConnect: ${detail(cause)}`, { cause });
    } finally {
      provider.off("display_uri", onUri);
    }
    if (this.attempt !== attempt) {
      // The user closed the pairing as the wallet approved it: end that session at once, and close the
      // relay socket unless a newer pairing is using it.
      if (session !== undefined && provider.session?.topic === session.topic) await provider.disconnect();
      if (this.idle()) await provider.client.core.relayer.transportClose();
    }
    attempt.check();
    // The SDK returns no session only when asked to skip pairing, which the connector never does.
    if (session === undefined) throw new Error("WalletConnect returned no session.");
    const { address, methods } = sessionScope(session, this.chain.chainId);
    if (address === null || !methods.has(SIGN)) {
      const refused = `Your wallet did not approve signing on chain ${this.chain.chainId} over WalletConnect, so the console disconnected it.`;
      await provider.disconnect().catch((cause: unknown) => {
        throw new Error(`${refused} WalletConnect could not end the session.`, { cause });
      });
      await provider.client.core.relayer.transportClose();
      throw new Error(refused);
    }
    this.live = session.topic;
    const topic = session.topic;
    const wallet = new ProviderWallet(address, "WalletConnect", this.sessionProvider(provider, topic), this.chain, { ...this.deps, disconnect: () => this.end(provider, topic) });
    wallet.topic = topic; // the console persists it as the connection choice only if it adopts this wallet
    return wallet;
  }

  /**
   * Re-attaches the session a stored choice names (monkey-trading/console#82), returning its
   * wallet, or null when the SDK holds no usable live session for the topic. The SDK keeps its
   * sessions in memory, so after a reload none survives; the caller then runs the pairing dialog.
   * Error cases:
   * - the SDK does not start (the caller may still pair; the failure is the pairing dialog's to report)
   */
  async resume(topic: string): Promise<Wallet | null> {
    const provider = await this.provider();
    const session = provider.session;
    if (session === undefined || session.topic !== topic) return null;
    const { address, methods } = sessionScope(session, this.chain.chainId);
    if (address === null || !methods.has(SIGN)) return null;
    this.live = session.topic;
    const wallet = new ProviderWallet(address, "WalletConnect", this.sessionProvider(provider, session.topic), this.chain, { ...this.deps, disconnect: () => this.end(provider, session.topic) });
    wallet.topic = session.topic;
    return wallet;
  }

  /** Whether nothing uses the relay socket now: no pairing open and no live session. */
  private idle(): boolean {
    return this.attempt === null && this.live === null;
  }

  /** The SDK's provider, loaded and started once; a failed start is tried again on the next use. */
  private provider(): Promise<WcProvider> {
    this.starting ??= this.start().catch((cause: unknown) => {
      this.starting = null;
      throw new Error("WalletConnect did not start. Check your connection and try again.", { cause });
    });
    return this.starting;
  }

  /**
   * Starts the SDK as published, unmodified. Its Verify step loads a hidden frame from
   * verify.walletconnect.org on each proposal and request, which the CSP allows, so the wallet can
   * show the console's domain as verified; if the frame does not answer within five seconds, the
   * step goes on without an attestation.
   */
  private async start(): Promise<WcProvider> {
    const { UniversalProvider } = await this.load();
    const provider = await UniversalProvider.init({
      projectId: this.app.projectId,
      relayUrl: WALLETCONNECT_RELAY,
      metadata: { name: "Monkey Trading", description: "The Monkey Trading console", url: this.app.url(), icons: [] },
      storage: new MemoryStorage(),
      telemetryEnabled: false,
      logger: "silent",
    });
    provider.on("session_delete", (payload) => {
      if (typeof payload !== "object" || payload === null || !("topic" in payload) || payload.topic !== this.live) return;
      this.live = null;
      this.onEnded();
    });
    this.started = provider;
    return provider;
  }

  /**
   * Ends session `topic` when the user disconnects in the console, so the wallet app drops it, and
   * closes the relay socket, so the relay sees nothing more from this page until the next connect.
   */
  private async end(provider: WcProvider, topic: string): Promise<void> {
    const ending = this.endSession(provider, topic);
    // The next connect waits for this, so a late close cannot cut the relay socket under a new pairing.
    this.closing = ending.then(() => null, (error: unknown) => error);
    await ending;
  }

  private async endSession(provider: WcProvider, topic: string): Promise<void> {
    try {
      if (this.live === topic && provider.session?.topic === topic) await provider.disconnect();
      // A session the SDK could not end stays marked, so the next connect ends it first.
      if (this.live === topic) this.live = null;
    } finally {
      // Closed even when the wallet ended the session first, so the relay sees nothing more from the page.
      await provider.client.core.relayer.transportClose();
    }
  }

  /** Drops the unanswered pairing and closes the relay socket; the next connect opens it again. */
  private async close(provider: WcProvider): Promise<void> {
    await provider.cleanupPendingPairings({ deletePairings: true });
    await provider.client.core.relayer.transportClose();
  }

  /**
   * The session as an EIP-1193 provider. It answers `eth_chainId` from the session, which is for the
   * deployment's chain and names it on every request, and sends the wallet only the methods the session
   * allows, which the SDK routes over the relay; it refuses the rest rather than let the SDK send them
   * to an HTTP RPC.
   */
  private sessionProvider(provider: WcProvider, topic: string): Eip1193Provider {
    const chain = `eip155:${this.chain.chainId}`;
    return {
      request: async ({ method, params }) => {
        const session = provider.session;
        if (this.live !== topic || session === undefined || session.topic !== topic) throw new Error(ENDED);
        const scope = sessionScope(session, this.chain.chainId);
        if (scope.address === null) throw new Error(`Your wallet's WalletConnect session no longer covers chain ${this.chain.chainId}. Connect it again to continue.`);
        if (method === "eth_chainId") return `0x${this.chain.chainId.toString(16)}`;
        if (!WALLET_METHODS.includes(method)) throw new Error(`The console does not send ${method} over WalletConnect.`);
        if (!scope.methods.has(method)) throw new Error(`Your wallet does not allow ${method} over WalletConnect, and the console sends chain requests only through your wallet.`);
        // One request at a time: the SDK's Verify step keeps one abort timer, so a request that overlaps
        // another is never released while Verify's frame does not answer.
        const sent = this.requests.then(() => provider.request({ method, params }, chain));
        this.requests = sent.then(() => undefined, () => undefined);
        return sent;
      },
    };
  }
}
