"use client";

/** The visible list of messages with a dismiss button each; shown over the page, or inside the funding drawer while it is open. */

import { useConsole, useSession } from "./ConsoleProvider";

const TONE = { ok: "border-glow/50 text-glow", error: "border-ember/60 text-ember", info: "border-line-2 text-fg" } as const;

/** Dismissing a message returns focus to `focusId`, since the button that held it is gone. */
export function ToastList({ focusId }: { focusId: string }) {
  const { toasts } = useConsole();
  const { store } = useSession();
  return (
    <div className="flex flex-col gap-2">
      {toasts.map((toast) => (
        <div key={toast.id} data-toast="" className={`flex items-start justify-between gap-3 rounded border bg-ink-2 px-3 py-3 text-caption shadow-platform ${TONE[toast.tone]}`}>
          <p aria-hidden="true" className="min-w-0 break-words">{toast.text}</p>
          <button type="button" onClick={() => { store.dismissToast(toast.id); document.getElementById(focusId)?.focus(); }} aria-label={`Dismiss notification: ${toast.text}`} className="shrink-0 px-1 text-fg-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-glow">×</button>
        </div>
      ))}
    </div>
  );
}
