/** Tests for the operator's status notice in the live client: the read before the stream, its frames, a node that predates it, and what a failed read leaves. */

import { describe, expect, it } from "vitest";

import { EngineError, type ClientEvent } from "./client";
import { LiveEngineClient } from "./live";
import { NoticeWatch } from "./live-notice";
import { noticeOf, sameNotice, type StatusNotice } from "./notice-types";
import { acceptAll, FakeNode, FakeScheduler, FakeSocket, settle } from "./test-kit";
import { VECTORS } from "./test-vectors";

const NOTICE: StatusNotice = { text: "Security maintenance: withdrawals are paused.", set_at_ms: 1_792_504_800_000 };

describe("a notice body", () => {
  it.each([
    [{ notice: NOTICE }, NOTICE],
    [{ notice: null }, null],
    [{}, undefined],
    [null, undefined],
    [{ notice: "text" }, undefined],
    [{ notice: [] }, undefined],
    [{ notice: { text: "", set_at_ms: 1 } }, undefined],
    [{ notice: { text: "x", set_at_ms: "1" } }, undefined],
  ])("%j reads as %j", (body, notice) => {
    expect(noticeOf(body)).toEqual(notice);
  });

  it("is the same notice only with the same text and time", () => {
    expect(sameNotice(null, null)).toBe(true);
    expect(sameNotice(NOTICE, { ...NOTICE })).toBe(true);
    expect(sameNotice(NOTICE, null)).toBe(false);
    expect(sameNotice(NOTICE, { ...NOTICE, set_at_ms: 2 })).toBe(false);
  });
});

