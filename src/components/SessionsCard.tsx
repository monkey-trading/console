"use client";

/** The account's active sessions, read from the node's public history: while the page is open, with a Revoke on each. */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { SessionList, type SessionListStatus } from "@/lib/store/session-list";

import { useConsoleValue, useSession } from "./ConsoleProvider";
import { SessionRow } from "./SessionRow";

/** The sentence a status that shows no list gives, or null when the list shows. */
function noticeFor(status: SessionListStatus): string | null {
  switch (status.kind) {
    case "no-wallet": return "Connect a wallet to see which browsers can trade for your account.";
    case "waiting": return `Sessions load once the node can be read: ${status.why}.`;
    case "loading": return "Loading sessions…";
    case "failed": return `The sessions could not be read: ${status.message}`;
    case "ready": return null;
    default: return status satisfies never;
  }
}

export function SessionsCard() {
  const { store } = useSession();
  const [list] = useState(() => new SessionList(store, () => typeof document !== "undefined" && document.hidden));
  useEffect(() => list.open(), [list]);
  // A hidden tab makes no timed read; its return makes one.
  useEffect(() => {
    const visible = () => { if (!document.hidden) list.resume(); };
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, [list]);
  const heading = useRef<HTMLHeadingElement>(null);
  const { status, keys, ownKey, revoking, reading, complete } = useSyncExternalStore(list.subscribe, list.getSnapshot, list.getSnapshot);
  const busy = useConsoleValue((state) => state.busy);
  /** Whether a press does something now. The buttons stay focusable while it does not (`aria-disabled`, as the deal ticket's submit button): a read the minute timer starts must not drop the focus of someone tabbing through them. */
  const idle = !busy && !reading && revoking === null;
  /** Runs an action that may remove the control that started it, then puts focus on the card's heading if it was lost with the control. */
  const keepingFocus = (act: () => Promise<void>) => () => {
    if (!idle) return;
    void act().then(() => { if (document.activeElement === document.body || document.activeElement === null) heading.current?.focus(); });
  };
  // A watched account's sessions can be read, but only its wallet can revoke one.
  const watchOnly = useConsoleValue((state) => state.wallet?.readOnly === true);
  const notice = noticeFor(status);
  return (
    <section aria-labelledby="sessions-title" className="rounded-xl border border-line-2 bg-ink-1">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 p-4 pb-0 sm:px-5 sm:pt-5">
        <h3 id="sessions-title" ref={heading} tabIndex={-1} className="text-label tracking-caps text-fg-3 uppercase outline-none">Active sessions{status.kind === "ready" ? ` (${keys.length})` : ""}</h3>
        {(status.kind === "ready" || status.kind === "failed") && (
          <button type="button" aria-disabled={!idle} onClick={keepingFocus(() => list.refresh())} className="min-h-6 rounded px-1 text-label text-fg-3 underline hover:text-glow focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:opacity-40">Refresh<span className="sr-only"> the sessions</span></button>
        )}
      </div>
      <p className="px-4 pt-2 text-caption leading-relaxed text-fg-3 sm:px-5">
        Each sign-in registers its own session key, valid for up to 24 hours. A key not marked &quot;This browser&quot; may belong to another browser, or to an earlier sign-in here that was never revoked; it expires on its own within the day. Revoke one you do not recognise.
      </p>
      <div aria-live="polite" className="px-4 sm:px-5">
        {notice !== null && <p className="mt-3 text-caption leading-relaxed text-fg-2">{notice}</p>}
        {status.kind === "ready" && keys.length === 0 && <p className="mt-3 text-caption text-fg-3">No active sessions.</p>}
        {!complete && <p className="mt-3 text-caption leading-relaxed text-amber">The node has recorded too many registrations in the last day to read them all, so this list may be missing some sessions.</p>}
        {watchOnly && keys.length > 0 && <p className="mt-3 text-caption text-fg-3">This account is watched, so only its own wallet can revoke a session.</p>}
      </div>
      {keys.length > 0 && status.kind !== "no-wallet" && (
        <ul aria-label="Active sessions" className="mt-4 border-t border-line">
          {keys.map((key) => (
            <SessionRow key={key.address} session={key} mine={ownKey !== null && key.address === ownKey.toLowerCase()} idle={idle} watchOnly={watchOnly}
              revoking={revoking?.toLowerCase() === key.address} onRevoke={keepingFocus(() => list.revoke(key.address))} />
          ))}
        </ul>
      )}
      <div className="pb-4 sm:pb-5" />
    </section>
  );
}
