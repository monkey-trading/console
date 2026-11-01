"use client";

/**
 * The House solvency screen: the house's net asset value, cash and exposure, its caps and
 * parameters, the withdrawal queue's size, and the signed state roots the figures stand on — every
 * figure from an answer the node's enclave signed, refreshed on the stream's cadence.
 */

import { signBlock } from "@/lib/engine/attestation";
import { formatRate } from "@/lib/format";
import { formatUsd } from "@/lib/fixed";
import { capFor, utilBps, type HouseParams } from "@/lib/house";

import { HouseCaps } from "./HouseCaps";
import { useConsole, useSession } from "./ConsoleProvider";

const H2 = "text-label tracking-caps text-glow uppercase";
const P = "text-data leading-relaxed text-fg-2";
const LABEL = "text-label tracking-caps text-fg-3 uppercase";
const CARD = "space-y-3 border border-line bg-ink-1 p-4";

/** The utilisation bar for a share of a cap; the geometry clamps, the announced value does not. */
function Meter({ bps }: { bps: number }) {
  const clamped = Math.min(10_000, Math.max(0, bps));
  return (
    <div role="meter" aria-label="Exposure against the cap" aria-valuemin={0} aria-valuemax={10_000} aria-valuenow={clamped} aria-valuetext={formatRate(bps)} className="h-2 w-full border border-line-2 bg-ink-2">
      <div className="h-full bg-glow" style={{ width: `${clamped / 100}%` }} />
    </div>
  );
}

/** A named figure in a panel. */
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className={LABEL}>{label}</dt>
      <dd className="text-lead text-fg">{value}</dd>
    </div>
  );
}

/** The note the Parameters panel carries while the log read feeding its values is still running, or keeps failing. */
function freshnessNote(params: HouseParams): string {
  return params.fresh === "failed"
    ? "The log read keeps failing, so these are the latest values it read, which may not be the latest the log records."
    : "The log read is still catching up, so these are the latest values it read, which may not be the latest the log records.";
}

