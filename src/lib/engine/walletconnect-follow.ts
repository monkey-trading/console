/** How a WalletConnect session's own account and chain events reach the console (monkey-trading/console#289). */

import type { Wallet, WalletChanges } from "./wallet";
import { sessionScope, type WcProvider } from "./walletconnect-sdk";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

const field = (value: unknown, key: string): unknown => (typeof value === "object" && value !== null && key in value ? (value as Record<string, unknown>)[key] : undefined);

/** The address an `accountsChanged` entry names on `chainId`, lowercased: a CAIP-10 account on that chain or a bare address; null for another chain's or anything else. */
function eventAccount(entry: unknown, chainId: number): string | null {
  if (typeof entry !== "string") return null;
  const prefix = `eip155:${chainId}:`;
  const address = entry.startsWith(prefix) ? entry.slice(prefix.length) : entry;
  return ADDRESS.test(address) ? address.toLowerCase() : null;
}

/** A `chainChanged` event's chain: a number, `0x` hex or decimal text, or a CAIP-2 `eip155:<id>`; null for anything else. */
function eventChain(data: unknown): number | null {
  const text = typeof data === "string" && data.startsWith("eip155:") ? data.slice("eip155:".length) : data;
  const id = typeof text === "string" || typeof text === "number" ? Number(text) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Tells `changes` what the wallet app says of session `topic` after `address` connected over it: a
 * `session_update` whose namespaces give another account on the deployment's chain, or none, and a
 * `session_event` of `accountsChanged` or `chainChanged`. Returns the stop.
 */
export function followSession(provider: WcProvider, topic: string, chainId: number, address: string, walletFor: (address: string) => Wallet, changes: WalletChanges): () => void {
  const account = (next: string | null) => {
    if (next === null) changes.gone();
    else if (next !== address) changes.account(walletFor(next));
  };
  const onUpdate = (payload: unknown) => {
    // The SDK has put the update's namespaces on its session before it tells its listeners.
    const session = provider.session;
    if (field(payload, "topic") === topic && session?.topic === topic) account(sessionScope(session, chainId).address);
  };
  const onEvent = (payload: unknown) => {
    if (field(payload, "topic") !== topic) return;
    const event = field(field(payload, "params"), "event");
    const data = field(event, "data");
    const name = field(event, "name");
    if (name === "accountsChanged" && Array.isArray(data)) account(data.map((entry) => eventAccount(entry, chainId)).find((entry) => entry !== null) ?? null);
    const chain = name === "chainChanged" ? eventChain(data) : null;
    if (chain !== null) changes.chain(chain);
  };
  provider.on("session_update", onUpdate);
  provider.on("session_event", onEvent);
  return () => {
    provider.off("session_update", onUpdate);
    provider.off("session_event", onEvent);
  };
}
