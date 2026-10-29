/** Tests for a WalletConnect session's life: one request at a time, a pairing after a cancel or a disconnect, and the wallet ending it. */

import { describe, expect, it } from "vitest";

import { settle } from "./test-kit";
import { connected, deferred, session, setup, URI } from "./walletconnect-kit";

describe("a WalletConnect session", () => {
  it("sends the wallet one request at a time, the next only once the one before has its answer", async () => {
    const { wallet, fake } = await connected();
    const first = deferred<unknown>();
    const answers = [first.promise, Promise.resolve(`0x${"0".repeat(63)}1`)];
    fake.request = async (args, chain) => {
      fake.requests.push({ method: args.method, params: args.params, chain });
      return answers.shift();
    };
    const reads = [wallet.claimed(1), wallet.claimed(2)];
    await settle();
    expect(fake.requests).toHaveLength(1);
    first.resolve(`0x${"0".repeat(64)}`);
    await expect(Promise.all(reads)).resolves.toEqual([false, true]);
    expect(fake.requests).toHaveLength(2);
  });

  it("tells the console when the wallet app ends the live session", async () => {
    let ended = 0;
    const env = setup(() => void (ended += 1));
    const connecting = env.connector.connect();
    await env.fake.called.promise;
    env.fake.pending.resolve(session("topic-1"));
    await connecting;
    env.fake.deleteSession();
    expect(ended).toBe(1);
  });

  it("leaves a newer pairing's relay socket open when a cancelled one's link or approval comes late", async () => {
    const { connector, fake, states } = setup();
    const first = connector.connect();
    await fake.called.promise;
    connector.cancel();
    await expect(first).rejects.toThrow("You closed the WalletConnect pairing");
    await settle();
    const firstApproval = fake.pending;
    fake.pending = deferred();
    fake.called = deferred();
    const second = connector.connect();
    await fake.called.promise;
    const closes = fake.closes;
    // The second pairing's link reaches both attempts' listeners; only the second shows it.
    fake.emit("display_uri", URI);
    expect(states.at(-1)).toEqual({ status: "ready", uri: URI });
    // The first pairing's approval arrives late: its session ends, the socket stays for the second.
    firstApproval.resolve(session("late"));
    await settle();
    expect(fake.closes).toBe(closes);
    fake.pending.resolve(session("topic-2"));
    await expect(second).resolves.toMatchObject({ label: "WalletConnect" });
  });

  it("waits for a disconnect's end of session before it pairs again", async () => {
    const { wallet, connector, fake } = await connected();
    const ending = deferred<void>();
    fake.disconnect = async () => {
      await ending.promise;
      fake.disconnects += 1;
      fake.session = undefined;
    };
    const disconnecting = wallet.disconnect?.();
    fake.called = deferred();
    fake.pending = deferred();
    const again = connector.connect();
    await settle();
    expect(fake.connects).toHaveLength(1);
    ending.resolve();
    await disconnecting;
    await fake.called.promise;
    expect([fake.connects.length, fake.disconnects, fake.closes]).toEqual([2, 1, 1]);
    fake.pending.resolve(session("topic-2"));
    await expect(again).resolves.toMatchObject({ label: "WalletConnect" });
  });
});
