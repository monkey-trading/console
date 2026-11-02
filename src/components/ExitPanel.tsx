"use client";

/**
 * The Funding page's exit proof: whether this browser holds a proof at the vault's latest checkpoint,
 * how old it is, its file, and once the vault's exit can start, the claim. It lives on the Funding page
 * since it is the account's way to its money when the node is gone, beside the vault's other claims.
 */

import { useId, useRef, type ChangeEvent } from "react";

import { exitFileName, exitFileText } from "@/lib/engine/exit-file";
import { importChosenFile } from "@/lib/store/exit-actions";
import { exitView, type ExitLine, type ExitTone } from "@/lib/store/exit-view";

import { useConsole, useSession } from "./ConsoleProvider";
import { ExitClaim } from "./ExitClaim";
import { Notice } from "./Notice";

const BUTTON = "inline-flex min-h-11 cursor-pointer items-center rounded border border-line-2 px-3 py-2 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:text-fg-3 lg:min-h-0";
const TONE: Record<ExitTone, string> = { calm: "text-fg-2", warn: "text-amber", bad: "text-ember" };

/** One line of what the panel says; a line that needs the trader is announced. */
function Line({ line }: { line: ExitLine }) {
  return <p role={line.tone === "calm" ? undefined : "status"} className={`text-caption leading-relaxed ${TONE[line.tone]}`}>{line.text}</p>;
}

/** Saves `text` as a file the browser downloads. */
function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Some browsers start the download after the click returns, so the URL outlives it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function ExitPanel() {
  const { exit, wallet, busy } = useConsole();
  const { store } = useSession();
  const title = useId();
  const input = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const view = exitView(exit, wallet);
  const { record } = exit;
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // the same file can be chosen again
    if (file !== undefined) void importChosenFile(store, file);
  };
  return (
    <section aria-labelledby={title} className="space-y-3 rounded-xl border border-line-2 bg-ink-1 p-4">
      <h3 ref={heading} id={title} tabIndex={-1} className="text-label tracking-caps text-glow uppercase outline-none">Exit proof</h3>
      <p className="text-caption leading-relaxed text-fg-3">Your own record of what the vault owes you, kept in this browser and brought up to each vault checkpoint while this page is open. If the operator stops, a proof at the vault&apos;s last checkpoint lets you claim with no node.</p>
      <p role="status" className="sr-only">{exit.announced}</p>
      {view.lines.map((line) => <Line key={line.text} line={line} />)}
      {view.rebuild !== null && (
        <div className="space-y-1">
          <p className="text-caption leading-relaxed text-fg-2">Build a current proof from a mirror of the public log with the engine&apos;s offline builder, then import what it prints here:</p>
          <code className="block rounded border border-line-2 bg-ink-2 px-2 py-2 text-label break-all text-fg-2">{view.rebuild}</code>
        </div>
      )}
      <ExitClaim view={view} settled={() => { if (document.activeElement === document.body || document.activeElement === null) heading.current?.focus(); }} />
      {(record !== null || view.canImport) && (
        <div className="flex flex-wrap gap-2">
          {record !== null && <button type="button" onClick={() => download(exitFileName(record), exitFileText(record))} className={BUTTON}>Export to a file</button>}
          {view.canImport && (
            <>
              <button type="button" aria-disabled={busy || exit.reading} onClick={() => { if (!busy && !exit.reading) input.current?.click(); }} className={BUTTON}>Import a file</button>
              <input ref={input} type="file" accept=".json,application/json" aria-label="Exit proof file" tabIndex={-1} onChange={choose} className="sr-only" />
            </>
          )}
        </div>
      )}
      <Notice surface="exit" />
    </section>
  );
}
