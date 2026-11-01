/** Tests for the session-key login: the one wallet signature at connect, the silent trading it enables, and the revocation at disconnect. */

import { describe, expect, it } from "vitest";

import { EngineError } from "../engine/client";
import vectors from "../engine/eip712-vectors.json";
import { registerSessionKeyTypedData, requestDomain, revokeSessionKeyTypedData } from "../engine/eip712";
import { SESSION_KEY_TTL_MS, SessionKeySigner } from "../engine/session-key";
import type { EligibilityRequest, OrderRequest, SessionKeyRequest, SessionKeyRevocationRequest } from "../engine/types";
import { ACCOUNT } from "../engine/wallet-kit";
import { fixedFromInt, fixedFromWire } from "../fixed";
import { disconnectWallet, placeOrder, REQUEST_TTL_MS } from "./actions";
import { connected, NODE_TIME, signerOf, VAULT, ActionClient, BTC } from "./live-kit";
import { ProviderWallet } from "../engine/provider-wallet";
import { StubProvider } from "../engine/wallet-kit";
import { attestEligibility, connectWallet } from "./actions";
import { ConsoleStore } from "./store";
import type { Wallet } from "../engine/wallet";
import { liveSessionKey, loginOnCredit, loginSession } from "./session";
import { settle } from "../engine/test-kit";

const DOMAIN = requestDomain(vectors.chain_id, VAULT);
/** The request expiry the tests' canned node time gives every signed request. */
const REQUEST_TTL = REQUEST_TTL_MS;

/** The registration request a client recorded, and the key address it named. */
function registrationOf(client: { posted: { route: string; body: unknown }[] }): SessionKeyRequest {
  const posted = client.posted.find((p) => p.route === "session_key");
  if (!posted) throw new Error("no session-key registration posted");
  return posted.body as SessionKeyRequest;
}

