"use client";

/** Compact lines saying what the console found when it checked the node, and what it cannot vouch for. */

import { shortHex } from "@/lib/format";
import { describeMockAttestation } from "@/lib/messages";

import { useConsole } from "./ConsoleProvider";

const LINE = "border-b px-4 py-1 text-center text-label";
const WARN = `${LINE} border-amber/40 bg-amber/10 text-amber`;
const BAD = `${LINE} border-ember/50 bg-ember/10 text-ember`;

export function AttestationBanner() {
  const { attestation, stream, signatures } = useConsole();
  return (
    <section aria-label="Node attestation">
      <Status attestation={attestation} signatures={signatures} />
      {stream === "stale" && attestation.kind !== "unverified" && (
        <div role="alert" className={BAD}>
          <strong className="font-medium">The node&apos;s feed is stale.</strong> It stopped or failed a check (see the last message), so orders are disabled until it recovers.
        </div>
      )}
    </section>
  );
}

function Status({ attestation, signatures }: { attestation: ReturnType<typeof useConsole>["attestation"]; signatures: ReturnType<typeof useConsole>["signatures"] }) {
  const mock = describeMockAttestation(signatures);
  switch (attestation.kind) {
    case "checking":
      return <div role="status" className={`${LINE} border-line text-fg-3`}>Checking the node&apos;s attestation…</div>;
    case "reverifying":
      return <div role="status" className={WARN}><strong className="font-medium">Re-verifying the node.</strong> The enclave changed or an answer failed its check; nothing is shown as trusted until it passes.</div>;
    case "mock":
      return <div role="status" className={WARN}><strong className="font-medium">{mock.lead}</strong> {mock.rest}</div>;
    case "verified":
      return (
        <div role="status" className={`${LINE} border-line text-fg-3`}>
          <strong className="font-medium text-glow">Attestation verified.</strong> Release {attestation.release}, enclave <span title={attestation.address}>{shortHex(attestation.address)}</span>.
        </div>
      );
    case "clock":
      return <div role="alert" className={BAD}><strong className="font-medium">Your device clock is wrong.</strong> It differs from the node&apos;s signed time by {Math.round(Math.abs(attestation.skewMs) / 1000)} s. Correct it and reload; what is on screen is from before the check failed and will not update.</div>;
    case "unverified":
      return <div role="alert" className={BAD}><strong className="font-medium">Attestation not verified: the console will not sign.</strong> {attestation.reason}</div>;
    default:
      return attestation satisfies never;
  }
}
