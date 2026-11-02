"use client";

/** A contract address, shortened, with a button that copies the whole of it and says so. */

import { useEffect, useRef, useState } from "react";

import { shortHex } from "@/lib/format";

import { Row } from "./Row";

export function AddressRow({ label, address }: { label: string; address: string | null }) {
  const [copied, setCopied] = useState(false);
  /** Set when copying fails, so the whole address is on the page to select. */
  const [selectable, setSelectable] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  const copy = () => {
    if (address === null) return;
    // The clipboard exists only in a secure context, so a build served over plain http has none.
    if (typeof navigator.clipboard === "undefined") {
      setSelectable(true);
      return;
    }
    navigator.clipboard.writeText(address).then(
      () => {
        setCopied(true);
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1_500);
      },
      () => setSelectable(true),
    );
  };
  return (
    <Row label={label}>
      {address === null ? <span className="text-fg-3">Not set in this build</span> : (
        <span className="inline-flex items-center gap-2">
          <span title={address} className="whitespace-nowrap">{shortHex(address, 4, 4)}</span>
          <button type="button" onClick={copy} className="min-h-6 rounded border border-line-2 px-1.5 text-label text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow">
            Copy<span className="sr-only"> {label} address</span>
          </button>
          <span role="status" className="sr-only">{selectable ? "Copying failed; the full address is shown to select." : copied ? `${label} address copied` : ""}</span>
          {copied && <span aria-hidden="true" className="text-label text-glow">Copied</span>}
        </span>
      )}
      {address !== null && selectable && <code className="mt-1 block text-label break-all select-all text-fg-2">{address}</code>}
    </Row>
  );
}