describe("the session-key login", () => {
  it("generates an ephemeral key, asks the wallet for the one registration signature, and keeps the key in memory only", async () => {
    const { client, provider, store } = await connected();
    expect(liveSessionKey(store)).toBeNull();
    expect(await loginSession(store)).toBe(true);
    const request = registrationOf(client);
    const key = store.sessionKey;
    if (key === null) throw new Error("no session key after login");
    expect(request).toMatchObject({ account: ACCOUNT, session_key: key.address, expires_at: NODE_TIME + SESSION_KEY_TTL_MS, auth: { nonce: 4, expires_at: NODE_TIME + REQUEST_TTL } });
    const typed = registerSessionKeyTypedData(DOMAIN, request.account, request.session_key, request.expires_at, { nonce: request.auth.nonce, expiresAt: request.auth.expires_at });
    expect(await signerOf(typed, request.auth.signature)).toBe(ACCOUNT);
    // Exactly one wallet signature, and the keypair sits on the store — never the snapshot.
    expect(provider.calls.filter((c) => c.method === "eth_signTypedData_v4")).toHaveLength(1);
    expect(Object.values(store.getSnapshot()).some((value) => value === key)).toBe(false);
    expect(liveSessionKey(store)).toBe(key);
  });

  it("treats the key as dead once its registration expires by the node's clock", async () => {
    const { store } = await connected();
    await loginSession(store);
    store.patch({ now: NODE_TIME + SESSION_KEY_TTL_MS });
    expect(liveSessionKey(store)).toBeNull();
  });

  it("shows the node's refusal when the registration is refused, and keeps no key", async () => {
    const { client, store } = await connected();
    client.answer = () => ({ seq: 1, events: [{ type: "session_key_rejected", account: ACCOUNT, session_key: "0x0000000000000000000000000000000000000abc", reason: { kind: "session_key_unsupported" } }] });
    expect(await loginSession(store)).toBe(false);
    expect(liveSessionKey(store)).toBeNull(); // the candidate stays for the connection's next attempt; nothing is authorized
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("This node does not support session keys yet.");
  });

  it("treats a never-credited account's refused registration as expected: no key, no error shown", async () => {
    const { client, store } = await connected();
    client.answer = () => { throw new EngineError(403, "account has never been credited"); };
    expect(await loginSession(store)).toBe(false);
    expect(liveSessionKey(store)).toBeNull();
    expect(store.getSnapshot().toasts).toEqual([]);
  });

  it("runs the login when one of the account's events says it is credited", async () => {
    const { provider, store } = await connected(); // connected() already holds the wallet
    expect(liveSessionKey(store)).toBeNull();
    loginOnCredit(store, [{ type: "deposited", account: ACCOUNT, amount: "1000" }], ACCOUNT);
    await settle();
    expect(liveSessionKey(store)).not.toBeNull();
    expect(provider.calls.filter((c) => c.method === "eth_signTypedData_v4")).toHaveLength(1);
    // Already logged in, or the event is not the account's: nothing more is asked.
    loginOnCredit(store, [{ type: "deposited", account: ACCOUNT, amount: "1000" }], ACCOUNT);
    loginOnCredit(store, [{ type: "deposited", account: "0x0000000000000000000000000000000000000abc", amount: "1" }], ACCOUNT);
    await settle();
    expect(provider.calls.filter((c) => c.method === "eth_signTypedData_v4")).toHaveLength(1);
  });

  it("tells the user when they decline the login signature, and keeps no key", async () => {
    const { store } = await connected({ fail: { eth_signTypedData_v4: { code: 4001, message: "User rejected" } } });
    expect(await loginSession(store)).toBe(false);
    expect(liveSessionKey(store)).toBeNull();
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("You declined to sign in your wallet.");
  });

  it("revokes the key with one wallet signature at disconnect, then ends the wallet's session", async () => {
    const { client, provider, store, wallet } = await connected();
    let ended = 0;
    wallet.disconnect = async () => void (ended += 1);
    await loginSession(store);
    const key = store.sessionKey;
    if (key === null) throw new Error("no session key after login");
    disconnectWallet(store);
    await settle();
    expect(store.sessionKey).toBeNull();
    expect(ended).toBe(1);
    const posted = client.posted.find((p) => p.route === "session_key_revoke");
    if (!posted) throw new Error("no revocation posted");
    const revocation = posted.body as SessionKeyRevocationRequest;
    expect(revocation).toMatchObject({ account: ACCOUNT, session_key: key.address });
    const typed = revokeSessionKeyTypedData(DOMAIN, revocation.account, revocation.session_key, { nonce: revocation.auth.nonce, expiresAt: revocation.auth.expires_at });
    expect(await signerOf(typed, revocation.auth.signature)).toBe(ACCOUNT);
    expect(provider.calls.filter((c) => c.method === "eth_signTypedData_v4")).toHaveLength(2);
    expect(store.getSnapshot().toasts.some((t) => t.text === "The trading authorization was not revoked; it expires on its own.")).toBe(false);
  });

  it("skips the revocation prompt when the wallet app already ended the session", async () => {
    const { client, provider, store } = await connected();
    await loginSession(store);
    disconnectWallet(store, false); // as the WalletConnect-ended path does
    await settle();
    expect(client.posted.some((p) => p.route === "session_key_revoke")).toBe(false);
    expect(provider.calls.filter((c) => c.method === "eth_signTypedData_v4")).toHaveLength(1);
  });

  it("revokes best effort: a declined revocation still disconnects, and says the key expires on its own", async () => {
    const { client, store, wallet } = await connected();
    let ended = 0;
    wallet.disconnect = async () => void (ended += 1);
    await loginSession(store);
    // The wallet now declines: only the revocation's signature is left to ask for.
    wallet.sign = async () => { throw new Error("You declined to sign in your wallet."); };
    disconnectWallet(store);
    await settle();
    expect(ended).toBe(1);
    expect(client.posted.some((p) => p.route === "session_key_revoke")).toBe(false);
    expect(store.getSnapshot().toasts.some((t) => t.text === "The trading authorization was not revoked; it expires on its own.")).toBe(true);
  });

  it("re-runs the one-signature login once on a 401 that says the key died, then retries the order", async () => {
    const { client, provider, store } = await connected();
    await loginSession(store);
    let diedOnce = true;
    client.answer = (posted) => {
      if (posted.route === "order" && diedOnce) {
        diedOnce = false;
        throw new EngineError(401, "session key expired", { kind: "invalid_signature" });
      }
      return new ActionClient().answer(posted);
    };
    await placeOrder(store, { market: 1, side: "buy", qty: fixedFromWire("0.5"), kind: { kind: "market", quoted: fixedFromInt(100_000), slippageBps: 10 }, reduceOnly: false });
    expect(client.posted.filter((p) => p.route === "session_key")).toHaveLength(2);
    expect(client.posted.filter((p) => p.route === "order")).toHaveLength(2);
    expect(provider.calls.filter((c) => c.method === "eth_signTypedData_v4")).toHaveLength(2);
  });

  it("reuses one candidate key across a connection's failed login attempts, as the client contract settles", async () => {
    const { client, store } = await connected();
    client.answer = () => { throw new EngineError(0, "The node did not answer."); };
    expect(await loginSession(store)).toBe(false);
    const candidate = store.sessionKey?.address;
    if (candidate === undefined) throw new Error("no candidate kept");
    client.answer = () => ({ seq: 1, events: [{ type: "session_key_rejected", account: ACCOUNT, session_key: candidate, reason: { kind: "session_key_unsupported" } }] });
    expect(await loginSession(store)).toBe(false);
    expect(store.sessionKey?.address).toBe(candidate); // the same key, re-registered: never counts again
  });

  it("installs nothing when the wallet disconnects while the login prompt waits", async () => {
    const { client, provider, store, wallet } = await connected();
    let proceed!: () => void;
    wallet.sign = () => new Promise<string>((resolve) => { proceed = () => resolve("0x" + "11".repeat(65)); });
    const loggingIn = loginSession(store);
    await settle();
    disconnectWallet(store); // the user leaves while the wallet decides
    proceed(); // ...and approves anyway
    expect(await loggingIn).toBe(false);
    expect(liveSessionKey(store)).toBeNull(); // approved after the disconnect: registered at the node, but never installed here
    expect(store.sessionKeyExpiresAt).toBe(0);
    expect(client.posted.some((p) => p.route === "session_key")).toBe(true);
    void provider;
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

  it("re-login after a key died builds the retry's terms from the fresh nonce answer", async () => {
    const { client, store } = await connected();
    await loginSession(store);
    let diedOnce = true;
    client.answer = (posted) => {
      if (posted.route === "order" && diedOnce) {
        diedOnce = false;
        throw new EngineError(401, "session key expired", { kind: "invalid_signature" });
      }
      return new ActionClient().answer(posted);
    };
    const original = client.nonce.bind(client);
    let reads = 0;
    client.nonce = async () => {
      reads += 1;
      // The read after the re-login names a later signed time: the retry must use it.
      return reads >= 3 ? { next_nonce: 7, time_ms: NODE_TIME + 60_000 } : original();
    };
    await placeOrder(store, { market: 1, side: "buy", qty: fixedFromWire("0.5"), kind: { kind: "market", quoted: fixedFromInt(100_000), slippageBps: 10 }, reduceOnly: false });
    const retried = client.posted.at(-1);
    if (!retried || retried.route !== "order") throw new Error("no retried order posted");
    expect((retried.body as OrderRequest).auth?.expires_at).toBe(NODE_TIME + 60_000 + REQUEST_TTL_MS);
  });

  it("re-signs a declaration with the nonce a 409 names, and only once", async () => {
    const { client, provider, store } = await connected();
    let taken = false;
    client.answer = (posted) => {
      if (posted.route === "eligibility" && !taken) {
        taken = true;
        throw new EngineError(409, "invalid nonce", { kind: "invalid_nonce", expected: 9 });
      }
      return new ActionClient().answer(posted);
    };
    await attestEligibility(store, "eligible_client");
    const declarations = client.posted.filter((p) => p.route === "eligibility");
    expect(declarations.map((p) => (p.body as EligibilityRequest).auth.nonce)).toEqual([4, 9]);
    expect(provider.calls.filter((c) => c.method === "eth_signTypedData_v4")).toHaveLength(2); // the declaration's two attempts; the login never ran: the account is uncredited
    expect(store.getSnapshot().toasts.at(-1)).toMatchObject({ tone: "ok", text: "Eligibility recorded." });
  });

  it("a fresh login mints a fresh key, and two keys never share an address", async () => {
    const first = SessionKeySigner.generate();
    const second = SessionKeySigner.generate();
    expect(first.address).not.toBe(second.address);
  });
});