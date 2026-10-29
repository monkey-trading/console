"use client";

/** The WalletConnect pairing dialog: while the connector pairs, its link as a QR code, to copy, and to open in a wallet app on this device. */

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import { WALLETCONNECT_ICON, type WalletConnectConnector } from "@/lib/engine/walletconnect";
import { qrPath } from "@/lib/qr";

import { useSession } from "./ConsoleProvider";

const ACTION = "flex min-h-11 items-center justify-center rounded border px-4 py-2.5 text-caption focus-visible:outline-2 focus-visible:outline-glow";
const NOT_COPIED = "The link could not be copied. Scan the code or open the link instead.";

/** Shows the pairing dialog in a build with WalletConnect; renders nothing in one without. */
export function WalletConnectPairing() {
  const { walletConnect } = useSession();
  return walletConnect === null ? null : <PairingDialog connector={walletConnect} />;
}

/** A modal dialog over the page, or over the funding drawer, open while the connector pairs; closing it cancels the pairing. */
function PairingDialog({ connector }: { connector: WalletConnectConnector }) {
  const state = useSyncExternalStore(connector.subscribe, connector.pairing, connector.pairing);
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [copied, setCopied] = useState<{ uri: string; text: string } | null>(null);
  const open = state.status !== "idle";
  const uri = state.status === "ready" ? state.uri : null;
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  const copy = (link: string) => {
    const report = (text: string) => setCopied({ uri: link, text });
    // `clipboard` is missing outside a secure context, whatever the DOM types say.
    const clipboard: Clipboard | undefined = navigator.clipboard;
    if (clipboard === undefined) report(NOT_COPIED);
    else clipboard.writeText(link).then(() => report("Link copied."), () => report(NOT_COPIED));
  };
  const status = uri === null ? (open ? "Preparing a pairing link…" : "") : copied?.uri === uri ? copied.text : "The pairing link is ready.";
  return (
    <dialog
      ref={dialog}
      aria-labelledby={title}
      onClose={connector.cancel}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-xl border border-line-2 bg-ink-1 p-0 text-fg backdrop:bg-ink/70"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
        <h2 id={title} className="flex items-center gap-2 text-label tracking-caps text-glow uppercase">
          <img src={WALLETCONNECT_ICON} alt="" width={20} height={20} className="size-5" />
          Connect with WalletConnect
        </h2>
        <button type="button" onClick={connector.cancel} className="min-h-11 rounded border border-line-2 px-4 py-1.5 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow">Cancel</button>
      </div>
      <div className="space-y-4 p-4">
        <p className="text-caption leading-relaxed text-fg-2">Scan the code with a wallet app, or open the link in a wallet app on this device. Your wallet then asks you to approve the connection.</p>
        <p role="status" className="text-caption text-fg">{status}</p>
        {uri !== null && (
          <>
            <QrCode uri={uri} />
            <div className="grid gap-2 sm:grid-cols-2">
              <a href={uri} className={`${ACTION} border-glow bg-glow/10 text-glow hover:bg-glow/20`}>Open in a wallet app</a>
              <button type="button" onClick={() => copy(uri)} className={`${ACTION} border-line-2 text-fg-2 hover:border-glow hover:text-glow`}>Copy link</button>
            </div>
          </>
        )}
        <p className="text-label leading-relaxed text-fg-3">
          The pairing runs through WalletConnect&apos;s relay and Verify service, a third party that passes encrypted messages between this page and your wallet, tells your wallet this page&apos;s domain, and sees your IP address.{" "}
          <a href="/notices" target="_blank" rel="noopener noreferrer" className="text-fg-2 underline focus-visible:outline-2 focus-visible:outline-glow">Privacy and notices<span className="sr-only"> (opens in a new tab)</span></a>
        </p>
      </div>
    </dialog>
  );
}

/** The pairing link as a QR code: dark modules on a light ground, with the quiet zone readers need. */
function QrCode({ uri }: { uri: string }) {
  const { size, path } = qrPath(uri);
  return (
    <svg
      role="img"
      aria-label="QR code of the pairing link, for a wallet app to scan. Open in a wallet app and Copy link below give the same link."
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className="mx-auto block aspect-square w-full max-w-60 rounded bg-fg"
    >
      <path d={path} className="fill-ink" />
    </svg>
  );
}
