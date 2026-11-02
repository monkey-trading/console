import { decodeFunctionData, encodeAbiParameters, parseAbi, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import { ProviderStaking } from "./provider-staking";
import type { Eip1193Provider, WalletChain } from "./provider-wallet";

const ME = "0x00000000000000000000000000000000000000aa";
const TOKEN = "0x00000000000000000000000000000000000000bb";
const STAKING = "0x00000000000000000000000000000000000000cc";
const VAULT = "0x00000000000000000000000000000000000000dd";
const CHAIN: WalletChain = { chainId: 31337, vault: VAULT, usdc: null, add: null, staking: STAKING };
const ABI = parseAbi([
  "function stakes(address) view returns (uint256)",
  "function unstakes(address) view returns (uint256 amount, uint256 claimableAt)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function distributionsClaimed(address) view returns (uint256)",
  "function latestSeq() view returns (uint64)",
  "function monkey() view returns (address)",
  "function approve(address, uint256) returns (bool)",
  "function stake(uint256)",
  "function startUnstake(uint256)",
  "function completeUnstake()",
  "function claimDistribution(address, uint256, bytes32[]) returns (uint256)",
]);

interface World { balance: bigint; allowance: bigint; staked: bigint; pending: [bigint, bigint]; paid: bigint; seq: bigint; chainId: number }

/** A provider that answers the contracts' reads from `world` and records the order of every call. */
function rig(world: World, chain: WalletChain = CHAIN, token: string = TOKEN) {
  const order: string[] = [];
  const sent: { to: string; name: string; args: readonly unknown[] }[] = [];
  const provider: Eip1193Provider = {
    async request({ method, params = [] }) {
      const list = Array.isArray(params) ? params : [];
      if (method === "eth_chainId") return `0x${world.chainId.toString(16)}`;
      if (method !== "eth_call") throw new Error(`unexpected ${method}`);
      const call = list[0] as { to: string; data: Hex };
      const { functionName } = decodeFunctionData({ abi: ABI, data: call.data });
      order.push(`${functionName}@${call.to}`);
      const uint = (value: bigint) => encodeAbiParameters([{ type: "uint256" }], [value]);
      switch (functionName) {
        case "monkey": return encodeAbiParameters([{ type: "address" }], [token as Hex]);
        case "stakes": return uint(world.staked);
        case "unstakes": return encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], world.pending);
        case "balanceOf": return uint(world.balance);
        case "allowance": return uint(world.allowance);
        case "distributionsClaimed": return uint(world.paid);
        case "latestSeq": return encodeAbiParameters([{ type: "uint64" }], [world.seq]);
        default: throw new Error(`unexpected call ${functionName}`);
      }
    },
  };
  const staking = new ProviderStaking(ME, chain, provider, {
    ensureChain: async () => {},
    send: async (to, data) => {
      const decoded = decodeFunctionData({ abi: ABI, data });
      sent.push({ to, name: decoded.functionName, args: decoded.args ?? [] });
      return "0xhash";
    },
  });
  return { staking, order, sent };
}

const WORLD: World = { balance: 500n, allowance: 0n, staked: 40n, pending: [0n, 0n], paid: 7n, seq: 9n, chainId: 31337 };

