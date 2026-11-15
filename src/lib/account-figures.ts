/**
 * The account figures the Funding page and the ticket show. From V64 the node's read gives the initial
 * requirement (each margin band at least the tier's floor) and the cash a withdrawal may take; they
 * replace the console's own sums, which only know the market's bands. A node that predates the read has
 * neither, and the figures come from `margin` as before.
 */

import type { Fixed } from "./fixed";
import type { AccountModel } from "./models";
import { withdrawableNow, withdrawLimitCause } from "./vault";

type Funds = Pick<AccountModel, "balance" | "unfinalised" | "equity" | "margin" | "requirements">;

/** What fills that add risk and withdrawals must leave equity above: the node's initial requirement, else the margin. */
export function requirementOf(account: Funds): Fixed {
  return account.requirements?.initialMargin ?? account.margin;
}

/** Equity above the requirement, or zero. */
export function freeCash(account: Funds): Fixed {
  const free = account.equity - requirementOf(account);
  return free < 0n ? 0n : free;
}

/** What may be withdrawn now: the node's own figure, else the smaller of the unlocked cash and the equity above margin. */
export function withdrawableOf(account: Funds): Fixed {
  return account.requirements?.withdrawable ?? withdrawableNow(account.balance, account.equity, account.margin, account.unfinalised);
}

/** What holds a withdrawal below the balance, as `withdrawLimitCause` says, with the requirement the node's tier sets. */
export function withdrawCause(account: Funds): "unfinal" | "margin" | null {
  return withdrawLimitCause(account.balance, account.equity, requirementOf(account), account.unfinalised);
}
