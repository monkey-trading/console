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
    <section aria-label="Server verification">
      <Status attestation={attestation} signatures={signatures} />
      <NodeLine />
      {stream === "stale" && attestation.kind !== "unverified" && (
        <div role="alert" className={BAD}>
          <strong className="font-medium">Prices aren&apos;t updating, so trading is paused.</strong> It resumes once the connection to the server recovers.{notices.feed !== undefined && <> Last problem: {notices.feed.text}</>}
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
      return <div role="status" className={WARN}><strong className="font-medium">Couldn&apos;t check which server is current.</strong> Staying on {new URL(follow.origin).host} and trying again: {follow.reason}<CheckAgain /></div>;
    case "unlisted":
      return <div role="alert" className={BAD}><strong className="font-medium">This app needs updating.</strong> {follow.hostname === null ? "The current server hasn't registered a web address" : `The current server is at ${follow.hostname}, which this version of the app doesn't know`}, so the app won&apos;t connect to it.</div>;
    case "waiting":
      return <div role="status" className={WARN}><strong className="font-medium">The server is changing.</strong> You&apos;ll stay on {new URL(follow.origin).host} until {new URL(follow.target).host} is verified: {follow.reason}</div>;
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
      return <div role="status" className={`${LINE} border-line text-fg-3`}>Verifying the server…</div>;
    case "reverifying":
      return <div role="status" className={WARN}><strong className="font-medium">{reverifying.lead}</strong> {reverifying.rest}</div>;
    case "mock":
      return <div role="status" className={WARN}><strong className="font-medium">{mock.lead}</strong> {mock.rest}</div>;
    case "verified":
      return (
        <div role="status" className={`${LINE} border-line text-fg-3`}>
          <strong className="font-medium text-glow">Server verified.</strong> Release {attestation.release}, signing key <span title={attestation.address}>{shortHex(attestation.address)}</span>.
        </div>
      );
    case "attested":
      return (
        <div role="status" className={WARN}>
          <strong className="font-medium">Server&apos;s code verified.</strong> Release {attestation.release}, signing key <span title={attestation.address}>{shortHex(attestation.address)}</span>. {attestation.why}
          {attestation.why !== CONNECT_TO_CHECK && <CheckAgain />}
        </div>
      );
    case "clock":
      return <div role="alert" className={BAD}><strong className="font-medium">Your device clock is wrong.</strong> It&apos;s {Math.round(Math.abs(attestation.skewMs) / 1000)} seconds off the server&apos;s time. Correct it and reload the page. Until then, what&apos;s on screen won&apos;t update.</div>;
    case "unverified":
      return <div role="alert" className={BAD}><strong className="font-medium">The server couldn&apos;t be verified, so you can&apos;t trade or move funds.</strong> {attestation.reason}</div>;
    default:
      return attestation satisfies never;
  }
}
