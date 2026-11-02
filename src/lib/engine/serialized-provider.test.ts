import { describe, expect, it, vi } from "vitest";

import { fixedFromInt } from "../fixed";
import { CHAIN } from "./provider-wallet-fixtures";
import { InjectedConnector } from "./injected";
import { ProviderWallet } from "./provider-wallet";
import { serialized, withinMs } from "./serialized-provider";
import { ACCOUNT, StubProvider } from "./wallet-kit";
import type { Eip1193Provider } from "./provider-wallet";

/** A provider whose requests each wait for `release`, recording how many are outstanding at once. */
function slow() {
  const log: string[] = [];
  let outstanding = 0;
  let peak = 0;
  const releases: (() => void)[] = [];
  const provider: Eip1193Provider = {
    request: async ({ method }) => {
      log.push(`start ${method}`);
      outstanding += 1;
      peak = Math.max(peak, outstanding);
      await new Promise<void>((resolve) => releases.push(resolve));
      outstanding -= 1;
      log.push(`end ${method}`);
      if (method === "fails") throw new Error("refused");
      return method;
    },
  };
  return { provider, log, releases, peak: () => peak };
}

describe("serialized", () => {
  it("asks the wallet one request at a time, in the order they were made, whatever flow made them", async () => {
    const { provider, log, releases, peak } = slow();
    const wallet = serialized(provider);
    const first = wallet.request({ method: "eth_chainId" });
    const second = wallet.request({ method: "eth_sendTransaction" });
    const third = wallet.request({ method: "eth_call" });
    await Promise.resolve();
    expect(log).toEqual(["start eth_chainId"]);
    releases[0]?.();
    await first;
    await Promise.resolve();
    await Promise.resolve();
    releases[1]?.();
    await second;
    await Promise.resolve();
    await Promise.resolve();
    releases[2]?.();
    await third;
    expect(log).toEqual(["start eth_chainId", "end eth_chainId", "start eth_sendTransaction", "end eth_sendTransaction", "start eth_call", "end eth_call"]);
    expect(peak()).toBe(1);
  });

  it("goes on to the next request after one is refused, and hands the refusal to its asker alone", async () => {
    const { provider, releases } = slow();
    const wallet = serialized(provider);
    const refused = wallet.request({ method: "fails" });
    const next = wallet.request({ method: "eth_call" });
    await Promise.resolve();
    releases[0]?.();
    await expect(refused).rejects.toThrow("refused");
    await Promise.resolve();
    await Promise.resolve();
    releases[1]?.();
    await expect(next).resolves.toBe("eth_call");
  });
});

describe("a wallet over a provider that is busy", () => {
  it("does not start a chain read while a deposit's request is still unanswered, and reads once it is", async () => {
    const stub = new StubProvider({ balance: 10n ** 12n, allowance: 10n ** 12n, latestSeq: 7 });
    const asked: string[] = [];
    let outstanding = 0;
    let peak = 0;
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => { open = resolve; });
    const provider: Eip1193Provider = {
      request: async (args) => {
        asked.push(args.method);
        outstanding += 1;
        peak = Math.max(peak, outstanding);
        try {
          // The deposit's first request to the wallet is not answered until the gate opens.
          if (asked.length === 1) await gate;
          return await stub.request(args);
        } finally {
          outstanding -= 1;
        }
      },
    };
    const wallet = new ProviderWallet(ACCOUNT, "Test wallet", provider, CHAIN, { wait: async () => {} });
    const deposit = wallet.deposit(fixedFromInt(10));
    const reading = wallet.emissionsClaimed();
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    // The read's first request has not reached the wallet beside the deposit's unanswered one.
    expect(asked).toHaveLength(1);
    open();
    await deposit;
    expect(await reading).toEqual({ claimed: 0n, latestSeq: 7 });
    expect(peak).toBe(1);
  });
});

describe("a reconnect over the same browser provider", () => {
  /** A provider whose chain reads wait for `open`, recording how many requests are outstanding at once. */
  function holdingReads() {
    const stub = new StubProvider({ latestSeq: 7 });
    const asked: string[] = [];
    let outstanding = 0;
    let peak = 0;
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => { open = resolve; });
    const provider: Eip1193Provider = {
      request: async (args) => {
        asked.push(args.method);
        outstanding += 1;
        peak = Math.max(peak, outstanding);
        try {
          if (args.method === "eth_call") await gate;
          return await stub.request(args);
        } finally {
          outstanding -= 1;
        }
      },
    };
    return { provider, asked, open: () => open(), peak: () => peak };
  }
  const ticks = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

  it("does not ask the wallet for its account while the earlier wallet's chain read is unanswered", async () => {
    const { provider, asked, open, peak } = holdingReads();
    const connector = new InjectedConnector(() => provider, CHAIN, { wait: async () => {} });
    const first = await connector.connect();
    const reading = first.emissionsClaimed?.();
    await ticks();
    const reconnecting = connector.connect();
    await ticks();
    expect(asked.filter((m) => m === "eth_requestAccounts")).toHaveLength(1); // the reconnect's request is still waiting
    open();
    expect(await reading).toEqual({ claimed: 0n, latestSeq: 7 });
    const second = await reconnecting;
    expect(second.address).toBe(first.address);
    expect(peak()).toBe(1);
  });

  it("keeps the wallets of one connector to one queue, and a different provider to its own", async () => {
    const { provider, asked, open } = holdingReads();
    const other = new StubProvider();
    let current: Eip1193Provider = provider;
    const connector = new InjectedConnector(() => current, CHAIN, { wait: async () => {} });
    const first = await connector.connect();
    const reading = first.emissionsClaimed?.();
    await ticks();
    current = other; // the page now gives another provider, which owes nothing to the first
    await connector.connect();
    expect(other.calls.some((c) => c.method === "eth_requestAccounts")).toBe(true);
    expect(asked.filter((m) => m === "eth_call")).toHaveLength(1);
    open();
    await reading;
  });

  it("wraps a provider once: serializing a serialized provider returns it", () => {
    const once = serialized(new StubProvider());
    expect(serialized(once)).toBe(once);
  });
});

describe("requestWithin", () => {
  it("frees the queue for the next request once a read has gone unanswered for the bound, and refuses the read", async () => {
    vi.useFakeTimers();
    try {
      const asked: string[] = [];
      const wallet = serialized({ request: ({ method }) => { asked.push(method); return method === "eth_chainId" ? new Promise(() => {}) : Promise.resolve(method); } });
      const read = withinMs(wallet, { method: "eth_chainId" }, 1000);
      const sign = wallet.request({ method: "eth_signTypedData_v4" });
      const refused = expect(read).rejects.toThrow("did not answer in time");
      await vi.advanceTimersByTimeAsync(999);
      expect(asked).toEqual(["eth_chainId"]);
      await vi.advanceTimersByTimeAsync(1);
      await refused;
      expect(await sign).toBe("eth_signTypedData_v4");
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts its bound when the read reaches the wallet, not while it waits behind a prompt", async () => {
    vi.useFakeTimers();
    try {
      let answerPrompt!: (value: string) => void;
      const wallet = serialized({ request: ({ method }) => (method === "prompt" ? new Promise<string>((resolve) => { answerPrompt = resolve; }) : Promise.resolve(method)) });
      const prompt = wallet.request({ method: "prompt" });
      const read = withinMs(wallet, { method: "eth_chainId" }, 1000);
      await vi.advanceTimersByTimeAsync(60_000); // a user takes a minute over a prompt
      answerPrompt("signed");
      await prompt;
      expect(await read).toBe("eth_chainId");
    } finally {
      vi.useRealTimers();
    }
  });
});
