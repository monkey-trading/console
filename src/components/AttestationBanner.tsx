"use client";

/**
 * Compact lines saying what the console found when it checked the node, what it cannot vouch for, and what the server says is wrong.
 * While trading is paused for a change of trading server, the trading page's panel says so and this says nothing; other pages carry
 * one line. A move with no pause, as when a page load finds the current server elsewhere, is one calm line, and a drop the follower is
 * still reading is not called an outage yet.
 */

import { usePathname } from "next/navigation";

import { asSentence, shortHex } from "@/lib/format";
import { pauseLine, serverLine, switchLine, type ServerLine } from "@/lib/server-status";
import { CONNECT_TO_CHECK } from "@/lib/engine/trust-errors";
import { describeMockAttestation, describeReverifying } from "@/lib/messages";

import { recheckNode } from "@/lib/store/node-move";

import { useConsole, useNodeFollow, useSession, useTradingPause } from "./ConsoleProvider";

const LINE = "border-b px-4 py-1 text-center text-label";
const WARN = `${LINE} border-amber/40 bg-amber/10 text-amber`;
const BAD = `${LINE} border-ember/50 bg-ember/10 text-ember`;

export function AttestationBanner() {
  const { attestation, stream, server, signatures, notices } = useConsole();
  const follow = useNodeFollow();
  const pause = useTradingPause();
  const onTradingPage = usePathname() === "/";
  // Nothing said of the server being left applies while the console moves.
  const moving = pause.kind !== "none" ? (onTradingPage ? null : pauseLine(pause)) : switchLine(follow, stream === "live");
  if (pause.kind !== "none" && moving === null) return null;
  // The pause's own live region announces it, so its line here is not a second one.
  if (moving !== null) return <section aria-label="Server verification"><Line line={moving} live={pause.kind === "none"} /></section>;
  // A node that failed its check says so above, and nothing it said is shown; a drop is not an outage until the follower has read where the operator runs.
  const line = attestation.kind === "unverified" || follow?.kind === "confirming" ? null : serverLine(stream, server, notices.feed?.text ?? null);
  return (
    <section aria-label="Server verification">
      <Status attestation={attestation} signatures={signatures} />
      <NodeLine />
      {line !== null && <Line line={line} />}
    </section>
  );
}

function Line({ line, live = true }: { line: ServerLine; live?: boolean }) {
  return (
    <div role={live ? line.role : undefined} className={line.role === "alert" ? BAD : WARN}>
      <strong className="font-medium">{line.lead}</strong> {line.rest}
    </div>
  );
}

/** What the chain says about the node, when it says something other than the node in use. */
function NodeLine() {
  const follow = useNodeFollow();
  if (follow === null) return null;
  switch (follow.kind) {
    case "pinned":
    case "following":
    case "confirming":
    case "waiting":
      return null;
    case "failed":
      return <div role="status" className={WARN}><strong className="font-medium">The app could not confirm which trading server is currently operating.</strong> You remain connected to {new URL(follow.origin).host}, and the app will check again automatically. {asSentence(follow.reason)}<CheckAgain /></div>;
    case "unlisted":
      return <div role="alert" className={BAD}><strong className="font-medium">This version of the app needs to be updated.</strong> {follow.hostname === null ? "The current trading server has not registered a web address" : `The current trading server is at ${follow.hostname}, which this version of the app does not recognise`}, so the app cannot connect to it.</div>;
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
          <strong className="font-medium text-glow">Server verified.</strong> The server is running release {attestation.release} with signing key <span title={attestation.address}>{shortHex(attestation.address)}</span>.
        </div>
      );
    case "attested":
      return (
        <div role="status" className={WARN}>
          <strong className="font-medium">Server software verified.</strong> The server is running release {attestation.release} with signing key <span title={attestation.address}>{shortHex(attestation.address)}</span>. {attestation.why}
          {attestation.why !== CONNECT_TO_CHECK && <CheckAgain />}
        </div>
      );
    case "clock":
      return <div role="alert" className={BAD}><strong className="font-medium">Your device clock is incorrect.</strong> It differs from the server&apos;s time by {Math.round(Math.abs(attestation.skewMs) / 1000)} seconds. Prices and account figures on screen will not update until you correct the clock and reload the page.</div>;
    case "unverified":
      return <div role="alert" className={BAD}><strong className="font-medium">The trading server could not be verified, so trading and transfers of funds have been suspended.</strong> {attestation.reason}</div>;
    default:
      return attestation satisfies never;
  }
}
