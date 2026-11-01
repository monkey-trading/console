/** Tests for the session-key login: the one wallet signature at connect, the silent trading it enables, and the revocation at disconnect. */

import { describe, expect, it } from "vitest";

import { EngineError } from "../engine/client";
import vectors from "../engine/eip712-vectors.json";
import { registerSessionKeyTypedData, requestDomain, revokeSessionKeyTypedData } from "../engine/eip712";
import { SESSION_KEY_TTL_MS, SessionKeySigner } from "../engine/session-key";
import type { SessionKeyRequest, SessionKeyRevocationRequest } from "../engine/types";
import { ACCOUNT } from "../engine/wallet-kit";
import { fixedFromInt, fixedFromWire } from "../fixed";
import { disconnectWallet, placeOrder, REQUEST_TTL_MS } from "./actions";
import { connected, NODE_TIME, signerOf, VAULT, ActionClient } from "./live-kit";
import { liveSessionKey, loginSession } from "./session";
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
    expect(store.sessionKey).toBeNull();
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("This node does not support session keys yet.");
  });

  it("tells the user when they decline the login signature, and keeps no key", async () => {
    const { store } = await connected({ fail: { eth_signTypedData_v4: { code: 4001, message: "User rejected" } } });
    expect(await loginSession(store)).toBe(false);
    expect(store.sessionKey).toBeNull();
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

  it("a fresh login mints a fresh key, and two keys never share an address", async () => {
    const first = SessionKeySigner.generate();
    const second = SessionKeySigner.generate();
    expect(first.address).not.toBe(second.address);
  });
});