/** Tests that the browser wallet and a WalletConnect session tell the console of their own account and chain changes (monkey-trading/console#289). */

import { describe, expect, it } from "vitest";

import { InjectedConnector } from "./injected";
import type { Wallet, WalletChanges } from "./wallet";
import { ACCOUNT, EventfulProvider, StubProvider } from "./wallet-kit";
import { connected, session } from "./walletconnect-kit";

const OTHER = "0x00000000000000000000000000000000000000bb";
const CHAIN = { chainId: 31337, vault: "0x5fbdb2315678afecb367f032d93f642f64180aa3", usdc: null, add: null };

/** Changes as a wallet reports them, recorded in order. */
function recorder() {
  const heard: (["account", Wallet] | ["gone"] | ["chain", number])[] = [];
  const changes: WalletChanges = { account: (next) => void heard.push(["account", next]), gone: () => void heard.push(["gone"]), chain: (id) => void heard.push(["chain", id]) };
  return { heard, changes };
}

describe("the browser wallet's events", () => {
  async function injected() {
    const provider = new EventfulProvider();
    const wallet = await new InjectedConnector(() => provider, CHAIN, { wait: async () => undefined }).connect();
    const { heard, changes } = recorder();
    const stop = wallet.follow?.(changes);
    return { provider, wallet, heard, stop };
  }

  it("reports another account as a switch to a wallet for it that follows in turn, and its own account as nothing", async () => {
    const { provider, heard } = await injected();
    provider.emit("accountsChanged", [ACCOUNT]);
    provider.emit("accountsChanged", [OTHER.toUpperCase().replace("0X", "0x")]);
    expect(heard.map(([kind]) => kind)).toEqual(["account"]);
    const next = heard[0]?.[1] as Wallet;
    expect(next.address).toBe(OTHER);
    expect(next.label).toBe("Browser wallet");
    const after = recorder();
    next.follow?.(after.changes);
    provider.emit("accountsChanged", [ACCOUNT]);
    expect((after.heard[0]?.[1] as Wallet).address).toBe(ACCOUNT);
  });

  it("reports no account as the wallet gone, a chain by its id, and ignores what is not an account or a chain", async () => {
    const { provider, heard } = await injected();
    provider.emit("accountsChanged", ["not an address"]);
    provider.emit("accountsChanged", "0x00000000000000000000000000000000000000bb");
    provider.emit("chainChanged", "nonsense");
    provider.emit("chainChanged", "0x1");
    provider.emit("accountsChanged", []);
    expect(heard).toEqual([["chain", 1], ["gone"]]);
  });

  it("stops listening when told, and follows nothing for a provider without events", async () => {
    const { provider, heard, stop } = await injected();
    expect(provider.heard("accountsChanged")).toBe(1);
    stop?.();
    expect(provider.heard("accountsChanged")).toBe(0);
    expect(provider.heard("chainChanged")).toBe(0);
    provider.emit("accountsChanged", []);
    expect(heard).toEqual([]);
    const plain = await new InjectedConnector(() => new StubProvider(), CHAIN, { wait: async () => undefined }).connect();
    expect(plain.follow).toBeUndefined();
  });
});

describe("a WalletConnect session's events", () => {
  const event = (topic: string, name: string, data: unknown) => ({ id: 1, topic, params: { chainId: "eip155:31337", event: { name, data } } });

  it("reports another account on the chain as a switch over the same session, and a chain change by its id", async () => {
    const { fake, wallet } = await connected();
    const { heard, changes } = recorder();
    wallet.follow?.(changes);
    fake.emit("session_event", event("topic-1", "accountsChanged", [`eip155:31337:${OTHER}`]));
    fake.emit("session_event", event("topic-1", "chainChanged", 1));
    fake.emit("session_event", event("topic-1", "chainChanged", "eip155:10"));
    expect(heard.map(([kind, value]) => (kind === "account" ? [kind, (value as Wallet).address, (value as Wallet).topic] : [kind, value]))).toEqual([["account", OTHER, "topic-1"], ["chain", 1], ["chain", 10]]);
    // The switched wallet ends nothing of the session it shares.
    expect(fake.disconnects).toBe(0);
  });

  it("reads an update's namespaces: another account is a switch, none on the chain is the wallet gone", async () => {
    const { fake, wallet } = await connected();
    const { heard, changes } = recorder();
    wallet.follow?.(changes);
    fake.session = { topic: "topic-1", namespaces: { eip155: { chains: ["eip155:31337"], accounts: [`eip155:31337:${OTHER}`], methods: ["eth_signTypedData_v4"] } } };
    fake.emit("session_update", { topic: "topic-1", params: { namespaces: fake.session.namespaces } });
    fake.session = session("topic-1", undefined, "eip155:1");
    fake.emit("session_update", { topic: "topic-1", params: { namespaces: fake.session.namespaces } });
    expect(heard.map(([kind, value]) => (kind === "account" ? [kind, (value as Wallet).address] : [kind]))).toEqual([["account", OTHER], ["gone"]]);
  });

  it("ignores another session's events, counts an account only on the deployment's chain, and stops when told", async () => {
    const { fake, wallet } = await connected();
    const { heard, changes } = recorder();
    const stop = wallet.follow?.(changes);
    fake.emit("session_event", event("topic-2", "accountsChanged", [`eip155:31337:${OTHER}`]));
    fake.emit("session_update", { topic: "topic-2", params: {} });
    fake.emit("session_event", event("topic-1", "accountsChanged", [`eip155:1:${OTHER}`]));
    expect(heard).toEqual([["gone"]]);
    stop?.();
    fake.emit("session_event", event("topic-1", "chainChanged", 1));
    expect(heard).toEqual([["gone"]]);
  });
});
