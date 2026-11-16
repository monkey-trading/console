"use client";

/** The dev-only faucet: in a live-dev build, funds the connected wallet from Anvil. */

import { faucetAvailable } from "@/lib/engine/faucet-gate";
import { fundWithAnvil } from "@/lib/store/actions";

import { useConsole, useSession } from "./ConsoleProvider";
import { Notice } from "./Notice";

/** Shown in the Deposit tab only in a `live-dev` build; nothing renders in mock or production builds. */
export function FaucetCard() {
  const { store, deploy } = useSession();
  const { wallet, busy } = useConsole();
  if (!faucetAvailable(deploy)) return null;
  const readOnly = wallet?.readOnly === true;
  const able = wallet !== null && !readOnly && !busy;
  return (
    <section aria-labelledby="faucet-title" className="p-4">
      <h4 id="faucet-title" className="text-label tracking-caps text-fg-3 uppercase">Test faucet</h4>
      <p className="mt-3 text-caption text-fg-2">
        The test faucet adds 10,000 test USDC to the connected wallet and tops up its gas balance to 1 ETH, directly from the local test chain. Your wallet is not asked to sign anything, and the faucet is available only in test versions of the app.
      </p>
      <button
        type="button"
        onClick={() => { if (able) void fundWithAnvil(store, deploy); }}
        aria-disabled={!able}
        className="mt-4 min-h-11 rounded border border-glow bg-glow/10 px-4 py-2.5 text-caption text-glow hover:bg-glow/20 focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:border-line-2 aria-disabled:bg-transparent aria-disabled:text-fg-3 lg:min-h-0"
      >
        Get test funds
      </button>
      <Notice surface="faucet" />
      {!wallet && <p className="mt-2 text-label text-fg-3">Connect a wallet to use the faucet.</p>}
      {readOnly && <p className="mt-2 text-label text-fg-3">You are viewing this account in read-only mode, so the faucet cannot fund it.</p>}
    </section>
  );
}
