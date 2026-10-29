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
    ? `The console asks it to sign only for the enclave of release ${attestation.release}.`
    : attestation.kind === "mock"
      ? "The console asks it to sign only for a development node whose mock attestation proves no enclave."
      : "The console asks it to sign nothing until the node's attestation verifies.";
  return (
    <p className="text-label leading-relaxed text-fg-3">
      Your wallet signs for chain {chainId} and vault <span title={vault} className="text-fg-2">{shortHex(vault)}</span>. {node}
    </p>
  );
}
