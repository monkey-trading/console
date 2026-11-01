/** Tests only: a stub of the WalletConnect SDK's `UniversalProvider` that the test drives as the wallet, and a connector over it. */

import { privateKeyToAccount } from "viem/accounts";

import { cancelTypedData, requestDomain } from "./eip712";
import { WalletConnectConnector, type PairingState } from "./walletconnect";
import type { WcModule, WcOptions, WcProvider, WcSession } from "./walletconnect-sdk";

// Anvil's first development key; its address is mixed case, as wallets report it.
export const signer = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
export const ADDRESS = signer.address;
export const VAULT = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512";
export const USDC = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
export const CHAIN = { chainId: 31337, vault: VAULT, usdc: USDC, add: null };
export const URI = `wc:${"7f3a".repeat(16)}@2?relay-protocol=irn&symKey=${"c0de".repeat(16)}`;
export const ALL = ["eth_signTypedData_v4", "eth_sendTransaction", "eth_call", "eth_getTransactionReceipt"];
export const TYPED = cancelTypedData(requestDomain(31337, VAULT), { account: ADDRESS.toLowerCase(), order_id: 1 }, { nonce: 0, expiresAt: 0 });

/** A session the wallet approved on `chain` for `methods`, keyed as wallets key it. */
export const session = (topic: string, methods = ALL, chain = "eip155:31337"): WcSession => ({ topic, namespaces: { eip155: { chains: [chain], accounts: [`${chain}:${ADDRESS}`], methods } } });

/** A promise the test settles by hand. */
export function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Stands in for the SDK: records what the connector asks of it, and the test plays the wallet's part. */
export class FakeProvider implements WcProvider {
  session: WcSession | undefined = undefined;
  options: WcOptions | null = null;
  readonly connects: unknown[] = [];
  readonly requests: { method: string; params: readonly unknown[] | object | undefined; chain: string }[] = [];
  readonly cleanups: unknown[] = [];
  disconnects = 0;
  closes = 0;
  /** Answers each request in turn, as the wallet would. */
  answers: unknown[] = [];
  pending = deferred<WcSession>();
  called = deferred<void>();
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
  readonly client: WcProvider["client"] = {
    core: {
      relayer: { transportClose: async () => void (this.closes += 1) },
    },
  };

  async connect(params: unknown): Promise<WcSession | undefined> {
    this.connects.push(params);
    this.called.resolve();
    const approved = await this.pending.promise;
    this.session = approved;
    return approved;
  }

  async request(args: { method: string; params?: readonly unknown[] | object }, chain: string): Promise<unknown> {
    this.requests.push({ method: args.method, params: args.params, chain });
    return this.answers.shift();
  }

  async disconnect(): Promise<void> {
    this.disconnects += 1;
    this.session = undefined;
  }

  async cleanupPendingPairings(opts: unknown): Promise<void> {
    this.cleanups.push(opts);
  }

  on(event: string, listener: (payload: unknown) => void): void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
  }

  off(event: string, listener: (payload: unknown) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, payload: unknown): void {
    this.listeners.get(event)?.forEach((listener) => listener(payload));
  }

  /** The wallet ends the session, as the SDK reports a `session_delete`. */
  deleteSession(): void {
    const topic = this.session?.topic;
    this.session = undefined;
    this.emit("session_delete", { id: 1, topic });
  }
}

/** A connector over a fresh fake, the number of SDK loads, and the pairing states it published. */
export function setup(onEnded?: (topic: string) => void) {
  const fake = new FakeProvider();
  const loads = { count: 0 };
  const sdk: WcModule = {
    UniversalProvider: {
      init: async (opts) => {
        fake.options = opts;
        return fake;
      },
    },
  };
  const connector = new WalletConnectConnector({ projectId: "0123456789abcdef0123456789abcdef", url: () => "https://console.example" }, CHAIN, { wait: async () => undefined }, async () => {
    loads.count += 1;
    return sdk;
  }, onEnded);
  const states: PairingState[] = [];
  connector.subscribe(() => states.push(connector.pairing()));
  return { fake, connector, loads, states };
}

/** Pairs a wallet that approves `approved`, showing the link on the way. */
export async function connected(approved = session("topic-1")) {
  const env = setup();
  const connecting = env.connector.connect();
  await env.fake.called.promise;
  env.fake.emit("display_uri", URI);
  env.fake.pending.resolve(approved);
  return { ...env, wallet: await connecting };
}
