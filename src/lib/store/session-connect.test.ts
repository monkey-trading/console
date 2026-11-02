/** Tests for the session-key login at connect: the credited-account login, the credit-event login, and wallet swaps. */

import { describe, expect, it } from "vitest";

import vectors from "../engine/eip712-vectors.json";
import { registerSessionKeyTypedData, requestDomain } from "../engine/eip712";
import type { SessionKeyRequest } from "../engine/types";
import { ProviderWallet } from "../engine/provider-wallet";
import { ACCOUNT, StubProvider } from "../engine/wallet-kit";
import type { Wallet } from "../engine/wallet";
import { connectWallet } from "./actions";
import { ActionClient, BTC, NODE_TIME, signerOf, VAULT } from "./live-kit";
import { liveSessionKey } from "./session";
import { ConsoleStore } from "./store";
import { settle } from "../engine/test-kit";

const DOMAIN = requestDomain(vectors.chain_id, VAULT);

/** Recovers the signer of one recorded registration, as the node verifies it. */
const recover = async (body: SessionKeyRequest): Promise<string> => {
  const typed = registerSessionKeyTypedData(DOMAIN, body.account, body.session_key, body.expires_at, { nonce: body.auth.nonce, expiresAt: body.auth.expires_at });
  return signerOf(typed, body.auth.signature);
};

/** A started store over an ActionClient that records what it is sent. */
async function setup(credited: boolean) {
  const client = new ActionClient();
  client.credited = credited;
  const provider = new StubProvider();
  const walletA: Wallet = new ProviderWallet(ACCOUNT, "Test wallet", provider, { chainId: vectors.chain_id, vault: VAULT, usdc: null, add: null }, { wait: async () => {} });
  const store = new ConsoleStore({ client, wallets: { options: [], connect: async () => walletA }, history: () => [], initial: { markets: [BTC], house: { cash: "0", nav: "0", gross_exposure: "0" }, startMs: 0 } });
  store.start(0);
  await settle();
  return { client, provider, store, walletA };
}

describe("the session-key login at connect", () => {
  it("runs the login at connect for a credited account, silently when the feed is still starting", async () => {
    const { client, provider, store } = await setup(true);
    await connectWallet(store, "injected");
    const registration = client.posted.find((p) => p.route === "session_key");
    if (!registration) throw new Error("no registration at connect");
    expect(await recover(registration.body as SessionKeyRequest)).toBe(ACCOUNT);
    expect(provider.calls.filter((c) => c.method === "eth_signTypedData_v4")).toHaveLength(1);
    expect(liveSessionKey(store)).not.toBeNull();
  });

  it("runs the login when a deposit credits the account, even though the connect did not", async () => {
    const { client, store } = await setup(false);
    await connectWallet(store, "injected"); // uncredited: no login
    expect(client.posted.some((p) => p.route === "session_key")).toBe(false);
    client.credited = true;
    client.deliver({ offset: "1:0", type: "command", seq: 1, ts: NODE_TIME, cmd: { type: "deposit" }, events: [{ type: "deposited", account: ACCOUNT, amount: "1000" }] });
    await settle();
    expect(client.posted.some((p) => p.route === "session_key")).toBe(true);
  });

  it("clears the session key and refusal when a connect replaces the wallet", async () => {
    const { store } = await setup(true);
    const walletB: Wallet = { address: "0x0000000000000000000000000000000000000bbb", label: "Other", sign: async () => "0x", deposit: async () => "0x0", claim: async () => "0x0" };
    await connectWallet(store, "injected");
    const keyOfA = liveSessionKey(store);
    if (keyOfA === null) throw new Error("no key for wallet A");
    store.deps.wallets.connect = async () => walletB;
    await connectWallet(store, "other"); // B's own login may replace it, but A's key must not survive
    expect(liveSessionKey(store)?.address).not.toBe(keyOfA.address);
    expect(store.sessionLoginRefusal).toBeNull();
    expect(store.getSnapshot().wallet?.address).toBe(walletB.address);
  });

  it("connect skips the login for an account the node has not credited: no prompt, no registration", async () => {
    const client = new ActionClient(); // its account read 404s, as any uncredited account
    const provider = new StubProvider();
    const wallet: Wallet = new ProviderWallet(ACCOUNT, "Test wallet", provider, { chainId: vectors.chain_id, vault: VAULT, usdc: null, add: null }, { wait: async () => {} });
    const store = new ConsoleStore({ client, wallets: { options: [], connect: async () => wallet }, history: () => [], initial: { markets: [BTC], house: { cash: "0", nav: "0", gross_exposure: "0" }, startMs: 0 } });
    store.start(0);
    await settle();
    expect(await connectWallet(store, "injected")).toBe(true);
    expect(client.posted.some((p) => p.route === "session_key")).toBe(false);
    expect(provider.calls.filter((c) => c.method === "eth_signTypedData_v4")).toHaveLength(0);
  });

});
