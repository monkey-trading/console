/** The screen-reader log of results: one node per message, so each is announced once when added and a dismissal is silent. */

import type { ToastMessage } from "@/lib/store/state";

export function ToastLog({ toasts }: { toasts: readonly ToastMessage[] }) {
  return (
    <div role="log" aria-live="polite" aria-label="Notifications" className="sr-only">
      {toasts.map((toast) => <p key={toast.id}>{toast.text}</p>)}
    </div>
  );
}
