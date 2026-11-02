/** The vault's deposits to the wallet's account in the last few blocks, read through the wallet's own provider: a hint of what the node has yet to credit, never a figure the console signs or sends on. */

import { decodeEventLog, encodeAbiParameters, parseAbi, toEventSelector } from "viem";

import { USDC_UNIT } from "../vault";
import type { Fixed } from "../fixed";
import { withinMs } from "./serialized-provider";
import type { Eip1193Provider, WalletChain } from "./provider-wallet";
import { hexOf } from "./provider-wallet";
import type { Address } from "./types";

const VAULT_EVENTS = parseAbi(["event Deposited(uint256 indexed id, address indexed account, address indexed from, uint256 amount)"]);

/** One `Deposited` event of the vault: its id, which the node's custody receipt names too, and its amount. */
export interface VaultDeposit {
  id: string;
  amount: Fixed;
}

/** How long the wallet may take over each of the three calls, in milliseconds. */
export const DEPOSIT_CALL_MS = 8_000;

/**
 * How many blocks back a read looks: the minutes a deposit stays between its transaction and the node's
 * credit, a few thousand blocks on a chain that makes one a second and fewer minutes on one that makes
 * four, and within the range providers allow one `eth_getLogs` call.
 */
export const DEPOSIT_BLOCKS = 5_000;

/**
 * The deposits made to `account`, whoever paid, in the last `DEPOSIT_BLOCKS` blocks, or null when they cannot be
 * read: the wallet sits on another chain (`eth_chainId` says before anything else is asked, and it is never asked to
 * switch), the build names no vault, it answers too slowly or unreadably, or its provider refuses the range.
 */
export async function vaultDepositsRead(account: Address, chain: WalletChain, provider: Eip1193Provider): Promise<VaultDeposit[] | null> {
  try {
    if (Number(await withinMs(provider, { method: "eth_chainId" }, DEPOSIT_CALL_MS)) !== chain.chainId) return null;
    const latest = BigInt(String(await withinMs(provider, { method: "eth_blockNumber" }, DEPOSIT_CALL_MS)));
    const from = latest > BigInt(DEPOSIT_BLOCKS) ? latest - BigInt(DEPOSIT_BLOCKS) : 0n;
    const logs = await withinMs(provider, {
      method: "eth_getLogs",
      params: [{ address: chain.vault, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${latest.toString(16)}`, topics: [toEventSelector(VAULT_EVENTS[0]), null, topicOf(account)] }],
    }, DEPOSIT_CALL_MS);
    if (!Array.isArray(logs)) return null;
    return logs.map((log: { topics: `0x${string}`[]; data: `0x${string}` }) => {
      const { args } = decodeEventLog({ abi: VAULT_EVENTS, data: log.data, topics: log.topics as [`0x${string}`, ...`0x${string}`[]] });
      return { id: args.id.toString(), amount: args.amount * USDC_UNIT };
    });
  } catch {
    return null;
  }
}

/** An address as an indexed event topic: left-padded to 32 bytes. */
function topicOf(address: Address): `0x${string}` {
  return encodeAbiParameters([{ type: "address" }], [hexOf(address)]);
}
