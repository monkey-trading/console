import { describe, expect, it } from "vitest";

import type { Wallet } from "../engine/wallet";
import { MonkeySession, WalletQueue } from "./wallet-queue";

const wallet = (): Wallet => ({ address: "0x00", label: "w", sign: async () => "", deposit: async () => "", claim: async () => "" });

/** A task that settles when `release` is called. */
function gate() {
  let release: () => void = () => {};
  const open = new Promise<void>((resolve) => { release = resolve; });
  return { open, release };
}

describe("WalletQueue", () => {
  it("runs one wallet's work in the order it was queued, one at a time", async () => {
    const queue = new WalletQueue();
    const w = wallet();
    const order: string[] = [];
    const first = gate();
    const read = queue.read(w, false, 1, async () => { order.push("read start"); await first.open; order.push("read end"); });
    const sent = queue.transaction(w, async () => { order.push("send"); return "sent"; });
    await Promise.resolve();
    expect(order).toEqual(["read start"]);
    first.release();
    await Promise.all([read, sent]);
    expect(order).toEqual(["read start", "read end", "send"]);
  });

  it("does not make one wallet wait for another's", async () => {
    const queue = new WalletQueue();
    const a = wallet();
    const b = wallet();
    const stuck = gate();
    void queue.read(a, false, 1, () => stuck.open);
    let ran = false;
    await queue.read(b, false, 1, async () => { ran = true; });
    expect(ran).toBe(true);
    stuck.release();
  });

  it("lets a read serve a later one of the same opening until it settles, but not another opening's, and not a fresh one once it has started", async () => {
    const queue = new WalletQueue();
    const w = wallet();
    const first = gate();
    let runs = 0;
    const task = async () => { runs += 1; await first.open; };
    const one = queue.read(w, false, 1, task);
    const joined = [queue.read(w, false, 1, task), queue.read(w, true, 1, task)]; // the second has not started: it will sample after whatever runs now
    await Promise.resolve();
    joined.push(queue.read(w, false, 1, task));
    first.release();
    await Promise.all([one, ...joined]);
    expect(runs).toBe(1);
    // Another opening's read, and a fresh one once the first has started, each run their own.
    const second = gate();
    const next = [queue.read(w, false, 1, async () => { runs += 1; await second.open; })];
    await Promise.resolve();
    await Promise.resolve();
    next.push(queue.read(w, false, 2, async () => { runs += 1; }), queue.read(w, true, 1, async () => { runs += 1; }));
    second.release();
    await Promise.all(next);
    expect(runs).toBe(4);
  });

  it("serves no read from one that has settled", async () => {
    const queue = new WalletQueue();
    const w = wallet();
    let runs = 0;
    await queue.read(w, false, 1, async () => { runs += 1; });
    await queue.read(w, false, 1, async () => { runs += 1; });
    expect(runs).toBe(2);
  });

  it("refuses a second transaction while one waits or runs, even with a read queued between them, and takes one again once it has settled", async () => {
    const queue = new WalletQueue();
    const w = wallet();
    const hold = gate();
    const slow = queue.read(w, false, 1, () => hold.open);
    const first = queue.transaction(w, async () => "one");
    void queue.read(w, true, 1, async () => undefined);
    expect(await queue.transaction(w, async () => "two")).toBeNull();
    hold.release();
    expect(await first).toBe("one");
    await slow;
    expect(await queue.transaction(w, async () => "three")).toBe("three");
  });

  it("keeps going after a transaction fails, and hands the failure to its caller", async () => {
    const queue = new WalletQueue();
    const w = wallet();
    await expect(queue.transaction(w, async () => { throw new Error("declined"); })).rejects.toThrow("declined");
    expect(await queue.transaction(w, async () => "again")).toBe("again");
  });
});

describe("MonkeySession", () => {
  it("numbers page openings so that no two, in any panel, share one", () => {
    const session = new MonkeySession();
    const numbers = [session.nextOpening(), session.nextOpening(), session.nextOpening()];
    expect(new Set(numbers).size).toBe(3);
  });
});
