"use client";

/** A compact line saying what the console found when it checked the node's attestation. */

import { useConsole } from "./ConsoleProvider";

export function AttestationBanner() {
  const { attestation } = useConsole();
  if (attestation.kind === "checking") {
    return <div role="status" className="border-b border-line px-4 py-1 text-center text-label text-fg-3">Checking the node's attestation…</div>;
  }
  if (attestation.kind === "mock") {
    return (
      <div role="status" className="border-b border-amber/40 bg-amber/10 px-4 py-1 text-center text-label text-amber">
        <strong className="font-medium">Mock attestation accepted.</strong> Simulated node in your browser, not an enclave: prices, fills and funds are not real.
      </div>
    );
  }
  return (
    <div role="alert" className="border-b border-alarm/50 bg-alarm/10 px-4 py-1 text-center text-label text-alarm">
      <strong className="font-medium">Attestation not verified: the console will not sign.</strong> {attestation.reason}
    </div>
  );
}
