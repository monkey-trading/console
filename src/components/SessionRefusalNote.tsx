"use client";

/** Why the node refused to register this browser's key, with the way out when revoking a key would clear it. */

import Link from "next/link";

import { describeReject } from "@/lib/messages";
import { revokeClears } from "@/lib/setup-steps";

import { useConsole } from "./ConsoleProvider";

/** Nothing while no registration was refused. `onNavigate` runs when the Settings link is followed. */
export function SessionRefusalNote({ onNavigate }: { onNavigate?: () => void }) {
  const { sessionRefusal } = useConsole();
  if (sessionRefusal === null) return null;
  return (
    <p className="mt-3 text-label leading-relaxed text-ember">
      {describeReject(sessionRefusal)} Until this is fixed, each order asks your wallet.
      {revokeClears(sessionRefusal) && <> <Link href="/settings" onClick={onNavigate} className="text-glow underline focus-visible:outline-2 focus-visible:outline-glow">Revoke one in Settings</Link>.</>}
    </p>
  );
}
