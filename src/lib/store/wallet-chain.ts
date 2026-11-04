/** What the console says while the connected wallet is on another chain than the deployment's (monkey-trading/console#289). */

import { chainName } from "../engine/chains";
import type { ConsoleStore } from "./store";

/** Why the wallet's requests wait, as a sentence, or null while it is on the deployment's chain. */
export function offChain(store: ConsoleStore): string | null {
  const away = store.getSnapshot().walletChain;
  return away === null ? null : chainAway(away, store.deps.client.deployment.chainId);
}

/** `Your wallet is on Ethereum, not Anvil. Switch it back to Anvil to continue.` */
export const chainAway = (away: number, want: number | null): string => `Your wallet is on ${chainName(away)}, not ${chainName(want)}. Switch it back to ${chainName(want)} to continue.`;
