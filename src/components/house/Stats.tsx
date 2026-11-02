"use client";

/** The House page's figure panels: open positions with each market's long, short and net, the house's own figures, and the MONKEY token's. */

import Link from "next/link";
import { useMemo } from "react";

import { formatCompactUsd, formatUsdc, parseUnits } from "@/lib/chart-format";
import { fixedToNumber, formatUsd, type Fixed } from "@/lib/fixed";
import { groupThousands, formatMonkey } from "@/lib/format";
import { PAGES } from "@/lib/nav";
import type { HouseScan } from "@/lib/house-scan";
import { feedProblem } from "@/lib/store/house-feed-text";
import { monkeyFeed } from "@/lib/store/house-feeds";
import type { ConsoleState } from "@/lib/store/state";
import { formatClock } from "@/lib/time";

import { useSession } from "../ConsoleProvider";
import { Panel, Quiet, Row, Term, type Emphasis } from "./Panel";
import { useFeed, useSelected } from "./use-feed";

/** The MONKEY page's path; the panel links to it once the top bar lists it, so the link never leads to a missing page. */
const MONKEY_PAGE = "/monkey";
const LISTED: readonly string[] = PAGES.map((page) => page.href);
const HEAD = "py-1 text-right text-label font-normal tracking-caps text-fg-3 uppercase";
const CELL = "py-1 text-right text-caption tabular-nums";

const sign = (value: Fixed): Emphasis => (value > 0n ? "glow" : value < 0n ? "ember" : "fg");
const compact = (value: Fixed | null): string => (value === null ? "—" : formatCompactUsd(fixedToNumber(value)));
const net = compact;

const selectScan = (s: ConsoleState): HouseScan | null => s.house.scan;
const selectHouse = (s: ConsoleState) => ({ cash: s.house.cash, nav: s.house.nav, gross: s.house.grossExposure, scan: s.house.scan, queued: s.withdrawalTotals?.remaining ?? null });

/** Open interest, margin and positions, then each market's clients' long, short and net notional. */
export function OpenPositions() {
  const scan = useSelected(selectScan);
  const total = useMemo(() => {
    const sum = (pick: (m: HouseScan["markets"][number]) => Fixed | null): Fixed | null => (scan === null || scan.markets.some((m) => pick(m) === null) ? null : scan.markets.reduce((acc, m) => acc + (pick(m) ?? 0n), 0n));
    return { long: sum((m) => m.long), short: sum((m) => m.short), net: sum((m) => m.net) };
  }, [scan]);
  return (
    <Panel title="Open positions" tip="What the house's clients hold open at the node's last scan of every account. The house is the counterparty to each.">
      {scan === null ? (
        <Quiet>This node does not report open positions yet. They appear once it is updated.</Quiet>
      ) : (
        <>
          <dl className="space-y-1">
            <Row label="Open interest" tip="The notional of every open position, long and short added together, in dollars." value={scan.openInterest === null ? "—" : formatUsd(scan.openInterest)} />
            <Row label="Open margin" tip="The margin clients have posted against their open positions, in dollars." value={scan.openMargin === null ? "—" : formatUsd(scan.openMargin)} />
            <Row label="Open positions" tip="How many positions are open across all markets." value={scan.openPositions === null ? "—" : groupThousands(scan.openPositions)} />
          </dl>
          <table className="w-full table-fixed border-collapse">
            <caption className="sr-only">Clients&apos; long and short notional in each market, and the net of the two</caption>
            <thead>
              <tr>
                <th scope="col" className="py-1 text-left text-label font-normal tracking-caps text-fg-3 uppercase">Market</th>
                <th scope="col" className={HEAD}><Term label="Long" tip="Clients' long notional: positions that gain when the price rises, so the house loses." /></th>
                <th scope="col" className={HEAD}><Term label="Short" tip="Clients' short notional: positions that gain when the price falls." /></th>
                <th scope="col" className={HEAD}><Term label="Net" tip="Long less short. The house holds the opposite: a positive net leaves it short." /></th>
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
          <p className="text-label text-fg-3">{scan.snapshotMs === null ? "The node has not completed its first scan yet." : `Scanned at ${formatClock(scan.snapshotMs)} UTC.`}</p>
        </>
      )}
    </Panel>
  );
}

