"use client";

/** States the deployment every signature names (the custody chain and vault) and the node the console signs for. */

import { shortHex } from "@/lib/format";

import { useConsole, useSession } from "./ConsoleProvider";

export function SigningFor() {
  const { attestation } = useConsole();
  const { store } = useSession();
  const { chainId, vault } = store.deps.client.deployment;
  const node = attestation.kind === "verified"
    ? `the enclave of release ${attestation.release}`
    : attestation.kind === "mock"
      ? "a development node whose mock attestation proves no enclave"
      : "no node until its attestation verifies";
  return (
    <p className="text-label leading-relaxed text-fg-3">
      Your wallet signs for chain {chainId} and vault <span title={vault} className="text-fg-2">{shortHex(vault)}</span>, and the console signs only for {node}.
    </p>
  );
}
