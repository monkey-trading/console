/** Tests for the one-off signed log scan that reads the house's parameters and the latest checkpoint from the log. */

import { describe, expect, it } from "vitest";

import { BUDGET, checkpoint, command, frame, PARAMS_FIELDS, scanning, SET_PARAMS } from "./live-house-kit";
import type { FakeSocket } from "./test-kit";

describe("scanning the log for the house's state", () => {
  it("opens from the seq given, folds the latest applied set_params of either log shape and the latest checkpoint, and ends at the head a heartbeat names", async () => {
    const sockets: FakeSocket[] = [];
    const { run } = scanning(sockets);
    const found = run(40);
    await Promise.resolve();
    const socket = sockets[0];
    if (!socket) throw new Error("no socket");
    expect(socket.url).toBe(`wss://node.test/v1/stream?signed=1&challenge=${"ab".repeat(32)}&from=40`);
    socket.receive(frame(0, { type: "heartbeat", head: "45:0" }));
    socket.receive(frame(1, command(40, { type: "admin", ...SET_PARAMS, profit_fee_bps: 1500 })));
    socket.receive(frame(2, checkpoint(41)));
    socket.receive(frame(3, command(42, { type: "signed_admin", command: SET_PARAMS })));
    socket.receive(frame(4, checkpoint(43)));
    let settled = false;
    void found.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    socket.receive(frame(5, command(45, { type: "tick" })));
    socket.receive(frame(6, { type: "heartbeat", head: "45:0" }));
    await expect(found).resolves.toEqual({
      params: PARAMS_FIELDS,
      paramsSeq: 42,
      checkpoint: checkpoint(43),
      complete: true,
      last: [45, 0],
    });
    expect(socket.closed).toBe(true);
  });

  it("ignores a set_params the engine rejected, whose values never applied", async () => {
    const sockets: FakeSocket[] = [];
    const { run } = scanning(sockets);
    const found = run(40);
    await Promise.resolve();
    const socket = sockets[0];
    if (!socket) throw new Error("no socket");
    socket.receive(frame(0, command(40, { type: "admin", ...SET_PARAMS, profit_fee_bps: 1500 })));
    socket.receive(frame(1, command(41, { type: "signed_admin", command: SET_PARAMS }, [{ type: "admin_rejected", reason: "out of bounds" }])));
    socket.receive(frame(2, { type: "heartbeat", head: "41:0" }));
    await expect(found).resolves.toMatchObject({ params: { ...PARAMS_FIELDS, profit_fee_bps: 1500 }, paramsSeq: 40, complete: true });
  });

  it("stops at the message budget and answers with what it found, marked incomplete from the last entry read", async () => {
    const sockets: FakeSocket[] = [];
    const { run } = scanning(sockets);
    const found = run(40, { ...BUDGET, maxMessages: 2 });
    await Promise.resolve();
    sockets[0]?.receive(frame(0, command(40, { type: "admin", ...SET_PARAMS })));
    sockets[0]?.receive(frame(1, checkpoint(41)));
    sockets[0]?.receive(frame(2, command(42, { type: "tick" })));
    await expect(found).resolves.toEqual({
      params: PARAMS_FIELDS,
      paramsSeq: 40,
      checkpoint: checkpoint(41),
      complete: false,
      last: [41, 1],
    });
  });

  it("resuming at the last sequence with skipPast re-reads it but folds only what follows, so a command's checkpoint is never skipped", async () => {
    const sockets: FakeSocket[] = [];
    const { run } = scanning(sockets);
    const first = run(40, { ...BUDGET, maxMessages: 1 });
    await Promise.resolve();
    sockets[0]?.receive(frame(0, command(40, { type: "tick" })));
    sockets[0]?.receive(frame(1, command(41, { type: "tick" })));
    await expect(first).resolves.toMatchObject({ complete: false, last: [40, 0] });
    const second = run(40, BUDGET, [40, 0]);
    await Promise.resolve();
    sockets[1]?.receive(frame(0, command(40, { type: "tick" })));
    sockets[1]?.receive(frame(1, command(41, { type: "admin", ...SET_PARAMS })));
    sockets[1]?.receive(frame(2, checkpoint(41, 1)));
    sockets[1]?.receive(frame(3, { type: "heartbeat", head: "41:1" }));
    await expect(second).resolves.toEqual({ params: PARAMS_FIELDS, paramsSeq: 41, checkpoint: checkpoint(41, 1), complete: true, last: [41, 1] });
  });

  it("rejects an out-of-order frame, and gives up when the budget's time runs out", async () => {
    const sockets: FakeSocket[] = [];
    const { run, scheduler } = scanning(sockets);
    const broken = run(40);
    await Promise.resolve();
    sockets[0]?.receive(frame(1, { type: "heartbeat", head: "45:0" }));
    await expect(broken).rejects.toThrow("skipped");
    const slow = run(40);
    await Promise.resolve();
    sockets[1]?.receive(frame(0, command(40, { type: "admin", ...SET_PARAMS })));
    sockets[1]?.receive(frame(1, checkpoint(41)));
    scheduler.advance(30_000);
    await expect(slow).resolves.toEqual({ params: PARAMS_FIELDS, paramsSeq: 40, checkpoint: checkpoint(41), complete: false, last: [41, 1] });
  });

  it("rejects a frame whose checkpoint or command the console does not know", async () => {
    const sockets: FakeSocket[] = [];
    const { run } = scanning(sockets);
    const found = run(40);
    await Promise.resolve();
    sockets[0]?.receive(frame(0, { type: "mystery", offset: "40:0" }));
    await expect(found).rejects.toThrow("does not know");
  });
});
