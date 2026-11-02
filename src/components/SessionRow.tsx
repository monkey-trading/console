"use client";

/** One active session: its key's short address, when it started, how long it has been active, when it expires, and Revoke. */

import { shortHex } from "@/lib/format";
import { activeFor, expiresIn, type LiveKey } from "@/lib/live-keys";
import { formatStamp } from "@/lib/time";

import { NodeTime } from "./NodeTime";

const BUTTON = "min-h-11 w-full rounded border border-line-2 px-3 py-2 text-caption text-fg-2 hover:border-ember hover:text-ember focus-visible:outline-2 focus-visible:outline-ember disabled:opacity-40 sm:w-auto lg:min-h-0";

/** One labelled figure of the row. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-label tracking-caps text-fg-3 uppercase">{label}</dt>
      <dd className="mt-0.5 min-w-0 text-caption text-fg [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export function SessionRow({ session, mine, disabled, revoking, onRevoke }: { session: LiveKey; mine: boolean; disabled: boolean; revoking: boolean; onRevoke: () => void }) {
  const short = shortHex(session.address);
  return (
    <li className="border-t border-line px-4 py-4 first:border-t-0 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-48">
          <p className="text-data text-fg [overflow-wrap:anywhere]">Key {short}{mine && <span className="ml-2 rounded border border-glow px-1.5 py-0.5 text-label text-glow">This browser</span>}</p>
        </div>
        <button type="button" disabled={disabled} onClick={onRevoke} aria-label={`Revoke session key ${short}${mine ? " (this browser)" : ""}`} className={`${BUTTON} basis-full sm:basis-auto`}>{revoking ? "Revoking…" : "Revoke"}</button>
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-3 min-[420px]:grid-cols-3">
        <Field label="Started">{formatStamp(session.startedAt)} UTC</Field>
        <Field label="Active for"><NodeTime format={(now) => activeFor(now, session.startedAt)} /></Field>
        <Field label="Expires"><NodeTime format={(now) => expiresIn(now, session.expiresAt)} /> <span className="text-fg-3">({formatStamp(session.expiresAt)} UTC)</span></Field>
      </dl>
      {mine && <p className="mt-3 text-label leading-relaxed text-fg-3">Revoking this browser&apos;s session disconnects your wallet here.</p>}
    </li>
  );
}
