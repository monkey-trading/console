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
    <Panel title="Open positions" tip="All traders' open positions on the platform, not only your own, as at the most recent update. The house is the counterparty to each of these positions.">
      {scan === null ? (
        <Quiet>Open position figures are not yet available from this trading server.</Quiet>
      ) : (
        <>
          <dl className="space-y-1">
            <Row label="Open interest" tip="The total size of all open positions, long and short combined, in US dollars." value={scan.openInterest === null ? "—" : formatUsd(scan.openInterest)} />
            <Row label="Open margin" tip="The total margin that traders have posted against their open positions, in US dollars." value={scan.openMargin === null ? "—" : formatUsd(scan.openMargin)} />
            <Row label="Open positions" tip="The number of positions currently open across all markets." value={scan.openPositions === null ? "—" : groupThousands(scan.openPositions)} />
          </dl>
          <div role="region" aria-label="Open positions by market" tabIndex={0} className="max-w-full overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-glow">
            <table className="w-full border-collapse">
              <caption className="sr-only">The size of traders&apos; long and short positions in each market, and the net position</caption>
              <thead>
                <tr>
                  <th scope="col" className="py-1 text-left text-label font-normal tracking-caps text-fg-3 uppercase">Market</th>
                  <th scope="col" className={HEAD}><Term label="Long" tip="The total size of traders' long positions. A long position profits when the price rises, and the house, as counterparty, incurs the corresponding loss." /></th>
                  <th scope="col" className={HEAD}><Term label="Short" tip="The total size of traders' short positions. A short position profits when the price falls, and the house, as counterparty, incurs the corresponding loss." /></th>
                  <th scope="col" className={HEAD}><Term label="Net" tip="Long positions minus short positions. The house holds the opposite position, so a positive net figure means the house is net short in that market." /></th>
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
          <p className="text-label text-fg-3">These figures cover all traders, not only you. {scan.snapshotMs === null ? "The first update has not yet completed." : `Last updated at ${formatClock(scan.snapshotMs)} UTC.`}</p>
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
    <Panel title="House" tip={simulated ? "The house's own finances, simulated in your browser for this demo." : "The house's own finances, as reported by the trading server and verified by this app."}>
      <dl className="space-y-1">
        <Row label="House funds" tip="The house's cash balance, which is its capital plus the losses and fees that traders have paid, less the profits that traders have realised." value={formatUsd(cash)} tone="glow" />
        <Row label="House value" tip="The current value of the house, made up of its cash balance plus its profit or loss on traders' open positions at current prices." value={formatUsd(nav)} />
        <Row label="Unrealised P&L" tip="The house's unrealised profit or loss on all open positions at current prices. The figure is negative when traders' open positions are, in aggregate, in profit." value={formatUsd(unrealised)} tone={sign(unrealised)} />
        <Row label="Queued withdrawals" tip="The amount still owed to traders whose withdrawal requests are waiting in the withdrawal queue." value={queue === null ? "—" : formatUsd(queue.remaining)} />
        <Row label="Distributed" tip="The total USDC paid out to date from the house's value above its reserve. It is shared among stakers, with up to one fifth going to the operator while operator rotation is active." value={paid === null ? "—" : formatUsdc(paid)} />
        <Row label="Gross exposure" tip="The house's net exposure in each market, added together across all markets regardless of direction, in US dollars. A long exposure in one market is not offset by a short exposure in another." value={formatUsd(gross)} />
        <Row label="Volume" tip={scan === null ? "The total value of trades executed recently, in US dollars." : `The total value of trades executed since ${formatStamp(scan.volumeSinceMs)} UTC, in US dollars.`} value={scan === null ? "—" : formatUsd(scan.volume)} />
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
      tip="MONKEY is the platform's token. Traders earn MONKEY when they realise a loss, and staked MONKEY shares in the USDC distributions paid from the house's value above its reserve."
      controls={<>{MONKEY_LINKS.filter((link) => LISTED.includes(link.href)).map((link) => <Link key={link.href} href={link.href} className={LINK}>{link.label}</Link>)}</>}
    >
      {feed.status === "failed" ? (
        <Quiet>{feedProblem(feed, "the MONKEY totals")}</Quiet>
      ) : feed.status === "unavailable" && monkey === null ? (
        <Quiet>MONKEY figures are not yet available from this trading server.</Quiet>
      ) : (
        <>
        <dl className="space-y-1">
          {rows.map((row) => <Row key={row.label} label={row.label} tip={row.tip} value={row.value} />)}
          <Row label="Reward token" tip="The token in which distributions to stakers are paid." value={monkey?.distribution ? "USDC" : "—"} />
        </dl>
        {feedProblem(feed, "the MONKEY totals") !== null && <p className="text-label text-fg-3">{feedProblem(feed, "the MONKEY totals")}</p>}
        </>
      )}
    </Panel>
  );
}
