/** Tests for the live client's signed actions: the request it posts, the signed answer it accepts, and the refusals it reports. */

import { describe, expect, it } from "vitest";

import { EngineError } from "./client";
import { LiveEngineClient } from "./live";
import { setup } from "./live-setup";
import { acceptAll, FakeNode, FakeScheduler, FakeSocket, settle } from "./test-kit";
import { VECTORS, vectorResponse } from "./test-vectors";
import type { OrderRequest, SignedWithdrawal } from "./types";
import { SignatureError } from "./trust";

const conflict = vectorResponse("nonce conflict");
const ACCOUNT = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

/** A client whose verifier accepts every answer, over a node whose routes the test sets. */
function accepting(sockets: FakeSocket[] = []) {
  const node = new FakeNode();
  node.attestation(() => VECTORS.signer);
  const scheduler = new FakeScheduler();
  const client = new LiveEngineClient({
    origin: "https://node.test", streamOrigin: "wss://node.test", chainId: 31337, vault: conflict.vault, heartbeatMs: 5_000,
    loadVerifier: async () => acceptAll, manifests: [], acceptsMock: true, fetch: node.fetch,
    openSocket: (url) => { const socket = new FakeSocket(url); sockets.push(socket); return socket; },
    scheduler, nowMs: () => 1_000, challenge: () => "ab".repeat(32),
  });
  const reply = (path: string, status: number, body: unknown, seq = 9) => node.signed(path, () => ({ status, body: JSON.stringify(body), signature: "0x00", timeMs: 1_000, seq }));
  return { node, client, reply, scheduler };
}

describe("signed actions", () => {
  it("reads a signed 409 as the nonce the node expects, verified for the exact request posted", async () => {
    const { node, client } = setup({ challenge: conflict.challenge, nowMs: conflict.time_ms });
    node.signed("/v1/orders", () => ({ status: conflict.status, body: conflict.body, signature: conflict.signature, timeMs: conflict.time_ms, seq: conflict.head_seq }));
    // The same keys in the same order as the vector's body, so the bytes posted are the bytes it signed over.
    const request = JSON.parse(conflict.request_body) as OrderRequest;
    const refusal = await client.placeOrder(request).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(EngineError);
    expect(refusal).toMatchObject({ status: 409, reject: { kind: "invalid_nonce", expected: 7 } });
    expect(node.posts).toEqual([{ path: "/v1/orders", method: "POST", contentType: "application/json", body: conflict.request_body }]);
  });

  it("refuses a signed answer that was made for another request body", async () => {
    const { node, client } = setup({ challenge: conflict.challenge, nowMs: conflict.time_ms });
    node.signed("/v1/orders", () => ({ status: conflict.status, body: conflict.body, signature: conflict.signature, timeMs: conflict.time_ms, seq: conflict.head_seq }));
    const request = { ...(JSON.parse(conflict.request_body) as OrderRequest), client_id: 2 };
    await expect(client.placeOrder(request)).rejects.toBeInstanceOf(SignatureError);
  });

  it.each([
    ["placeOrder", "/v1/orders"],
    ["cancelOrder", "/v1/orders/cancel"],
    ["withdraw", "/v1/withdrawals"],
    ["attestEligibility", "/v1/eligibility"],
  ] as const)("%s posts the request to %s and returns the events with the seq the node signed", async (method, path) => {
    const { node, client, reply } = accepting();
    const events = [{ type: "order_accepted", account: ACCOUNT, client_id: 1, order_id: 4 }];
    reply(path, 200, events, 77);
    const request = { account: ACCOUNT, marker: method };
    // Each action posts its request as given; the shape does not matter to the transport.
    await expect(client[method](request as never)).resolves.toEqual({ seq: 77, events });
    expect(node.posts[0]).toEqual({ path, method: "POST", contentType: "application/json", body: JSON.stringify(request) });
  });

  it("reports a signed 401 as the engine's signature refusal and a 403 with a reason as an access refusal", async () => {
    const { client, reply } = accepting();
    reply("/v1/orders", 401, { error: "invalid signature" });
    await expect(client.placeOrder({} as OrderRequest)).rejects.toMatchObject({ status: 401, reject: { kind: "invalid_signature" } });
    reply("/v1/orders", 401, { error: "missing signature" });
    await expect(client.placeOrder({} as OrderRequest)).rejects.toMatchObject({ status: 401, reject: { kind: "missing_signature" } });
    reply("/v1/eligibility", 403, { error: "access refused", reason: "united_states" });
    await expect(client.attestEligibility({} as never)).rejects.toMatchObject({ status: 403, reject: { kind: "access", reason: "united_states" } });
    reply("/v1/eligibility", 403, { error: "a never-credited account declares only once a deposit for it is pending" });
    await expect(client.attestEligibility({} as never)).rejects.toMatchObject({ status: 403, reject: null, message: "a never-credited account declares only once a deposit for it is pending" });
  });

  it("refuses a 2xx action answer that is not a list of events", async () => {
    const { client, reply } = accepting();
    reply("/v1/withdrawals", 200, { status: "queued" });
    await expect(client.withdraw({} as never)).rejects.toThrow("not a list of events");
  });

  it("posts a reissue to the payout's route and reads the nonce with the node's signed time", async () => {
    const { node, client, reply } = accepting();
    reply(`/v1/accounts/${ACCOUNT}/withdrawals/3/reissue`, 200, { status: "queued", resend_after_restart: true });
    await client.reissue(ACCOUNT, 3, { replaces_expires_at: 90, signature: "0x11" });
    expect(node.posts[0]?.body).toBe('{"replaces_expires_at":90,"signature":"0x11"}');
    reply(`/v1/accounts/${ACCOUNT}/nonce`, 200, { next_nonce: 5 });
    await expect(client.nonce(ACCOUNT)).resolves.toEqual({ next_nonce: 5, time_ms: 1_000 });
  });
});