/** The house's cash, NAV, unrealised result, queued withdrawals, gross exposure and volume. */
export function HouseFigures() {
  const { cash, nav, gross, scan, queued } = useSelected(selectHouse);
  const unrealised = scan?.unrealised ?? nav - cash;
  return (
    <Panel title="House" tip="The house's own finances, from the node's signed answers.">
      <dl className="space-y-1">
        <Row label="House funds" tip="The house's cash: its capital plus what clients have lost and paid in fees, less what they have won." value={formatUsd(cash)} tone="glow" />
        <Row label="NAV" tip="Net asset value: cash less the clients' unrealised profit at current marks." value={formatUsd(nav)} />
        <Row label="Unrealised P&L" tip="The house's result on the positions open now at current marks: NAV less cash. Negative when clients are ahead." value={formatUsd(unrealised)} tone={sign(unrealised)} />
        <Row label="Queued withdrawals" tip="What the vault still owes clients waiting in the withdrawal queue." value={queued === null ? "—" : formatUsd(queued)} />
        <Row label="Gross exposure" tip="The sum of the house's absolute net exposure in each market, in dollars: opposite positions in different markets do not cancel." value={formatUsd(gross)} />
        <Row label="Volume" tip={scan === null ? "USD traded in the recent window." : `USD traded since ${formatClock(scan.volumeSinceMs)} UTC, the start of the node's volume window.`} value={scan === null ? "—" : formatUsd(scan.volume)} />
      </dl>
    </Panel>
  );
}

/** MONKEY's supply, stake and the reward stakers have been paid. */
export function MonkeyFigures() {
  const { store } = useSession();
  const feed = useFeed(useMemo(() => monkeyFeed(store), [store]));
  const monkey = feed.data;
  const text = (value: string | undefined, format: (units: bigint) => string): string => {
    const units = value === undefined ? null : parseUnits(value);
    return units === null ? "—" : format(units);
  };
  return (
    <Panel
      title="MONKEY"
      tip="The protocol token: emitted to clients for their realised losses, and staked to receive the USDC distributions the engine pays from the house's NAV above its liquidity floor."
      controls={LISTED.includes(MONKEY_PAGE) ? <Link href={MONKEY_PAGE} className="text-caption text-glow hover:text-glow-hover focus-visible:outline-2 focus-visible:outline-glow">Open the MONKEY page</Link> : undefined}
    >
      {feed.status === "failed" ? (
        <Quiet>{feedProblem(feed, "the MONKEY totals")}</Quiet>
      ) : feed.status === "unavailable" && monkey === null ? (
        <Quiet>This node does not report MONKEY totals yet.</Quiet>
      ) : (
        <>
        <dl className="space-y-1">
          <Row label="Supply" tip="MONKEY emitted so far: every client's cumulative entitlement. It is minted when claimed." value={text(monkey?.emissions?.allocated, formatMonkey)} />
          <Row label="Staked" tip="MONKEY locked in the staking contract." value={text(monkey?.staking?.total_staked, formatMonkey)} />
          <Row label="Staker rewards" tip="USDC paid to stakers in total, across every distribution." value={text(monkey?.distribution?.distributed_usdc_units, formatUsdc)} />
          <Row label="Reward token" tip="The token distributions are paid in." value={monkey?.distribution ? "USDC" : "—"} />
        </dl>
        {feedProblem(feed, "the MONKEY totals") !== null && <p className="text-label text-fg-3">{feedProblem(feed, "the MONKEY totals")}</p>}
        </>
      )}
    </Panel>
  );
}