/** A watch whose reads answer, in turn, with each of `answers`: a body, or an error to reject with. */
function watching(...answers: unknown[]) {
  const reports: (StatusNotice | null)[] = [];
  let reads = 0;
  const watch = new NoticeWatch({
    read: () => {
      const answer = answers[Math.min(reads++, answers.length - 1)];
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
    report: (notice) => reports.push(notice),
  });
  return { watch, reports, reads: () => reads };
}

describe("a notice read", () => {
  it("reports what the node says, none included, and then asks the stream for frames", async () => {
    const set = watching({ notice: NOTICE });
    await expect(set.watch.frames()).resolves.toBe(true);
    expect(set.reports).toEqual([NOTICE]);
    const none = watching({ notice: null });
    await expect(none.watch.frames()).resolves.toBe(true);
    expect(none.reports).toEqual([null]);
  });

  it("reports no notice for a node that predates the route, and does not ask the stream for frames", async () => {
    const t = watching(new EngineError(404, "not found"));
    await expect(t.watch.frames()).resolves.toBe(false);
    expect(t.reports).toEqual([null]);
  });

  it("asks the node again before every connection, so a server replaced by another release is asked the right query", async () => {
    const t = watching({ notice: NOTICE }, new EngineError(404, "not found"), { notice: null }, new EngineError(404, "not found"), { notice: NOTICE });
    const asked = [await t.watch.frames(), await t.watch.frames(), await t.watch.frames(), await t.watch.frames(), await t.watch.frames()];
    expect(asked).toEqual([true, false, true, false, true]);
    expect(t.reads()).toBe(5);
    expect(t.reports).toEqual([NOTICE, null, null, null, NOTICE]);
  });

  it("says nothing of the notice when the read fails, and still asks the stream for frames", async () => {
    const t = watching(new EngineError(0, "down"), new EngineError(503, "busy"));
    await expect(t.watch.frames()).resolves.toBe(true);
    await expect(t.watch.frames()).resolves.toBe(true);
    expect(t.reports).toEqual([]);
  });

  it("ignores an answer that is not a notice", async () => {
    const t = watching({ unrelated: true });
    await expect(t.watch.frames()).resolves.toBe(true);
    expect(t.reports).toEqual([]);
  });

  it("does not hide a failure of the listener", async () => {
    const watch = new NoticeWatch({ read: async () => ({ notice: null }), report: () => { throw new Error("listener failed"); } });
    await expect(watch.frames()).rejects.toThrow("listener failed");
  });

  it("reports each frame", () => {
    const t = watching();
    t.watch.frame(NOTICE);
    t.watch.frame(null);
    expect(t.reports).toEqual([NOTICE, null]);
  });
});

/** A watch whose reads each wait for the test to answer them. */
function deferred() {
  const answers: ((body: unknown) => void)[] = [];
  const reports: (StatusNotice | null)[] = [];
  const watch = new NoticeWatch({ read: () => new Promise((resolve) => answers.push(resolve)), report: (notice) => reports.push(notice) });
  return { watch, answers, reports };
}

describe("a read that answers late", () => {
  it("is dropped once the stream has stopped", async () => {
    const t = deferred();
    const asked = t.watch.frames();
    t.watch.stop();
    t.answers[0]?.({ notice: NOTICE });
    await expect(asked).resolves.toBe(true);
    expect(t.reports).toEqual([]);
  });

  it("is dropped once a frame has said something newer", async () => {
    const t = deferred();
    const asked = t.watch.frames();
    t.watch.frame(null);
    t.answers[0]?.({ notice: NOTICE });
    await asked;
    expect(t.reports).toEqual([null]);
  });

  it("is dropped once a later read has been asked for", async () => {
    const t = deferred();
    const first = t.watch.frames();
    const second = t.watch.frames();
    t.answers[1]?.({ notice: null });
    t.answers[0]?.({ notice: NOTICE });
    await Promise.all([first, second]);
    expect(t.reports).toEqual([null]);
  });
});

/** A client over a fake node whose verifier accepts every answer, with `/v1/notice` answering `status` and `body`. */
function client(status: number, body: unknown) {
  const node = new FakeNode();
  node.attestation(() => VECTORS.signer);
  node.signed("/v1/status", () => ({ status: 404, body: '{"error":"not found"}', signature: "0x00", timeMs: 1_000, seq: 9 })); // this node predates status frames
  node.signed("/v1/notice", () => ({ status, body: JSON.stringify(body), signature: "0x00", timeMs: 1_000, seq: 9 }));
  const sockets: FakeSocket[] = [];
  const scheduler = new FakeScheduler();
  const live = new LiveEngineClient({
    origin: "https://node.test", streamOrigin: "wss://node.test", chainId: 31337, vault: "0x00000000000000000000000000000000000000bb", heartbeatMs: 5_000,
    loadVerifier: async () => acceptAll, releases: [], acceptsMock: true, fetch: node.fetch,
    openSocket: (url) => { const socket = new FakeSocket(url); sockets.push(socket); return socket; },
    scheduler, nowMs: () => 1_000, challenge: () => "ab".repeat(32),
  });
  const notices: (StatusNotice | null)[] = [];
  live.watch((event: ClientEvent) => { if (event.type === "notice") notices.push(event.notice); });
  const frame = (n: number, notice: StatusNotice | null) => sockets[0]?.receive(JSON.stringify({ v: 1, n, time: 1_000, msg: JSON.stringify({ type: "notice", notice }), sig: "0x00" }));
  return { node, live, sockets, scheduler, notices, frame };
}

describe("the live client", () => {
  it("reads the notice before its stream opens, asks the stream for notice frames, and reports each one until it is cleared", async () => {
    const t = client(200, { notice: NOTICE });
    t.live.subscribe(() => {});
    await settle();
    expect(t.notices).toEqual([NOTICE]);
    expect(t.sockets[0]?.url).toBe(`wss://node.test/v1/stream?signed=1&notice=1&challenge=${"ab".repeat(32)}`);
    const replaced = { text: "Markets are reduce-only.", set_at_ms: NOTICE.set_at_ms + 1 };
    t.frame(0, replaced);
    t.frame(1, null);
    expect(t.notices).toEqual([NOTICE, replaced, null]);
  });

  it("opens the stream without notice frames for a node that predates them", async () => {
    const t = client(404, { error: "not found" });
    t.live.subscribe(() => {});
    await settle();
    expect(t.sockets[0]?.url).toBe(`wss://node.test/v1/stream?signed=1&challenge=${"ab".repeat(32)}`);
    expect(t.notices).toEqual([null]);
  });

  it("drops a read still on its way from a stream that was stopped, so it cannot restore a notice the next stream has cleared", async () => {
    const t = client(200, { notice: NOTICE });
    const answer = t.node.routes.get("/v1/notice");
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    let asked = 0;
    t.node.routes.set("/v1/notice", async (challenge) => {
      if (asked++ === 0) await held; // the first stream's read waits; the second's answers at once, with no notice
      return asked === 1 ? (answer?.(challenge) as Response) : new Response('{"notice":null}', { status: 200, headers: (answer?.(challenge) as Response).headers });
    });
    const unsubscribe = t.live.subscribe(() => {});
    await settle();
    unsubscribe();
    t.live.subscribe(() => {});
    await settle();
    expect(t.notices).toEqual([null]);
    release();
    await settle();
    expect(t.notices).toEqual([null]);
  });

  it("asks again when the stream reconnects, so a node upgraded meanwhile is asked for notice frames", async () => {
    const t = client(404, { error: "not found" });
    t.live.subscribe(() => {});
    await settle();
    expect(t.sockets[0]?.url).not.toContain("notice=1");
    t.node.signed("/v1/notice", () => ({ status: 200, body: JSON.stringify({ notice: NOTICE }), signature: "0x00", timeMs: 1_000, seq: 9 }));
    t.sockets[0]?.drop("close");
    t.scheduler.advance(5_000); // past the first backoff
    await settle();
    expect(t.notices).toEqual([null, NOTICE]);
    expect(t.sockets.at(-1)?.url).toContain("&notice=1&");
  });
});
