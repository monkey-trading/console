import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emissionsClaimedRead } from "./provider-monkey";
import { ProviderDeployment } from "./provider-registry";
import { ProviderStaking } from "./provider-staking";
import { ProviderWallet, type Eip1193Provider } from "./provider-wallet";
import { CHAIN } from "./provider-wallet-fixtures";
import { serialized, WALLET_READ_MS, withinMs } from "./serialized-provider";
import { ACCOUNT, StubProvider } from "./wallet-kit";

const FOREVER = (): Promise<unknown> => new Promise(() => undefined);
const LATER = 10 * WALLET_READ_MS;

/** Whether `read` has settled by the time the timers have run `ms`. */
async function settledWithin(read: Promise<unknown>, ms: number): Promise<boolean> {
  let settled = false;
  void read.then(() => { settled = true; }, () => { settled = true; });
  await vi.advanceTimersByTimeAsync(ms);
  return settled;
}

describe("a read a wallet never answers", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  /** A provider that leaves its first request unanswered, and answers the rest. */
  function stallingFirst(): Eip1193Provider {
    const stub = new StubProvider({ latestSeq: 7 });
    let asked = 0;
    return { request: (args) => { asked += 1; return asked === 1 ? (FOREVER() as never) : stub.request(args); } };
  }
  const wallet = (provider: Eip1193Provider) => new ProviderWallet(ACCOUNT, "Test wallet", provider, CHAIN, { wait: async () => {} });

  it.each<[string, (provider: Eip1193Provider) => Promise<unknown>]>([
    ["the vault's read for the operator registry", (provider) => new ProviderDeployment(CHAIN, provider).vault()],
    ["the staking position", (provider) => new ProviderStaking(ACCOUNT, CHAIN, provider, { ensureChain: async () => undefined, send: async () => "0x" }).position()],
    ["the MONKEY record", (provider) => emissionsClaimedRead(ACCOUNT, CHAIN, provider)],
    ["a payout's record", (provider) => wallet(provider).claimed(1)],
  ])("gives up %s, and frees the exit read behind it", async (_name, read) => {
    const provider = serialized(stallingFirst());
    const stuck = read(provider);
    const exitRead = withinMs(provider, { method: "eth_chainId" }, WALLET_READ_MS);
    expect(await settledWithin(stuck, WALLET_READ_MS)).toBe(true);
    await expect(stuck).rejects.toThrow("did not answer");
    expect(await settledWithin(exitRead, 0)).toBe(true);
    await expect(exitRead).resolves.toBeDefined();
  });

  describe("ensureChain", () => {
    /** A wallet on another chain that switches when asked, then does as `after` says when its chain is read again. */
    function switching(after: () => Promise<unknown>): Eip1193Provider {
      let moved = false;
      return {
        request: ({ method }) => {
          if (method === "wallet_switchEthereumChain") {
            moved = true;
            return Promise.resolve(null) as never;
          }
          if (method === "eth_chainId") return (moved ? after() : Promise.resolve("0x1")) as never;
          throw new Error(`no ${method}`);
        },
      };
    }
    it("gives up the chain read after a switch that went through, and frees what is behind it", async () => {
      let answered = false;
      const provider = serialized(switching(() => { if (answered) return Promise.resolve(`0x${CHAIN.chainId.toString(16)}`); answered = true; return FOREVER(); }));
      const moving = wallet(provider).ensureChain();
      moving.catch(() => undefined);
      expect(await settledWithin(moving, WALLET_READ_MS)).toBe(true);
      await expect(moving).rejects.toThrow("did not answer");
      await expect(withinMs(provider, { method: "eth_chainId" }, WALLET_READ_MS)).resolves.toBe(`0x${CHAIN.chainId.toString(16)}`);
    });
    it("leaves the switch itself unbounded, as it waits on the trader", async () => {
      const provider = serialized({ request: ({ method }) => (method === "eth_chainId" ? Promise.resolve("0x1") : FOREVER()) as never });
      expect(await settledWithin(wallet(provider).ensureChain(), LATER)).toBe(false);
    });
  });
});
