"use client";

/** The P&L tab: a ledger of realised results, each loss with the MONKEY it earned. */

import { useEffect, useMemo, useSyncExternalStore } from "react";

import { formatUsd } from "@/lib/fixed";
import { formatMonkeyFigure } from "@/lib/format";
import { allocationsShort, atBound, rowsRemain } from "@/lib/ledger";
import { ACCRUES, COLUMN_NOTE, coverageNote, scheduleNotice } from "@/lib/ledger-cell";
import { viewOf } from "@/lib/ledger-share";
import type { ConsoleStore } from "@/lib/store/store";

import { useSession } from "./ConsoleProvider";
import { keepFocus } from "./keep-focus";
import { PnlLedgerCard } from "./PnlLedgerCard";
import { PnlLedgerTableRow } from "./PnlLedgerTableRow";

const BUTTON = "min-h-11 rounded border border-line-2 px-3 py-1 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow disabled:opacity-40 lg:min-h-0 lg:px-2";
const TH = "px-4 py-3 text-left text-label font-normal tracking-caps text-fg-3 uppercase";
const STAT = "text-label tracking-caps text-fg-3 uppercase";

/** Each market's symbol and places as one string, so a price patch that changes neither leaves the rows alone. */
function marketKey(store: ConsoleStore): string {
  return store.getSnapshot().markets.map((m) => `${m.id}|${String(m.symbol)}|${m.places}`).join(";");
}

export function PnlLedger() {
  const { store } = useSession();
  const subscribe = store.subscribe;
  // Each is a slice of the store whose value holds still across price patches, so only a ledger change redraws this.
  const ledger = useSyncExternalStore(subscribe, () => store.getSnapshot().ledger, () => store.getSnapshot().ledger);
  const address = useSyncExternalStore(subscribe, () => store.getSnapshot().wallet?.address ?? "", () => "");
  const markets = useSyncExternalStore(subscribe, () => marketKey(store), () => marketKey(store));
  useEffect(() => (address === "" ? undefined : store.ledger.open(address)), [store, address]);
  const names = useMemo(() => new Map(markets.split(";").filter(Boolean).map((entry) => {
    const [id = "", symbol = "", places = "2"] = entry.split("|");
    return [Number(id), { symbol, places: Number(places) }] as const;
  })), [markets]);
  const view = useMemo(() => viewOf(ledger.data, ledger.schedule), [ledger.data, ledger.schedule]);

  if (address === "") return <p className="px-4 py-6 text-caption text-fg-3">Connect a wallet to see your realised results.</p>;
  const { items, totals } = view;
  const ready = ledger.status === "ready";
  const more = rowsRemain(ledger.data) || allocationsShort(ledger.data, ledger.schedule);
  const full = atBound(ledger.data);
  const blank = !ready && items.length === 0;
  const notice = scheduleNotice(ledger.scheduleStatus);
  const rowFor = (item: (typeof items)[number]) => ({ item, symbol: names.get(item.row.market)?.symbol ?? `market ${item.row.market}`, places: names.get(item.row.market)?.places ?? 2, scheduleStatus: ledger.scheduleStatus });
  // A live region that exists before it changes: the coverage of a read that landed, or why one failed.
  const status = [ledger.error !== null ? ledger.error : ready ? coverageNote(items.length, totals, more, full) : "", notice ?? ""].filter(Boolean).join(" ");
  const empty = !ready ? (ledger.status === "failed" ? "The results could not be read." : "Reading your results.") : more ? "No realised results in what is loaded yet. Load more for older events." : "No realised results yet. Closing a position, a close-out or a split's cash in lieu shows here.";

  return (
    <div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 border-b border-line px-4 py-3 text-caption">
        <div><p className={STAT}>Realised P&amp;L</p><p className={totals.realised < 0n ? "text-ember" : "text-glow"}>{blank ? "—" : formatUsd(totals.realised)}</p></div>
        <div><p className={STAT}>Profit fees</p><p className="text-fg-2">{blank ? "—" : formatUsd(totals.fees)}</p></div>
        <div><p className={STAT} title={ACCRUES}>MONKEY</p><p className="text-fg-2">{blank ? "—" : formatMonkeyFigure(totals.monkey)}</p></div>
        <p role="status" className={`basis-full text-label ${ledger.error !== null ? "text-ember" : "text-fg-3"}`}>{status}</p>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-caption text-fg-3">{empty}</p>
      ) : (
        <>
          <ul className="lg:hidden" aria-label="Realised results">{items.map((item) => <PnlLedgerCard key={item.row.cursor} {...rowFor(item)} />)}</ul>
          <div role="region" aria-label="Realised results table" tabIndex={0} className="hidden overflow-x-auto outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-glow lg:block">
            <table className="w-full min-w-[720px] text-caption">
              <thead><tr className="border-b border-line"><th className={TH}>Time</th><th className={TH}>Market</th><th className={TH}>Closed</th><th className={TH}>Contracts</th><th className={TH}>Price</th><th className={TH}>Realised P&amp;L</th><th className={TH}>Profit fee</th><th className={TH} title={ACCRUES}>MONKEY</th></tr></thead>
              <tbody>{items.map((item) => <PnlLedgerTableRow key={item.row.cursor} {...rowFor(item)} />)}</tbody>
            </table>
          </div>
        </>
      )}
      <div className="px-4 py-3 text-label text-fg-3">
        {ledger.status === "failed" && <button type="button" className={BUTTON} onClick={(event) => { keepFocus(event.currentTarget); store.ledger.open(address); }}>Try again</button>}
        {ready && more && !full && <button type="button" className={BUTTON} disabled={ledger.more} onClick={(event) => { keepFocus(event.currentTarget); void store.ledger.loadMore(); }}>{ledger.more ? "Loading" : "Load more"}</button>}
        <p className="mt-2">{COLUMN_NOTE}</p>
      </div>
    </div>
  );
}