describe("quotes and authorizations on the stream", () => {
  const quote = { type: "quote", account: ACCOUNT, market: 1, open: true, reduce_only: false, stress_level: 0, mark: "100", ask: [], bid: [], close: null };
  const frame = (n: number, msg: object) => JSON.stringify({ v: 1, n, time: 1_000, msg: JSON.stringify(msg), sig: "0x00" });

  it("asks for the account's quotes once the socket opens, and reports each quote and authorization the node signs", async () => {
    const sockets: FakeSocket[] = [];
    const { client } = accepting(sockets);
    const seen: unknown[] = [];
    client.watch((event) => { if (event.type !== "feed" && event.type !== "attestation") seen.push(event); });
    client.quotes({ account: ACCOUNT, markets: [1, 2] });
    client.subscribe(() => {});
    await settle();
    const socket = sockets[0];
    if (!socket) throw new Error("no socket");
    expect(socket.sent).toEqual([]);
    socket.open();
    expect(socket.sent).toEqual([JSON.stringify({ op: "quotes", account: ACCOUNT, markets: [1, 2] })]);
    const withdrawal: SignedWithdrawal & { type: string; offset: string } = { type: "withdrawal", offset: "9:0", account: ACCOUNT, amount: "10", nonce: 1, chain_id: 31337, vault: conflict.vault, signature: "0x22" };
    socket.receive(frame(0, quote));
    socket.receive(frame(1, { type: "quote_error", error: "account has never been credited" }));
    socket.receive(frame(2, withdrawal));
    socket.receive(frame(3, { type: "checkpoint", offset: "9:1", seq: 9 }));
    expect(seen).toEqual([{ type: "quote", quote }, { type: "quote_error", error: "account has never been credited" }, { type: "withdrawal", withdrawal }]);
    expect(socket.closed).toBe(false);
  });

  it("sends a changed request at once, not the same one twice, the same one again after the node refused it, and an empty list to end it", async () => {
    const sockets: FakeSocket[] = [];
    const { client } = accepting(sockets);
    client.subscribe(() => {});
    await settle();
    const socket = sockets[0];
    if (!socket) throw new Error("no socket");
    socket.open();
    const op = (markets: number[]) => JSON.stringify({ op: "quotes", account: ACCOUNT, markets });
    client.quotes({ account: ACCOUNT, markets: [1] });
    client.quotes({ account: ACCOUNT, markets: [1] });
    socket.receive(frame(0, { type: "quote_error", error: "account has never been credited" }));
    client.quotes({ account: ACCOUNT, markets: [1] });
    client.quotes({ account: ACCOUNT, markets: [1, 2] });
    client.quotes(null);
    expect(socket.sent).toEqual([op([1]), op([1]), op([1, 2]), op([])]);
  });
});

describe("a quote refusal that arrives late", () => {
  it("is asked again once when the page asked for the same quotes while the refusal was on its way, and not again after", async () => {
    const sockets: FakeSocket[] = [];
    const { client } = accepting(sockets);
    client.subscribe(() => {});
    await settle();
    const socket = sockets[0];
    if (!socket) throw new Error("no socket");
    socket.open();
    const op = JSON.stringify({ op: "quotes", account: ACCOUNT, markets: [1] });
    client.quotes({ account: ACCOUNT, markets: [1] });
    // The account is credited and the page asks again before the first refusal arrives.
    client.quotes({ account: ACCOUNT, markets: [1] });
    expect(socket.sent).toEqual([op]);
    socket.receive(JSON.stringify({ v: 1, n: 0, time: 1_000, msg: JSON.stringify({ type: "quote_error", error: "the account has never been credited" }), sig: "0x00" }));
    expect(socket.sent).toEqual([op, op]);
    socket.receive(JSON.stringify({ v: 1, n: 1, time: 1_000, msg: JSON.stringify({ type: "quote_error", error: "the account has never been credited" }), sig: "0x00" }));
    expect(socket.sent).toEqual([op, op]);
  });
});