describe("ProviderStaking.position", () => {
  it("reads the stake, the unstake, the balance, the vault's payments and checkpoint, one call after another", async () => {
    const { staking, order } = rig({ ...WORLD, pending: [25n, 1_700_000_000n] });
    expect(await staking.position()).toEqual({ stakingEnabled: true, staked: 40n, unstaking: { amount: 25n, claimableAtMs: 1_700_000_000_000 }, balance: 500n, distributionsClaimed: 7n, latestSeq: 9 });
    expect(order).toEqual([`distributionsClaimed@${VAULT}`, `latestSeq@${VAULT}`, `stakes@${STAKING}`, `unstakes@${STAKING}`, `monkey@${VAULT}`, `balanceOf@${TOKEN}`]);
  });

  it("reports no unstake when the contract holds none", async () => {
    expect((await rig(WORLD).staking.position()).unstaking).toBeNull();
  });

  it("refuses to read while the wallet is on another chain", async () => {
    await expect(rig({ ...WORLD, chainId: 1 }).staking.position()).rejects.toThrow("on chain 1, not chain 31337");
  });

  it("still reads the vault's payments and checkpoint and the wallet's balance when the build names no staking contract", async () => {
    const { staking, order } = rig(WORLD, { ...CHAIN, staking: null });
    expect(await staking.position()).toEqual({ stakingEnabled: false, staked: 0n, unstaking: null, balance: 500n, distributionsClaimed: 7n, latestSeq: 9 });
    expect(order.some((call) => call.includes(STAKING))).toBe(false);
  });

  it("reads no balance, and does not remember the zero address, while the vault has no token", async () => {
    const { staking, order } = rig(WORLD, CHAIN, "0x0000000000000000000000000000000000000000");
    expect((await staking.position()).balance).toBe(0n);
    await staking.position();
    expect(order.filter((call) => call.startsWith("monkey@"))).toHaveLength(2);
    expect(order.some((call) => call.startsWith("balanceOf"))).toBe(false);
  });
});

describe("ProviderStaking transactions", () => {
  it("approves the staking contract for the amount before staking when the allowance is short", async () => {
    const { staking, sent } = rig(WORLD);
    await staking.stake(100n);
    expect(sent.map((tx) => [tx.name, tx.to])).toEqual([["approve", TOKEN], ["stake", STAKING]]);
    expect(sent[0]?.args).toEqual([STAKING, 100n]);
    expect(sent[1]?.args).toEqual([100n]);
  });

  it("skips the approval when the allowance covers it", async () => {
    const { staking, sent } = rig({ ...WORLD, allowance: 100n });
    await staking.stake(100n);
    expect(sent.map((tx) => tx.name)).toEqual(["stake"]);
  });

  it("refuses to stake, or unstake, when the build names no staking contract", async () => {
    const { staking, sent } = rig(WORLD, { ...CHAIN, staking: null });
    await expect(staking.stake(1n)).rejects.toThrow("names no staking contract");
    await expect(staking.startUnstake(1n)).rejects.toThrow("names no staking contract");
    expect(sent).toEqual([]);
  });

  it("refuses to stake while the vault has no token", async () => {
    const { staking, sent } = rig(WORLD, CHAIN, "0x0000000000000000000000000000000000000000");
    await expect(staking.stake(1n)).rejects.toThrow("not deployed its MONKEY token");
    expect(sent).toEqual([]);
  });

  it("refuses to stake more than the wallet holds, and nothing", async () => {
    const { staking, sent } = rig(WORLD);
    await expect(staking.stake(501n)).rejects.toThrow("less MONKEY");
    await expect(staking.stake(0n)).rejects.toThrow("more than zero");
    expect(sent).toEqual([]);
  });

  it("sends the unstake calls to the staking contract", async () => {
    const { staking, sent } = rig(WORLD);
    await staking.startUnstake(5n);
    await staking.completeUnstake();
    expect(sent.map((tx) => [tx.name, tx.to])).toEqual([["startUnstake", STAKING], ["completeUnstake", STAKING]]);
  });

  it("claims a distribution on the vault with the proof's amount and siblings, and only for its own account", async () => {
    const { staking, sent } = rig(WORLD);
    const sibling = `0x${"11".repeat(32)}`;
    await staking.claimDistribution({ seq: 9, root: `0x${"22".repeat(32)}`, account: ME, entitled: "123", siblings: [sibling] });
    expect(sent[0]?.to).toBe(VAULT);
    expect(sent[0]?.name).toBe("claimDistribution");
    // viem decodes addresses checksummed.
    expect(String(sent[0]?.args[0]).toLowerCase()).toBe(ME);
    expect(sent[0]?.args.slice(1)).toEqual([123n, [sibling]]);
    await expect(staking.claimDistribution({ seq: 9, root: "0x", account: "0x00000000000000000000000000000000000000ee", entitled: "1", siblings: [] })).rejects.toThrow("another account");
    await expect(staking.claimDistribution({ seq: 9, root: "0x", account: ME, entitled: "0", siblings: [] })).rejects.toThrow("nothing to claim");
  });
});
