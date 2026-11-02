/** Tests for revoking a session key from the Settings page, and for ending this browser's own session. */

import { describe, expect, it } from "vitest";

import { revokeSessionKeyTypedData } from "../engine/eip712";
import { SessionKeySigner } from "../engine/session-key";
import { settle } from "../engine/test-kit";
import type { SessionKeyRevocationRequest } from "../engine/types";
import { ACCOUNT } from "../engine/wallet-kit";
import { NODE_TIME, signerOf } from "./live-kit";
import { DOMAIN, H, message, opened, OTHER_KEY, registered, registeredReads, revokedAt, walletSignatures } from "./session-list-kit";
import { installKey } from "./session";
import { sessionEnded } from "./wallet-session";

describe("revoking a session key", () => {
  it("asks the wallet once for a RevokeSessionKey signature and removes the row, and reads again", async () => {
    const { client, provider, list, own, reads, setEvents } = await opened();
    client.answer = (posted) => {
      // The node's history carries the revocation by the time the console reads it again.
      setEvents([revokedAt("12:0", OTHER_KEY, NODE_TIME), registered("9:0", OTHER_KEY, NODE_TIME - H, NODE_TIME + 20 * H), registered("5:0", own, NODE_TIME - 3 * H, NODE_TIME + 20 * H)]);
      return { seq: 2, events: [{ type: "session_key_revoked", account: ACCOUNT, session_key: (posted.body as SessionKeyRevocationRequest).session_key }] };
    };
    const before = registeredReads(reads);
    await list.revoke(OTHER_KEY);
    const sent = client.posted.find((p) => p.route === "session_key_revoke")?.body as SessionKeyRevocationRequest | undefined;
    if (sent === undefined) throw new Error("no revocation sent");
    expect(sent).toMatchObject({ account: ACCOUNT, session_key: OTHER_KEY });
    expect(walletSignatures(provider)).toBe(2); // the login's and this one
    expect(await signerOf(revokeSessionKeyTypedData(DOMAIN, ACCOUNT, OTHER_KEY, { nonce: sent.auth.nonce, expiresAt: sent.auth.expires_at }), sent.auth.signature)).toBe(ACCOUNT);
    await settle();
    expect(list.getSnapshot().keys.map((k) => k.address)).toEqual([own.toLowerCase()]);
    // The answer alone brings one read that confirms the revocation, whether or not the stream delivers its copy.
    expect(registeredReads(reads) - before).toBe(1);
    client.deliver(message([{ type: "session_key_revoked", account: ACCOUNT, session_key: OTHER_KEY }]));
    await settle();
    // The stream's copy of it folds into at most one more.
    expect(registeredReads(reads) - before).toBeLessThanOrEqual(2);
  });

  it("keeps the row and shows the node's reason when the revocation is refused", async () => {
    const { client, store, list } = await opened();
    client.answer = () => ({ seq: 2, events: [{ type: "session_key_rejected", account: ACCOUNT, session_key: OTHER_KEY, reason: { kind: "invalid_session_key" } }] });
    await list.revoke(OTHER_KEY);
    expect(list.getSnapshot().keys.map((k) => k.address)).toContain(OTHER_KEY);
    expect(store.getSnapshot().notices.settings?.tone).toBe("error");
  });

  it("leaves the row alone when the wallet declines", async () => {
    const { client, wallet, list } = await opened();
    wallet.sign = () => Promise.reject(new Error("User rejected the request."));
    await list.revoke(OTHER_KEY);
    expect(client.posted.some((p) => p.route === "session_key_revoke")).toBe(false);
    expect(list.getSnapshot().keys).toHaveLength(2);
  });

  it("disconnects the wallet when the key it revokes is this browser's own, without a second prompt", async () => {
    const { client, store, provider, list, own } = await opened();
    client.answer = () => ({ seq: 2, events: [{ type: "session_key_revoked", account: ACCOUNT, session_key: own }] });
    await list.revoke(own);
    expect(store.getSnapshot().wallet).toBeNull();
    expect(store.sessionKey).toBeNull();
    expect(walletSignatures(provider)).toBe(2);
    expect(client.posted.filter((p) => p.route === "session_key_revoke")).toHaveLength(1);
  });

  it("keeps the connection and the newer key when another tab's login replaced the revoked key while the wallet asked", async () => {
    const { client, store, list, own } = await opened();
    client.answer = () => ({ seq: 2, events: [{ type: "session_key_revoked", account: ACCOUNT, session_key: own }] });
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const original = client.revokeSessionKey.bind(client);
    client.revokeSessionKey = async (body) => { await hold; return original(body); };
    const revoking = list.revoke(own);
    await settle();
    const newer = SessionKeySigner.generate();
    installKey(store, newer, NODE_TIME + 20 * H); // the other tab's registration, adopted here
    release();
    await revoking;
    expect(store.getSnapshot().wallet?.address).toBe(ACCOUNT);
    expect(store.sessionKey?.address).toBe(newer.address);
    expect(store.getSnapshot().notices).toEqual({});
  });

  it("starts no read and no timer when the page closed while the revocation was out", async () => {
    const { client, list, close, reads, scheduler } = await opened();
    let finish!: () => void;
    client.answer = (posted) => ({ seq: 2, events: [{ type: "session_key_revoked", account: ACCOUNT, session_key: (posted.body as SessionKeyRevocationRequest).session_key }] });
    const hold = new Promise<void>((resolve) => { finish = resolve; });
    const original = client.revokeSessionKey.bind(client);
    client.revokeSessionKey = async (body) => { await hold; return original(body); };
    const revoking = list.revoke(OTHER_KEY);
    await settle();
    close();
    const before = registeredReads(reads);
    finish();
    await revoking;
    await settle();
    expect(registeredReads(reads)).toBe(before);
    expect(scheduler.timers).toEqual([]);
  });
});

