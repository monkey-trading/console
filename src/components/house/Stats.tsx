"use client";

/** The House page's figure panels: open positions with each market's long, short and net, the house's own figures, and the MONKEY token's. */

import Link from "next/link";
import { useMemo } from "react";

import { formatCompactUsd, formatUsdc, parseUnits } from "@/lib/chart-format";
import { fixedToNumber, formatUsd, type Fixed } from "@/lib/fixed";
import { groupThousands } from "@/lib/format";
import { queueCaveats } from "@/lib/house";
import { monkeyFigureRows } from "@/lib/house/monkey-figures";
import { PAGES } from "@/lib/nav";
import type { HouseScan } from "@/lib/house-scan";
import { feedProblem } from "@/lib/store/house-feed-text";
import { monkeyFeed } from "@/lib/store/house-feeds";
import type { ConsoleState } from "@/lib/store/state";
import { formatClock, formatStamp } from "@/lib/time";

import { useSession } from "../ConsoleProvider";
import { Panel, Quiet, Row, Term, type Emphasis } from "./Panel";
import { useFeed, useSelected } from "./use-feed";

/** The pages the MONKEY panel links to: the token's and emissions', and staking's; each once the top bar lists it, so no link leads to a missing page. */
const MONKEY_LINKS = [{ href: "/monkey", label: "MONKEY page" }, { href: "/staking", label: "Staking page" }] as const;
const LISTED: readonly string[] = PAGES.map((page) => page.href);
const LINK = "text-caption text-glow hover:text-glow-hover focus-visible:outline-2 focus-visible:outline-glow";
const HEAD = "py-1 text-right text-label font-normal tracking-caps text-fg-3 uppercase";
const CELL = "py-1 text-right text-caption tabular-nums";

const sign = (value: Fixed): Emphasis => (value > 0n ? "glow" : value < 0n ? "ember" : "fg");
const compact = (value: Fixed | null): string => (value === null ? "—" : formatCompactUsd(fixedToNumber(value)));
const net = compact;

const selectScan = (s: ConsoleState): HouseScan | null => s.house.scan;
const selectHouse = (s: ConsoleState) => ({ cash: s.house.cash, nav: s.house.nav, gross: s.house.grossExposure, scan: s.house.scan, queue: s.withdrawalTotals, queueFailed: s.queueFailed });