describe("quotes across a reconnect", () => {
  it("asks a reconnected socket for the same quotes again once it opens", async () => {
    const sockets: FakeSocket[] = [];
    const { client, scheduler } = accepting(sockets);
    client.quotes({ account: ACCOUNT, markets: [1] });
    client.subscribe(() => {});
    await settle();
    sockets[0]?.open();
    sockets[0]?.drop("close");
    scheduler.advance(1_000);
    await settle();
    const next = sockets[1];
    if (!next) throw new Error("no second socket");
    expect(next.sent).toEqual([]);
    next.open();
    expect(next.sent).toEqual([JSON.stringify({ op: "quotes", account: ACCOUNT, markets: [1] })]);
  });
});

describe("finding an authorization in the log", () => {
  const frame = (n: number, msg: object) => JSON.stringify({ v: 1, n, time: 1_000, msg: JSON.stringify(msg), sig: "0x00" });
  const signed = (nonce: number, expires: number) => ({ type: "withdrawal", offset: `${40 + nonce}:0`, account: ACCOUNT, amount: "10", nonce, chain_id: 31337, vault: conflict.vault, signature: "0x22", approved_seq: 40, authorization: { expires_at: expires } });

  it("reads from the approval's seq until the head a heartbeat names, keeping the latest authorization of that payout", async () => {
    const sockets: FakeSocket[] = [];
    const { client } = accepting(sockets);
    const found = client.findWithdrawal(ACCOUNT, 1, 40);
    await settle();
    const socket = sockets[0];
    if (!socket) throw new Error("no socket");
    expect(socket.url).toBe(`wss://node.test/v1/stream?signed=1&challenge=${"ab".repeat(32)}&from=40`);
    socket.receive(frame(0, { type: "heartbeat", head: "45:0" }));
    socket.receive(frame(1, signed(1, 100)));
    socket.receive(frame(2, signed(2, 100)));
    socket.receive(frame(3, { ...signed(1, 200), offset: "45:0" }));
    socket.receive(frame(4, { type: "heartbeat", head: "45:0" }));
    await expect(found).resolves.toMatchObject({ withdrawal: { nonce: 1, authorization: { expires_at: 200 } }, complete: true });
    expect(socket.closed).toBe(true);
  });

  it("answers null when the log holds nothing after the seq, and fails on a frame out of order", async () => {
    const sockets: FakeSocket[] = [];
    const { client } = accepting(sockets);
    const none = client.findWithdrawal(ACCOUNT, 1, 50);
    await settle();
    sockets[0]?.receive(frame(0, { type: "heartbeat", head: "45:0" }));
    await expect(none).resolves.toEqual({ withdrawal: null, complete: true, reached: null });
    const broken = client.findWithdrawal(ACCOUNT, 1, 40);
    await settle();
    sockets[1]?.receive(frame(1, { type: "heartbeat", head: "45:0" }));
    await expect(broken).rejects.toThrow("skipped");
  });

  it("reads past an unexpired authorization to the head, since the node signs a payout again when the vault's signer rotates", async () => {
    const sockets: FakeSocket[] = [];
    const { client } = accepting(sockets);
    const found = client.findWithdrawal(ACCOUNT, 1, 40);
    await settle();
    sockets[0]?.receive(frame(0, { type: "heartbeat", head: "45:0" }));
    sockets[0]?.receive(frame(1, signed(1, 2_000_000_000)));
    expect(sockets[0]?.closed).toBe(false);
    sockets[0]?.receive(frame(2, { ...signed(1, 2_000_000_100), offset: "45:0" }));
    sockets[0]?.receive(frame(3, { type: "heartbeat", head: "45:0" }));
    await expect(found).resolves.toMatchObject({ withdrawal: { authorization: { expires_at: 2_000_000_100 } }, complete: true });
  });

  it("answers with the latest authorization found, marked incomplete, when the read fails or runs out of time after it", async () => {
    const sockets: FakeSocket[] = [];
    const { client, scheduler } = accepting(sockets);
    const timedOut = client.findWithdrawal(ACCOUNT, 1, 40);
    await settle();
    sockets[0]?.receive(frame(0, { type: "heartbeat", head: "90:0" }));
    sockets[0]?.receive(frame(1, signed(1, 100)));
    scheduler.advance(30_000);
    await expect(timedOut).resolves.toMatchObject({ withdrawal: { authorization: { expires_at: 100 } }, complete: false, reached: 41 });
    const dropped = client.findWithdrawal(ACCOUNT, 1, 40);
    await settle();
    sockets[1]?.receive(frame(0, signed(1, 100)));
    sockets[1]?.drop("close");
    await expect(dropped).resolves.toMatchObject({ withdrawal: { authorization: { expires_at: 100 } }, complete: false });
  });

  it("gives up after 30 s", async () => {
    const sockets: FakeSocket[] = [];
    const { client, scheduler } = accepting(sockets);
    const slow = client.findWithdrawal(ACCOUNT, 1, 40);
    await settle();
    scheduler.advance(30_000);
    await expect(slow).rejects.toThrow("took too long");
    expect(sockets[0]?.closed).toBe(true);
  });
});
