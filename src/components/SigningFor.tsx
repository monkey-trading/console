"use client";

/** States the deployment every signature names (the custody chain and vault) and the node the console signs for. */

import { shortHex } from "@/lib/format";

import { useConsole, useSession } from "./ConsoleProvider";

/** One line under the controls that ask the wallet to sign. */
export function SigningFor() {
  const { attestation } = useConsole();
  const { store } = useSession();
  const { chainId, vault } = store.deps.client.deployment;
  const node = attestation.kind === "verified"
    ? `Your wallet is only asked to sign for the verified server running release ${attestation.release}.`
    : attestation.kind === "mock"
      ? "Your wallet is only asked to sign for a test server that can't be verified."
      : attestation.kind === "attested"
        ? "Your wallet won't be asked to sign anything until this server has been checked against the vault."
        : "Your wallet won't be asked to sign anything until the server is verified.";
  return (
    <p className="text-label leading-relaxed text-fg-3">
      Every signature, from your wallet or this browser&rsquo;s session key, is for chain {chainId} and vault <span title={vault} className="text-fg-2">{shortHex(vault)}</span> only. {node}
    </p>
  );
}
