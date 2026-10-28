/** What the vault accepts, which the console and the mock both state. */

import { fixedFromInt, type Fixed } from "./fixed";

/** The vault accepts deposits of 10 to 1e9 USDC, as the contract does. */
export const MIN_DEPOSIT: Fixed = fixedFromInt(10);
export const MAX_DEPOSIT: Fixed = fixedFromInt(1_000_000_000);

/** The least a withdrawal may reserve, as the engine's latest protocol requires: 10 USDC. */
export const MIN_WITHDRAWAL: Fixed = fixedFromInt(10);

/** One USDC base unit (six decimals) in the nine-decimal representation. */
export const USDC_UNIT: Fixed = 1_000n;

/** Whether `amount` is a whole number of USDC base units, the finest a transfer can carry. */
export function isWholeUsdc(amount: Fixed): boolean {
  return amount % USDC_UNIT === 0n;
}

/** What an account may withdraw: the smaller of its unlocked cash and its equity above margin. */
export function withdrawableNow(balance: Fixed, equity: Fixed, margin: Fixed, locked: Fixed = 0n): Fixed {
  const cash = balance - locked;
  const free = equity - margin;
  const most = cash < free ? cash : free;
  return most > 0n ? most : 0n;
}
