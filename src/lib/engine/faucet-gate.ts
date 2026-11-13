/** What the faucet's gate and the setup popup need of it, apart from the transport code (and its ABI encoding) that only a funding request runs. */

import { fixedFromInt, type Fixed } from "../fixed";
import type { Deploy } from "./deploy";

/** The demo amount the faucet mints: 10,000 USDC. */
export const FAUCET_USDC: Fixed = fixedFromInt(10_000);

/** Whether this build shows the faucet: a live-dev deployment naming the mock USDC and the Anvil RPC. */
export function faucetAvailable(deploy: Deploy): boolean {
  return deploy.mode === "live-dev" && deploy.usdc !== null && deploy.rpcUrl !== null;
}
