/** The part of the WalletConnect SDK the connector uses, the in-memory storage it gives the SDK, and what a session grants. */

/** One namespace of a session, as CAIP-25 defines it. */
interface WcNamespace {
  accounts: readonly string[];
  methods: readonly string[];
  chains?: readonly string[] | undefined;
}

export interface WcSession {
  topic: string;
  namespaces: Readonly<Record<string, WcNamespace>>;
}

type WcEvent = "display_uri" | "session_delete";

/** The part of the SDK's `UniversalProvider` the connector uses. */
export interface WcProvider {
  session?: WcSession | undefined;
  client: {
    core: {
      verify: { register(params: { id: string; decryptedId: string }): Promise<string | undefined> };
      relayer: { transportClose(): Promise<void> };
    };
  };
  connect(params: { optionalNamespaces: Record<string, { chains: string[]; methods: string[]; events: string[] }> }): Promise<WcSession | undefined>;
  /** Routes a method the session approved to the wallet over the relay, and any other to an HTTP RPC. */
  request(args: { method: string; params?: readonly unknown[] | undefined }, chain: string): Promise<unknown>;
  disconnect(): Promise<void>;
  cleanupPendingPairings(opts: { deletePairings: boolean }): Promise<void>;
  on(event: WcEvent, listener: (payload: unknown) => void): void;
  off(event: WcEvent, listener: (payload: unknown) => void): void;
}

export interface WcOptions {
  projectId: string;
  relayUrl: string;
  metadata: { name: string; description: string; url: string; icons: string[] };
  storage: MemoryStorage;
  telemetryEnabled: boolean;
  logger: string;
}

/** The SDK module, `@walletconnect/universal-provider`, as the connector loads it. */
export interface WcModule {
  UniversalProvider: { init(opts: WcOptions): Promise<WcProvider> };
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Key-value storage that lives in memory and ends with the page, so the SDK writes nothing to the browser. */
export class MemoryStorage {
  private readonly items = new Map<string, unknown>();

  async getKeys(): Promise<string[]> {
    return [...this.items.keys()];
  }

  async getEntries<T = unknown>(): Promise<[string, T][]> {
    // The SDK reads back only what it wrote under each key.
    return [...this.items.entries()] as [string, T][];
  }

  async getItem<T = unknown>(key: string): Promise<T | undefined> {
    // As above: a key holds what the SDK wrote under it.
    return this.items.get(key) as T | undefined;
  }

  async setItem<T = unknown>(key: string, value: T): Promise<void> {
    this.items.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.items.delete(key);
  }
}

/** The text of an SDK or wallet error, which may be an `Error` or a JSON-RPC error object. */
export function detail(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) return String(error.message);
  return String(error);
}

/** The first account a session holds on `chainId`, lowercased, and every method it allows there. */
export function sessionScope(session: WcSession, chainId: number): { address: string | null; methods: ReadonlySet<string> } {
  const chain = `eip155:${chainId}`;
  let address: string | null = null;
  const methods = new Set<string>();
  for (const [key, namespace] of Object.entries(session.namespaces)) {
    const accounts = namespace.accounts.filter((account) => account.startsWith(`${chain}:`)).map((account) => account.slice(chain.length + 1));
    if (key !== chain && !(namespace.chains ?? []).includes(chain) && accounts.length === 0) continue;
    namespace.methods.forEach((method) => methods.add(method));
    address ??= accounts.find((account) => ADDRESS.test(account))?.toLowerCase() ?? null;
  }
  return { address, methods };
}
