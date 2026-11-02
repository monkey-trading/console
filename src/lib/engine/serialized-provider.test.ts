import { describe, expect, it } from "vitest";

import { fixedFromInt } from "../fixed";
import { CHAIN } from "./provider-wallet-fixtures";
import { ProviderWallet } from "./provider-wallet";
import { serialized } from "./serialized-provider";
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