/** The House solvency screen. */
export function HousePage() {
  const state = useConsole();
  const { signatures } = useSession().store.deps.client;
  const block = signBlock(state.attestation, state.stream);
  const ready = block === null && state.houseReady;
  const house = state.house;
  const params = state.houseParams;
  const totalCap = params === null ? null : capFor(house.nav, params.totalCapBps, params.totalCapFloor);
  const used = totalCap === null ? null : utilBps(house.grossExposure, totalCap);
  return (
    // Keyboard scrolling needs a tab stop on the scroll container (the WAI-APG scrollable-region
    // pattern); the panels below the fold hold no focusable element of their own.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a labelled scroll region takes tabIndex 0 so keyboard users can scroll it
    <div aria-label="House solvency details" tabIndex={0} className="min-h-0 flex-1 overflow-y-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-glow">
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6">
        <header className="space-y-3">
          <h2 className="text-lead tracking-caps text-glow uppercase">House</h2>
          <p className={P}>
            The house takes the other side of every trade. This page shows what the engine node&apos;s signed answers prove
            about its finances: its net asset value, cash and exposure, the caps that bound its risk, and the signed state
            roots its log posts. Every figure comes from an answer the node&apos;s enclave signed for this page&apos;s request; an
            answer that does not verify is discarded, never shown.
          </p>
          {block !== null && <p className={P}>Figures appear once the node&apos;s attestation is verified and its feed is live.</p>}
          {block === null && !state.houseReady && <p className={P}>Reading the node&apos;s first signed answers…</p>}
        </header>
        {ready && (
          <>
            <section aria-labelledby="solvency" className={CARD}>
              <h2 id="solvency" className={H2}>Solvency</h2>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3" aria-hidden="true">
                <Figure label="Net asset value" value={formatUsd(house.nav)} />
                <Figure label="Cash" value={formatUsd(house.cash)} />
                <Figure label="Gross exposure" value={formatUsd(house.grossExposure)} />
              </dl>
              <p className="sr-only">
                The house&apos;s net asset value is {formatUsd(house.nav)}, its cash {formatUsd(house.cash)}, and its gross exposure{" "}
                {formatUsd(house.grossExposure)}, refreshed from the node&apos;s signed answers.
              </p>
              <p className={P}>
                Net asset value is the house&apos;s cash minus clients&apos; unrealised profit or loss at current marks. Gross exposure is
                the sum of the house&apos;s net position in every market, in dollars.
              </p>
            </section>
            <section aria-labelledby="cap" className={CARD}>
              <h2 id="cap" className={H2}>Exposure against the cap</h2>
              {params === null ? (
                <p className={P}>
                  The cap&apos;s parameters are read from the node&apos;s public log; that read{" "}
                  {state.houseStatus === "failed" ? "keeps failing before any have been read." : "has not finished."}
                </p>
              ) : used === null || totalCap === null ? (
                <p className={P}>The cap is not positive at the current net asset value, so no utilisation can be stated.</p>
              ) : (
                <>
                  <Meter bps={used} />
                  <p className={P} aria-hidden="true">
                    {formatRate(used)} of a {formatUsd(totalCap)} cap at the current net asset value — the larger of{" "}
                    {formatRate(params.totalCapBps)} of net asset value and a {formatUsd(params.totalCapFloor)} floor.
                  </p>
                  <p className="sr-only">
                    Exposure is {formatRate(used)} of a {formatUsd(totalCap)} cap — the larger of {formatRate(params.totalCapBps)} of net
                    asset value and a {formatUsd(params.totalCapFloor)} floor — at the current net asset value, refreshed from the node&apos;s
                    signed answers.
                  </p>
                </>
              )}
            </section>
            <section aria-labelledby="withdrawals" className={CARD}>
              <h2 id="withdrawals" className={H2}>Withdrawals</h2>
              <dl className="grid grid-cols-2 gap-4">
                <Figure label="Requests waiting" value={state.withdrawalTotals === null ? "—" : String(state.withdrawalTotals.count)} />
                <Figure label="Queued" value={state.withdrawalTotals === null ? "—" : formatUsd(state.withdrawalTotals.remaining)} />
              </dl>
              {state.withdrawalTotals?.complete === false && <p className={P}>The queue&apos;s first pages only are counted here, so these are lower bounds.</p>}
              {state.withdrawalTotals !== null && state.withdrawalTotals.stable === false && (
                <p className={P}>The queue changed while it was read, so these figures are approximate.</p>
              )}
              <p className={P}>
                Withdrawals are paid in the order they are asked, each up to the collateral the vault holds; one that the vault cannot
                cover yet waits in a public first-in-first-out queue. The node signs no flag that pauses withdrawals:
                custody-side pauses are the vault contract&apos;s own state, on chain, outside the node&apos;s signed answers.
              </p>
            </section>
            <section aria-labelledby="caps" className={CARD}>
              <h2 id="caps" className={H2}>Market caps</h2>
              <HouseCaps markets={state.markets} nav={house.nav} />
              <p className={P}>
                Each market&apos;s cap is the larger of its share of the house&apos;s net asset value and its dollar floor. The node&apos;s
                public answers carry no per-market house exposure, so this table shows the caps; the house&apos;s total exposure
                stands above.
              </p>
            </section>
            <section aria-labelledby="parameters" className={CARD}>
              <h2 id="parameters" className={H2}>Parameters</h2>
              {params === null ? (
                <p className={P}>
                  The parameters are read from the node&apos;s public log; that read{" "}
                  {state.houseStatus === "failed" ? "keeps failing before any have been read." : "has not finished."}
                </p>
              ) : (
                <>
                  <dl className="grid grid-cols-2 gap-4">
                    <Figure label="Profit fee on winning trades" value={formatRate(params.profitFeeBps)} />
                    <Figure label="Close-out level" value={`${formatRate(params.closeoutLevelBps)} of margin`} />
                  </dl>
                  <p className={P}>
                    The profit fee is the share of a winning trade&apos;s realised profit the house keeps. The close-out level is the
                    share of an account&apos;s margin requirement below which its positions close. From protocol V35 these move only
                    within half of their launch values, and only after a public notice of at least seven days
                    {params.seq === null ? "." : `; the log records the current values at seq ${params.seq}.`}
                  </p>
                  {params.fresh !== "current" && <p className={P}>{freshnessNote(params)}</p>}
                </>
              )}
            </section>
            <section aria-labelledby="checkpoints" className={CARD}>
              <h2 id="checkpoints" className={H2}>Checkpoints</h2>
              {state.checkpoint === null ? (
                <p className={P}>
                  {state.houseStatus === "failed"
                    ? "The log read keeps failing before any checkpoint has been read."
                    : "No checkpoint has been read from the log yet."}
                </p>
              ) : (
                <>
                  <dl className="grid grid-cols-2 gap-4">
                    <Figure label="Latest checkpoint, seq" value={String(state.checkpoint.seq)} />
                    <div className="col-span-2">
                      <dt className={LABEL}>State root</dt>
                      <dd className="text-data break-all text-fg">{state.checkpoint.root}</dd>
                    </div>
                  </dl>
                  <p className={P}>
                    The enclave signs a root of its state as it sequences commands and posts it in the public log. Anyone may
                    replay the log to a checkpoint&apos;s sequence and check its root, and the vault stops taking deposits if the
                    enclave stops posting roots.
                  </p>
                  {state.houseStatus !== "current" && (
                    <p className={P}>
                      The log read is still catching up, so a newer checkpoint may follow; replaying the log to this
                      checkpoint&apos;s sequence still checks its root.
                    </p>
                  )}
                  {signatures === "none" && <p className={P}>This build runs the in-browser simulation: it signs nothing, and the roots above are the mock&apos;s stand-ins.</p>}
                </>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
