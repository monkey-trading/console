"use client";

/** The right pane: size an order, see its quote and margin, and place it. */

import { useId, useState } from "react";

import { maySign } from "@/lib/engine/attestation";
import { fixedFromInt, formatFixedPlaces, parseFixed } from "@/lib/fixed";
import { maxLeverage } from "@/lib/pricing";
import { placeOrder } from "@/lib/store/actions";
import { leverageOf, notionalForLeverage, previewTicket, SLIPPAGE_CHOICES } from "@/lib/ticket";

import { useConsole, useSession } from "./ConsoleProvider";
import { TicketSummary } from "./TicketSummary";

type Kind = "market" | "limit" | "stop";
const DEFAULT_SIZE = "10000";
const INPUT = "mt-1 w-full rounded border border-line-2 bg-ink px-2 py-2 text-data text-fg focus-visible:outline-2 focus-visible:outline-glow";

/** Opens the funding drawer. */
function FundingLink() {
  const { store } = useSession();
  return <button type="button" onClick={() => store.setFundingOpen(true)} className="text-glow underline focus-visible:outline-2 focus-visible:outline-glow">Open funding</button>;
}

export function OrderTicket() {
  const state = useConsole();
  const { store } = useSession();
  const id = useId();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [kind, setKind] = useState<Kind>("market");
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [price, setPrice] = useState("");
  const [slippage, setSlippage] = useState<number>(10);
  const market = state.markets.find((m) => m.id === state.selected);
  if (!market) return null;
  const notional = parseFixed(size) ?? 0n;
  const triggerPrice = parseFixed(price);
  const preview = previewTicket({ market, side, notional, slippageBps: slippage, account: state.account, houseNav: state.house.nav });
  const equity = state.account?.equity ?? 0n;
  const leverage = leverageOf(equity, notional);
  const maxLev = maxLeverage(market.view.margin_tiers);
  const problems = [...preview.problems];
  if (kind !== "market" && triggerPrice === null) problems.push("Enter a trigger price.");
  const gate = !state.wallet ? "Connect a wallet to trade." : state.eligibility === null ? "Attest your eligibility before trading." : !maySign(state.attestation) ? "The node's attestation is not verified." : null;
  const canPlace = gate === null && problems.length === 0 && !state.busy;
  const submit = () => {
    const base = { market: market.id, side, notional, slippageBps: slippage, reduceOnly: false };
    if (kind === "market") void placeOrder(store, { ...base, kind: { type: "market" } });
    else if (triggerPrice !== null) void placeOrder(store, { ...base, kind: { type: kind, price: triggerPrice } });
  };
  return (
    <form className="p-4 sm:p-5" onSubmit={(event) => { event.preventDefault(); if (canPlace) submit(); }}>
      <h2 className="text-label tracking-caps text-fg-3 uppercase">Position sizing</h2>
      <fieldset className="mt-5 grid grid-cols-2 gap-2">
        <legend className="sr-only">Position direction</legend>
        {(["buy", "sell"] as const).map((direction) => (
          <button key={direction} type="button" aria-pressed={side === direction} onClick={() => setSide(direction)} className={`rounded border py-2.5 text-caption focus-visible:outline-2 focus-visible:outline-glow ${side !== direction ? "border-line-2 text-fg-2" : direction === "buy" ? "border-glow bg-glow/10 text-glow" : "border-ember bg-ember/10 text-ember"}`}>
            {direction === "buy" ? "Long" : "Short"}
          </button>
        ))}
      </fieldset>
      <div className="mt-5 grid grid-cols-[1fr_1fr] gap-3">
        <label className="text-caption text-fg-2">Order type
          <select value={kind} onChange={(event) => setKind(event.target.value as Kind)} className={INPUT}>
            <option value="market">Market</option>
            <option value="limit">Limit</option>
            <option value="stop">Stop</option>
          </select>
        </label>
        {kind !== "market" && (
          <label className="text-caption text-fg-2">Trigger price
            <input value={price} inputMode="decimal" onChange={(event) => setPrice(event.target.value)} className={INPUT} />
          </label>
        )}
      </div>
      <div className="mt-5">
        <label htmlFor={`${id}-size`} className="flex justify-between gap-2 text-caption text-fg-2">Position size (USD)
          <span className="text-fg">${formatFixedPlaces(notional, 0)}</span>
        </label>
        <input id={`${id}-size`} value={size} inputMode="decimal" onChange={(event) => setSize(event.target.value)} className={INPUT} />
        <input aria-label="Position size slider" type="range" min={0} max={1_000_000} step={1_000} value={Math.min(Number(notional / fixedFromInt(1)), 1_000_000)} onChange={(event) => setSize(event.target.value)} className="mt-3 w-full accent-glow" />
        <label htmlFor={`${id}-lev`} className="mt-4 flex justify-between text-caption text-fg-2">Leverage on equity <span className="text-glow">{leverage === null ? "—" : `${leverage}×`}</span></label>
        <input id={`${id}-lev`} type="range" min={0} max={maxLev} step={1} disabled={equity <= 0n} value={Math.min(leverage ?? 0, maxLev)} onChange={(event) => setSize(formatFixedPlaces(notionalForLeverage(equity, Number(event.target.value)), 0).replaceAll(",", ""))} className="mt-3 w-full accent-glow disabled:opacity-40" />
        <p className="mt-1 text-label text-fg-3">Up to {maxLev}× at the first margin band; larger sizes use more margin per dollar.</p>
      </div>
      <fieldset className="mt-5">
        <legend className="text-caption text-fg-2">Slippage bound</legend>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {SLIPPAGE_CHOICES.filter((bps) => bps <= market.view.max_slippage_bps).map((bps) => (
            <button key={bps} type="button" aria-pressed={slippage === bps} onClick={() => setSlippage(bps)} className={`rounded border py-2 text-caption focus-visible:outline-2 focus-visible:outline-glow ${slippage === bps ? "border-glow bg-glow/10 text-glow" : "border-line-2 text-fg-2"}`}>{bps} bps</button>
          ))}
        </div>
        <p className="mt-1 text-label leading-relaxed text-fg-3">{kind === "market" ? "The node declines the order if the live price is more than this worse than the quote shown." : "Resting orders fill at the live price when triggered."}</p>
      </fieldset>
      <TicketSummary market={market} preview={preview} notional={notional} />
      <button type="submit" disabled={!canPlace} className="mt-5 w-full rounded border border-glow bg-glow/10 py-3 text-caption text-glow hover:bg-glow/20 focus-visible:outline-2 focus-visible:outline-glow disabled:cursor-not-allowed disabled:border-line-2 disabled:bg-transparent disabled:text-fg-3">
        {state.busy ? "Signing…" : `${side === "buy" ? "Buy" : "Sell"} ${market.symbol}`}
      </button>
      <div aria-live="polite" className="mt-3 space-y-1 text-label leading-relaxed text-ember">
        {gate && <p className="text-fg-2">{gate} {state.wallet && state.eligibility === null && <FundingLink />}</p>}
        {!gate && problems.map((p) => <p key={p}>{p}{p === "Fund your account to trade." && <> <FundingLink /></>}</p>)}
      </div>
    </form>
  );
}