describe("ending this browser's own session", () => {
  it("does nothing when the wallet is already gone, so the stream and the answer cannot both report it", async () => {
    const { store } = await opened();
    sessionEnded(store, "first");
    sessionEnded(store, "second");
    expect(store.getSnapshot().notices.wallet).toMatchObject({ tone: "info", text: "first" });
  });

  it("tells the user once when the stream's copy of the revocation arrives before the answer", async () => {
    const { client, store, list, own } = await opened();
    client.answer = () => {
      // The store hears the node's event on the stream before the revocation's own answer returns.
      client.deliver(message([{ type: "session_key_revoked", account: ACCOUNT, session_key: own }]));
      return { seq: 2, events: [{ type: "session_key_revoked", account: ACCOUNT, session_key: own }] };
    };
    await list.revoke(own);
    expect(store.getSnapshot().wallet).toBeNull();
    expect(store.getSnapshot().notices).toEqual({ wallet: expect.objectContaining({ tone: "info", text: "This browser's trading authorization was revoked, so your wallet was disconnected. Connect again to renew it." }) });
  });

  it("disconnects for a revocation the stream reports while the page is closed, as on every other page, and asks nothing", async () => {
    const { client, close, provider, store, own } = await opened();
    close();
    const prompts = walletSignatures(provider);
    client.deliver(message([{ type: "session_key_revoked", account: ACCOUNT, session_key: own }]));
    await settle();
    expect(store.getSnapshot().wallet).toBeNull();
    expect(walletSignatures(provider)).toBe(prompts);
  });

  it("does nothing more when it hears a revocation of another key: the row goes and the connection stays", async () => {
    const { client, list, store, setEvents, own } = await opened();
    setEvents([revokedAt("12:0", OTHER_KEY, NODE_TIME), registered("9:0", OTHER_KEY, NODE_TIME - H, NODE_TIME + 20 * H), registered("5:0", own, NODE_TIME - 3 * H, NODE_TIME + 20 * H)]);
    client.deliver(message([{ type: "session_key_revoked", account: ACCOUNT, session_key: OTHER_KEY }]));
    await settle();
    expect(store.getSnapshot().wallet?.address).toBe(ACCOUNT);
    expect(list.getSnapshot().keys.map((k) => k.address)).toEqual([own.toLowerCase()]);
  });
});
