"use client";

/** The dev-only faucet: in a live-dev build, funds the connected wallet from Anvil. */

import { faucetAvailable } from "@/lib/engine/faucet";
import { fundWithAnvil } from "@/lib/store/actions";

import { useConsole, useSession } from "./ConsoleProvider";

/** Shown by the Funding drawer only in a `live-dev` build; nothing renders in mock or production builds. */
export function FaucetCard() {
  const { store, deploy } = useSession();
  const { wallet, busy } = useConsole();
  if (!faucetAvailable(deploy)) return null;
  const readOnly = wallet?.readOnly === true;
  const able = wallet !== null && !readOnly && !busy;
  return (
    <section aria-labelledby="faucet-title" className="rounded-xl border border-line-2 bg-ink-1 p-5">
      <h2 id="faucet-title" className="text-label tracking-caps text-fg-3 uppercase">Dev faucet</h2>
      <p className="mt-4 text-caption text-fg-2">
        Mint 10,000 mock USDC to the connected wallet and top its gas up to 1 ETH, straight from the local Anvil chain. Dev builds only; the mint asks the wallet first.
      </p>
      <button
        type="button"
        onClick={() => { if (able) void fundWithAnvil(store, deploy); }}
        aria-disabled={!able}
        className="mt-4 min-h-11 rounded border border-glow bg-glow/10 px-4 py-2.5 text-caption text-glow hover:bg-glow/20 focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:border-line-2 aria-disabled:bg-transparent aria-disabled:text-fg-3 lg:min-h-0"
      >
        Fund with Anvil
      </button>
      {!wallet && <p className="mt-2 text-label text-fg-3">Connect a wallet first.</p>}
      {readOnly && <p className="mt-2 text-label text-fg-3">The watched account is read-only, so the faucet cannot fund it.</p>}
    </section>
  );
}
