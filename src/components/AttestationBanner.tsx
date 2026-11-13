"use client";

/** Compact lines saying what the console found when it checked the node, and what it cannot vouch for. */

import { shortHex } from "@/lib/format";
import { CONNECT_TO_CHECK } from "@/lib/engine/trust-errors";
import { describeMockAttestation, describeReverifying } from "@/lib/messages";

import { recheckNode } from "@/lib/store/node-move";

import { useConsole, useNodeFollow, useSession } from "./ConsoleProvider";

const LINE = "border-b px-4 py-1 text-center text-label";
const WARN = `${LINE} border-amber/40 bg-amber/10 text-amber`;
const BAD = `${LINE} border-ember/50 bg-ember/10 text-ember`;

export function AttestationBanner() {
  const { attestation, stream, signatures, notices } = useConsole();
  return (
    <section aria-label="Node attestation">
      <Status attestation={attestation} signatures={signatures} />
      <NodeLine />
      {stream === "stale" && attestation.kind !== "unverified" && (
        <div role="alert" className={BAD}>
          <strong className="font-medium">The node&apos;s feed is stale.</strong> It stopped or failed a check, so orders are disabled until it recovers.{notices.feed !== undefined && <> Last problem: {notices.feed.text}</>}
        </div>
      )}
    </section>
  );
}

/** What the chain says about the node, when it says something other than the node in use. */
function NodeLine() {
  const follow = useNodeFollow();
  if (follow === null) return null;
  switch (follow.kind) {
    case "pinned":
    case "following":
      return null;
    case "failed":
      return <div role="status" className={WARN}><strong className="font-medium">The console could not read who the operator is.</strong> It stays on {new URL(follow.origin).host} and tries again: {follow.reason}<CheckAgain /></div>;
    case "unlisted":
      return <div role="alert" className={BAD}><strong className="font-medium">This console needs updating.</strong> The elected operator{follow.hostname === null ? " registered no plain hostname" : `'s host, ${follow.hostname}, is not one this build lists`}, so the console does not connect to it.</div>;
    case "waiting":
      return <div role="status" className={WARN}><strong className="font-medium">The operator is changing.</strong> The console stays on {new URL(follow.origin).host} until {new URL(follow.target).host} verifies: {follow.reason}</div>;
    default:
      return follow satisfies never;
  }
}

/** The check of the vault's release through the wallet: what a wallet that left the chain and came back asks for. */
function CheckAgain() {
  const { store, follower } = useSession();
  return <button type="button" onClick={() => void recheckNode(store, follower)} className="ml-2 min-h-6 rounded border border-amber/60 px-1.5 hover:bg-amber/20 focus-visible:outline-2 focus-visible:outline-glow">Check again</button>;
}

function Status({ attestation, signatures }: { attestation: ReturnType<typeof useConsole>["attestation"]; signatures: ReturnType<typeof useConsole>["signatures"] }) {
  const mock = describeMockAttestation(signatures);
  const reverifying = describeReverifying();
  switch (attestation.kind) {
    case "checking":
      return <div role="status" className={`${LINE} border-line text-fg-3`}>Checking the node&apos;s attestation…</div>;
    case "reverifying":
      return <div role="status" className={WARN}><strong className="font-medium">{reverifying.lead}</strong> {reverifying.rest}</div>;
    case "mock":
      return <div role="status" className={WARN}><strong className="font-medium">{mock.lead}</strong> {mock.rest}</div>;
    case "verified":
      return (
        <div role="status" className={`${LINE} border-line text-fg-3`}>
          <strong className="font-medium text-glow">Attestation verified.</strong> Release {attestation.release}, enclave <span title={attestation.address}>{shortHex(attestation.address)}</span>.
        </div>
      );
    case "attested":
      return (
        <div role="status" className={WARN}>
          <strong className="font-medium">Node&apos;s code verified.</strong> Release {attestation.release}, enclave <span title={attestation.address}>{shortHex(attestation.address)}</span>. {attestation.why}
          {attestation.why !== CONNECT_TO_CHECK && <CheckAgain />}
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
