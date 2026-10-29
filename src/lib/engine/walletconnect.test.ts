/** Tests for the WalletConnect connector, over a stub of the SDK's `UniversalProvider`. */

import { getTypesForEIP712Domain, serializeTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { WALLETCONNECT_RELAY } from "./deploy";
import { cancelTypedData, requestDomain } from "./eip712";
import { settle } from "./test-kit";
import { WalletConnectConnector, type PairingState } from "./walletconnect";
import { MemoryStorage, type WcModule, type WcOptions, type WcProvider, type WcSession } from "./walletconnect-sdk";

// Anvil's first development key; its address is mixed case, as wallets report it.
const signer = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const ADDRESS = signer.address;
const VAULT = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512";
const USDC = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
const CHAIN = { chainId: 31337, vault: VAULT, usdc: USDC, add: null };
const URI = `wc:${"7f3a".repeat(16)}@2?relay-protocol=irn&symKey=${"c0de".repeat(16)}`;
const ALL = ["eth_signTypedData_v4", "eth_sendTransaction", "eth_call", "eth_getTransactionReceipt"];
const TYPED = cancelTypedData(requestDomain(31337, VAULT), { account: ADDRESS.toLowerCase(), order_id: 1 }, { nonce: 0, expiresAt: 0 });

/** A session the wallet approved on `chain` for `methods`, keyed as wallets key it. */
const session = (topic: string, methods = ALL, chain = "eip155:31337"): WcSession => ({ topic, namespaces: { eip155: { chains: [chain], accounts: [`${chain}:${ADDRESS}`], methods } } });

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Stands in for the SDK: records what the connector asks of it, and the test plays the wallet's part. */
class FakeProvider implements WcProvider {
  session: WcSession | undefined = undefined;
  options: WcOptions | null = null;
  readonly connects: unknown[] = [];
  readonly requests: { method: string; params: readonly unknown[] | undefined; chain: string }[] = [];
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

  async request(args: { method: string; params?: readonly unknown[] | undefined }, chain: string): Promise<unknown> {
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
function setup() {
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
  });
  const states: PairingState[] = [];
  connector.subscribe(() => states.push(connector.pairing()));
  return { fake, connector, loads, states };
}

/** Pairs a wallet that approves `approved`, showing the link on the way. */
async function connected(approved = session("topic-1")) {
  const env = setup();
  const connecting = env.connector.connect();
  await env.fake.called.promise;
  env.fake.emit("display_uri", URI);
  env.fake.pending.resolve(approved);
  return { ...env, wallet: await connecting };
}

describe("WalletConnectConnector.connect", () => {
  it("publishes the pairing link, clears it once the wallet approves, and returns a wallet on the session's account, lowercased", async () => {
    const { wallet, states, connector, loads } = await connected();
    expect(states).toEqual([{ status: "preparing" }, { status: "ready", uri: URI }, { status: "idle" }]);
    expect(connector.pairing()).toEqual({ status: "idle" });
    expect(wallet.address).toBe(ADDRESS.toLowerCase());
    expect(wallet.label).toBe("WalletConnect");
    expect(loads.count).toBe(1);
  });

  it("asks for eip155:<chainId> with the methods it signs, sends and reads with, and starts the SDK on the pinned relay with in-memory storage and no telemetry", async () => {
    const { fake } = await connected();
    expect(fake.connects).toEqual([{ optionalNamespaces: { eip155: { chains: ["eip155:31337"], methods: ALL, events: ["accountsChanged", "chainChanged"] } } }]);
    const { storage, ...rest } = fake.options ?? {};
    expect(rest).toEqual({
      projectId: "0123456789abcdef0123456789abcdef",
      relayUrl: WALLETCONNECT_RELAY,
      metadata: { name: "Monkey Trading", description: "The Monkey Trading console", url: "https://console.example", icons: [] },
      telemetryEnabled: false,
      logger: "silent",
    });
    expect(storage).toBeInstanceOf(MemoryStorage);
  });

  it("refuses a session with no account on the deployment's chain, or without typed-data signing, and ends it", async () => {
    for (const approved of [session("t", ALL, "eip155:1"), session("t", ["eth_sendTransaction"])]) {
      const env = setup();
      const connecting = env.connector.connect();
      await env.fake.called.promise;
      env.fake.pending.resolve(approved);
      await expect(connecting).rejects.toThrow("did not approve signing on chain 31337");
      expect([env.fake.disconnects, env.fake.closes]).toEqual([1, 1]);
      expect(env.connector.pairing()).toEqual({ status: "idle" });
    }
  });

  it("refuses a second connect while one is pairing, and a pairing link that is not a wc: link", async () => {
    const { connector, fake } = setup();
    const connecting = connector.connect();
    await expect(connector.connect()).rejects.toThrow("already open");
    await fake.called.promise;
    fake.emit("display_uri", "https://example.com/pair");
    await expect(connecting).rejects.toThrow("pairing link the console does not recognise");
    expect(connector.pairing()).toEqual({ status: "idle" });
  });

  it("reports a wallet that declines the pairing", async () => {
    const { connector, fake } = setup();
    const connecting = connector.connect();
    await fake.called.promise;
    fake.pending.reject({ code: 5000, message: "User rejected." });
    await expect(connecting).rejects.toThrow("Your wallet did not connect over WalletConnect: User rejected.");
    // Nothing is left for the relay socket to carry, so it closes.
    expect([fake.cleanups.length, fake.closes]).toEqual([1, 1]);
  });

  it("reports an SDK that does not load, and loads it again on the next connect", async () => {
    let loads = 0;
    const connector = new WalletConnectConnector({ projectId: "p", url: () => "https://console.example" }, CHAIN, { wait: async () => undefined }, async () => {
      loads += 1;
      throw new Error("chunk failed");
    });
    await expect(connector.connect()).rejects.toThrow("WalletConnect did not start");
    await expect(connector.connect()).rejects.toThrow("WalletConnect did not start");
    expect(loads).toBe(2);
  });
});

describe("WalletConnectConnector.cancel", () => {
  it("rejects the pending connect, clears the link, and drops the pairing and the relay socket before the next connect pairs", async () => {
    const { connector, fake, states, loads } = setup();
    const first = connector.connect();
    await fake.called.promise;
    fake.emit("display_uri", URI);
    connector.cancel();
    await expect(first).rejects.toThrow("You closed the WalletConnect pairing");
    expect(states).toEqual([{ status: "preparing" }, { status: "ready", uri: URI }, { status: "idle" }]);
    // A link the SDK reports after the cancel is not shown.
    fake.emit("display_uri", URI);
    expect(connector.pairing()).toEqual({ status: "idle" });

    fake.called = deferred();
    fake.pending.resolve(session("late"));
    await settle();
    // The session the wallet approved as the user closed the pairing is ended at once, without another connect.
    expect([fake.disconnects, fake.closes]).toEqual([1, 2]);
    fake.pending = deferred();
    const second = connector.connect();
    await fake.called.promise;
    expect(fake.cleanups).toEqual([{ deletePairings: true }]);
    expect(fake.disconnects).toBe(1);
    fake.pending.resolve(session("topic-2"));
    expect((await second).address).toBe(ADDRESS.toLowerCase());
    expect(loads.count).toBe(1);
  });

  it("does nothing when no pairing is open", async () => {
    const { connector, fake, states } = await connected();
    connector.cancel();
    expect(states.at(-1)).toEqual({ status: "idle" });
    expect(fake.cleanups).toEqual([]);
  });
});

describe("the WalletConnect wallet", () => {
  it("signs through the session as eth_signTypedData_v4 on the deployment's chain, answering eth_chainId from the session", async () => {
    const { wallet, fake } = await connected();
    // The engine's typed data is plain JSON; viem reads exactly its fields.
    const signature = await signer.signTypedData(TYPED as unknown as Parameters<typeof signer.signTypedData>[0]);
    fake.answers = [signature];
    expect(await wallet.sign({ summary: "", typed: TYPED })).toBe(signature);
    expect(fake.requests).toEqual([
      // The wallet hashes the domain from the `EIP712Domain` fields the typed data lists.
      { method: "eth_signTypedData_v4", params: [ADDRESS.toLowerCase(), serializeTypedData({ ...TYPED, types: { EIP712Domain: getTypesForEIP712Domain({ domain: TYPED.domain }), ...TYPED.types } } as unknown as Parameters<typeof serializeTypedData>[0])], chain: "eip155:31337" },
    ]);
  });

  it("routes chain reads to the wallet session, and refuses a method the session does not allow rather than send it elsewhere", async () => {
    const { wallet, fake } = await connected(session("topic-1", ["eth_signTypedData_v4", "eth_call"]));
    fake.answers = [`0x${"0".repeat(63)}1`];
    expect(await wallet.claimed(3)).toBe(true);
    // A balance and an allowance of nothing; the approval is not sent, since the session cannot return its receipt.
    fake.answers = [`0x${"f".repeat(64)}`, `0x${"0".repeat(64)}`];
    await expect(wallet.deposit(10_000_000_000n)).rejects.toThrow("could not read transaction receipts, so the console did not ask it to approve the vault: Your wallet does not allow eth_getTransactionReceipt over WalletConnect");
    expect(fake.requests.map((r) => [r.method, r.chain])).toEqual([
      ["eth_call", "eip155:31337"],
      ["eth_call", "eip155:31337"],
      ["eth_call", "eip155:31337"],
    ]);
  });

  it("ends the session once and closes the relay socket on each disconnect, even after the wallet ended it", async () => {
    const { wallet, fake } = await connected();
    await wallet.disconnect?.();
    await wallet.disconnect?.();
    expect([fake.disconnects, fake.closes]).toEqual([1, 2]);
    const ended = await connected();
    ended.fake.deleteSession();
    await ended.wallet.disconnect?.();
    expect([ended.fake.disconnects, ended.fake.closes]).toEqual([0, 1]);
    await expect(wallet.sign({ summary: "", typed: TYPED })).rejects.toThrow("Your wallet ended the WalletConnect session");
  });

  it("closes the relay socket even when ending the session fails, and ends it on a later try", async () => {
    const { wallet, fake } = await connected();
    const disconnect = fake.disconnect.bind(fake);
    fake.disconnect = async () => { throw new Error("offline"); };
    await expect(wallet.disconnect?.()).rejects.toThrow("offline");
    expect(fake.closes).toBe(1);
    fake.disconnect = disconnect;
    await wallet.disconnect?.();
    expect([fake.disconnects, fake.closes]).toEqual([1, 2]);
  });

  it("fails its next request once the wallet ends the session", async () => {
    const { wallet, fake } = await connected();
    fake.deleteSession();
    await expect(wallet.sign({ summary: "", typed: TYPED })).rejects.toThrow("Your wallet ended the WalletConnect session");
    await expect(wallet.claimed(0)).rejects.toThrow("Your wallet ended the WalletConnect session");
    expect(fake.requests).toEqual([]);
  });
});
