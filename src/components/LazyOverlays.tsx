"use client";

/**
 * The two modal dialogs the shell carries, loaded after the page has painted (monkey-trading/console#338):
 * both are closed until a wallet pairs or a connected account needs setting up, and the pairing dialog's
 * QR encoder and the setup steps are code no first paint runs.
 */

import dynamic from "next/dynamic";

const WalletConnectPairing = dynamic(() => import("./WalletConnectPairing").then((module) => module.WalletConnectPairing), { ssr: false });
const SetupDialog = dynamic(() => import("./SetupDialog").then((module) => module.SetupDialog), { ssr: false });

export function LazyOverlays() {
  return (
    <>
      <WalletConnectPairing />
      <SetupDialog />
    </>
  );
}