/** Open interest, margin and positions, then each market's clients' long, short and net notional. */
export function OpenPositions() {
  const scan = useSelected(selectScan);
  const total = useMemo(() => {
    const sum = (pick: (m: HouseScan["markets"][number]) => Fixed | null): Fixed | null => (scan === null || scan.markets.some((m) => pick(m) === null) ? null : scan.markets.reduce((acc, m) => acc + (pick(m) ?? 0n), 0n));
    return { long: sum((m) => m.long), short: sum((m) => m.short), net: sum((m) => m.net) };
  }, [scan]);
  return (
    <Panel title="Open positions" tip="These are all traders' open positions, not just yours, as of the last update. The house takes the other side of each one.">
      {scan === null ? (
        <Quiet>Open positions aren&apos;t available from this server yet.</Quiet>
      ) : (
        <>
          <dl className="space-y-1">
            <Row label="Open interest" tip="This is the total size of all open positions, longs and shorts added together, in dollars." value={scan.openInterest === null ? "—" : formatUsd(scan.openInterest)} />
            <Row label="Open margin" tip="This is the margin traders have put up for their open positions, in dollars." value={scan.openMargin === null ? "—" : formatUsd(scan.openMargin)} />
            <Row label="Open positions" tip="This is the number of open positions across all markets." value={scan.openPositions === null ? "—" : groupThousands(scan.openPositions)} />
          </dl>
          <div role="region" aria-label="Open positions by market" tabIndex={0} className="max-w-full overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-glow">
            <table className="w-full border-collapse">
              <caption className="sr-only">Traders&apos; long and short position size in each market, and the net of the two</caption>
              <thead>
                <tr>
                  <th scope="col" className="py-1 text-left text-label font-normal tracking-caps text-fg-3 uppercase">Market</th>
                  <th scope="col" className={HEAD}><Term label="Long" tip="This is the total size of traders' long positions. They profit when the price rises, and the house loses." /></th>
                  <th scope="col" className={HEAD}><Term label="Short" tip="This is the total size of traders' short positions. They profit when the price falls." /></th>
                  <th scope="col" className={HEAD}><Term label="Net" tip="This is long minus short. The house holds the opposite, so a positive net means the house is short." /></th>
                </tr>
              </thead>
              <tbody>
                {scan.markets.map((m) => (
                  <tr key={m.market} className="border-t border-line">
                    <th scope="row" className="truncate py-1 text-left text-caption font-normal text-fg-2">{m.symbol}</th>
                    <td className={`${CELL} text-glow`}>{compact(m.long)}</td>
                    <td className={`${CELL} text-ember`}>{compact(m.short)}</td>
                    <td className={`${CELL} ${m.net !== null && m.net < 0n ? "text-ember" : "text-fg"}`}>{net(m.net)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line-2">
                  <th scope="row" className="py-1 text-left text-caption font-normal text-fg">Total</th>
                  <td className={`${CELL} text-glow`}>{compact(total.long)}</td>
                  <td className={`${CELL} text-ember`}>{compact(total.short)}</td>
                  <td className={`${CELL} text-fg`}>{net(total.net)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-label text-fg-3">All traders, not just you. {scan.snapshotMs === null ? "The first update hasn't finished yet." : `Updated at ${formatClock(scan.snapshotMs)} UTC.`}</p>
        </>
      )}
    </Panel>
  );
}

/** The house's cash, NAV, unrealised result, queued withdrawals, gross exposure and volume. */
export function HouseFigures() {
  const { cash, nav, gross, scan, queue, queueFailed } = useSelected(selectHouse);
  const { store } = useSession();
  const monkey = useFeed(useMemo(() => monkeyFeed(store), [store])).data;
  const paidUnits = monkey?.distribution?.distributed_usdc_units;
  const paid = paidUnits === undefined ? null : parseUnits(paidUnits);
  const simulated = store.deps.client.signatures === "none";
  const unrealised = scan?.unrealised ?? nav - cash;
  return (
    <Panel title="House" tip={simulated ? "These are the house's own finances, simulated in your browser." : "These are the house's own finances, verified from the server."}>
      <dl className="space-y-1">
        <Row label="House funds" tip="This is the house's cash: its capital, plus what traders have lost and paid in fees, minus what they have won." value={formatUsd(cash)} tone="glow" />
        <Row label="House value" tip="This is what the house is worth now: its cash minus traders' profit on open positions at current prices." value={formatUsd(nav)} />
        <Row label="Unrealised P&L" tip="This is the house's profit or loss on open positions at current prices. It's negative when traders are ahead." value={formatUsd(unrealised)} tone={sign(unrealised)} />
        <Row label="Queued withdrawals" tip="This is what's still owed to traders waiting in the withdrawal queue." value={queue === null ? "—" : formatUsd(queue.remaining)} />
        <Row label="Distributed" tip="This is all the USDC distributed so far from the house's value above its reserve. Stakers share it, and while rotation is on, a fifth of each distribution goes to the operator. Each distribution lowers the house value by the amount paid." value={paid === null ? "—" : formatUsdc(paid)} />
        <Row label="Gross exposure" tip="This is the house's net exposure in each market, added up across all markets in dollars. Exposure in one market doesn't offset another." value={formatUsd(gross)} />
        <Row label="Volume" tip={scan === null ? "This is the dollar value traded recently." : `This is the dollar value traded since ${formatStamp(scan.volumeSinceMs)} UTC.`} value={scan === null ? "—" : formatUsd(scan.volume)} />
      </dl>
      {queue !== null && queueCaveats(queue, queueFailed).map((line) => <p key={line} className="text-label text-fg-3">{line}</p>)}
    </Panel>
  );
}

/** MONKEY's emitted amount, stake and the reward stakers have been paid, with links to the MONKEY and Staking pages. */
export function MonkeyFigures() {
  const { store } = useSession();
  const feed = useFeed(useMemo(() => monkeyFeed(store), [store]));
  const monkey = feed.data;
  const rows = useMemo(() => monkeyFigureRows(monkey), [monkey]);
  return (
    <Panel
      title="MONKEY"
      tip="MONKEY is the platform's token. Traders earn it when they close trades at a loss, and stakers receive USDC from the house's value above its reserve."
      controls={<>{MONKEY_LINKS.filter((link) => LISTED.includes(link.href)).map((link) => <Link key={link.href} href={link.href} className={LINK}>{link.label}</Link>)}</>}
    >
      {feed.status === "failed" ? (
        <Quiet>{feedProblem(feed, "the MONKEY totals")}</Quiet>
      ) : feed.status === "unavailable" && monkey === null ? (
        <Quiet>MONKEY totals aren&apos;t available from this server yet.</Quiet>
      ) : (
        <>
        <dl className="space-y-1">
          {rows.map((row) => <Row key={row.label} label={row.label} tip={row.tip} value={row.value} />)}
          <Row label="Reward token" tip="This is the token stakers are paid in." value={monkey?.distribution ? "USDC" : "—"} />
        </dl>
        {feedProblem(feed, "the MONKEY totals") !== null && <p className="text-label text-fg-3">{feedProblem(feed, "the MONKEY totals")}</p>}
        </>
      )}
    </Panel>
  );
}
