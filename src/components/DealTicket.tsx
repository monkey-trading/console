"use client";

/** The right pane: order type, side, size, the best bid and offer, and Trade; the rest sits under Market info. */

import Link from "next/link";
import { useId, useState } from "react";

import { signBlock } from "@/lib/engine/attestation";
import { formatFixedPlaces, parseFixed } from "@/lib/fixed";
import { formatMark } from "@/lib/price-format";
import { ticketPrices } from "@/lib/quotes";
import { placeOrder } from "@/lib/store/actions";
import { belowMinimum, contractUnit, MARGIN_SHORT, NO_SIZE, parseSize, previewTicket, SLIPPAGE_CHOICES, slippageBound, sizeShown } from "@/lib/ticket";

import { useConsole, useSession } from "./ConsoleProvider";
import { MarketInfo } from "./MarketInfo";
import { Select } from "./Select";
import { SigningFor } from "./SigningFor";

type Kind = "market" | "limit" | "stop";
const KINDS = [
  { value: "market", label: "Market" },
  { value: "limit", label: "Limit" },
  { value: "stop", label: "Stop" },
] as const;
const INPUT = "mt-1 min-h-11 w-full rounded border border-edge bg-ink px-2 py-2 text-base text-fg lg:min-h-0 lg:text-data focus-visible:outline-2 focus-visible:outline-glow";

/** Links to the Funding page. */
function FundingLink() {
  return <Link href="/funding" className="-my-3.5 inline-flex min-h-11 items-center text-glow underline focus-visible:outline-2 focus-visible:outline-glow lg:my-0 lg:min-h-0">Open funding</Link>;
}

/** The deal ticket for the selected market; `OrderTicket` remounts it per market so no typed value carries over. */
export function DealTicket() {
  const state = useConsole();
  const { store } = useSession();
  const id = useId();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [kind, setKind] = useState<Kind>("market");
  // Null until the trader edits the field, so the size follows the market's minimum as its mark moves; "" is a field they cleared.
  const [typedSize, setTypedSize] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const [chosenSlippage, setSlippage] = useState<number>(10);
  const market = state.markets.find((m) => m.id === state.selected);
  if (!market) return null;
  const size = sizeShown(typedSize, market);
  const slippage = slippageBound(chosenSlippage, market);
  const parsedSize = parseSize(size);
  const qty = parsedSize.kind === "qty" ? parsedSize.qty : 0n;
  const triggerPrice = parseFixed(price);
  const live = state.signatures === "checked";
  // The margin use after the order comes from the console's own quote model, which does not know a live node's toxicity spread, so it is shown only for the in-browser node.
  const preview = previewTicket({ market, side, qty, slippageBps: slippage, resting: kind !== "market", triggerPrice, account: state.account, houseNav: state.house.nav, estimates: !live });
  const prices = ticketPrices({ live, quote: state.quotes[market.id] ?? null, quoteError: state.quoteError, preview, side, mark: market.mark });
  // A live node's quote already says whether it would decline for margin; the console's own estimate does not know its toxicity spread.
  // A size the field refuses says why, so the generic prompt would only repeat it.
  const listed = preview.problems.filter((p) => (!live || p !== MARGIN_SHORT) && (parsedSize.kind !== "refused" || p !== NO_SIZE));
  const sizeProblems = listed.filter((p) => p === belowMinimum(market.view.min_order_notional));
  const problems = listed.filter((p) => p !== NO_SIZE && !sizeProblems.includes(p));
  if (kind === "market" && prices.problem !== null) (prices.problemIsSize ? sizeProblems : problems).push(prices.problem);
  if (parsedSize.kind === "refused") sizeProblems.push(parsedSize.message);
  if (kind !== "market" && triggerPrice === null) problems.push(price.trim() === "" ? "Enter a trigger price." : "Enter the trigger price in digits, such as 61250.50.");
  const sizeMissing = parsedSize.kind === "empty" || (parsedSize.kind === "qty" && qty === 0n);
  const blockSentence = (why: string | null) => (why === null ? null : `Trading is paused: ${why}.`);
  // A read-only account is named as the cause before eligibility, which it could not attest.
  const readOnlyWhy = signBlock(state.attestation, state.stream, state.wallet?.readOnly === true);
  const gate = !state.wallet ? "Connect a wallet to trade." : state.wallet.readOnly ? blockSentence(readOnlyWhy) : state.eligibility === null ? "Attest your eligibility before trading." : blockSentence(readOnlyWhy);
  const canPlace = gate === null && problems.length === 0 && sizeProblems.length === 0 && !sizeMissing && !state.busy;
  const places = market.places;
  const show = (value: bigint | null) => (value === null ? "—" : formatMark(value, places));
  const submit = () => {
    const base = { market: market.id, side, qty: preview.qty, reduceOnly: false };
    // A market order is sent at exactly the price the ticket shows for its side.
    if (kind === "market" && prices.price !== null) void placeOrder(store, { ...base, kind: { kind: "market", quoted: prices.price, slippageBps: slippage } });
    else if (kind !== "market" && triggerPrice !== null) void placeOrder(store, { ...base, kind: { kind, price: triggerPrice } });
  };
  return (
    <>
      <form className="p-4 sm:p-5" onSubmit={(event) => { event.preventDefault(); if (canPlace) submit(); }}>
        <h2 className="text-label tracking-caps text-fg-3 uppercase">Deal ticket · {market.symbol}</h2>
        <div className="mt-5">
          <Select label="Order type" value={kind} options={KINDS} onChange={setKind} />
        </div>
        {kind !== "market" && (
          <label className="mt-4 block text-caption text-fg-2">Trigger price
            <input value={price} inputMode="decimal" maxLength={24} onChange={(event) => setPrice(event.target.value)} className={INPUT} />
          </label>
        )}
        <fieldset className="mt-4 grid grid-cols-2 gap-2">
          <legend className="sr-only">Side</legend>
          <button type="button" aria-pressed={side === "buy"} onClick={() => setSide("buy")} className={`min-h-11 rounded border py-2.5 text-caption lg:min-h-0 focus-visible:outline-2 focus-visible:outline-glow ${side === "buy" ? "border-glow bg-glow/10 text-glow" : "border-line-2 text-fg-2"}`}>Buy / Long</button>
          <button type="button" aria-pressed={side === "sell"} onClick={() => setSide("sell")} className={`min-h-11 rounded border py-2.5 text-caption lg:min-h-0 focus-visible:outline-2 focus-visible:outline-ember ${side === "sell" ? "border-ember bg-ember/10 text-ember" : "border-line-2 text-fg-2"}`}>Sell / Short</button>
        </fieldset>
        <div className="mt-4 grid grid-cols-2 divide-x divide-line rounded border border-edge text-center">
          <div className="px-2 py-3"><p className="text-label text-fg-3">Bid (you sell)</p><p className={`mt-1 text-data ${side === "sell" ? "text-ember" : "text-fg-2"}`}>{show(prices.bid)}</p></div>
          <div className="px-2 py-3"><p className="text-label text-fg-3">Offer (you buy)</p><p className={`mt-1 text-data ${side === "buy" ? "text-glow" : "text-fg-2"}`}>{show(prices.offer)}</p></div>
          <p className="col-span-2 border-t border-line px-2 py-2 text-label text-fg-3">
            {prices.spreadBps === null ? "No executable quote for this size yet." : <>{live ? "Your executable spread" : "Spread"} for this size <span className="text-fg-2">{(prices.spreadBps / 100).toFixed(2)}%</span> <span className="text-fg-3">({prices.spreadBps} bps)</span></>}
          </p>
        </div>
        <div className="mt-4">
          <label htmlFor={`${id}-size`} className="block text-caption text-fg-2">Size (contracts)</label>
          <input id={`${id}-size`} value={size} inputMode="decimal" maxLength={24} aria-describedby={`${id}-size-note ${id}-size-problems`} onChange={(event) => setTypedSize(event.target.value)} className={INPUT} />
          <p id={`${id}-size-note`} className="mt-1 text-label text-fg-3">
            1 contract = 1 {contractUnit(market)} · {preview.notional === null || qty === 0n ? "Notional —" : `Notional ≈ $${formatFixedPlaces(preview.notional, 2)}`}{preview.notional !== null && qty > 0n && kind !== "market" && triggerPrice !== null && triggerPrice > 0n ? " at the trigger price" : ""}
          </p>
          <div id={`${id}-size-problems`} aria-live="polite" className="space-y-1 text-label leading-relaxed text-ember">
            {sizeMissing && <p className="mt-1 text-fg-3">{NO_SIZE}</p>}
            {sizeProblems.map((p) => <p key={p} className="mt-1">{p}</p>)}
          </div>
        </div>
        <details className="mt-4 rounded border border-line-2">
          <summary className="px-3 py-3.5 text-caption lg:py-2 text-fg-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-glow">Advanced</summary>
          <fieldset className="px-3 pb-3">
            <legend className="sr-only">Slippage bound</legend>
            <p className="text-caption text-fg-2">Slippage bound</p>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {SLIPPAGE_CHOICES.filter((bps) => bps <= market.view.max_slippage_bps).map((bps) => (
                <button key={bps} type="button" aria-pressed={slippage === bps} onClick={() => setSlippage(bps)} className={`min-h-11 rounded border py-2 text-caption lg:min-h-0 focus-visible:outline-2 focus-visible:outline-glow ${slippage === bps ? "border-glow bg-glow/10 text-glow" : "border-line-2 text-fg-2"}`}>{bps} bps</button>
              ))}
            </div>
            <p className="mt-2 text-label leading-relaxed text-fg-3">{kind === "market" ? "The node declines the order if the live price is more than this worse than the quote shown." : "Resting orders fill at the live price when triggered."}</p>
          </fieldset>
        </details>
        <button type="submit" aria-disabled={!canPlace} className={`mt-4 min-h-12 w-full rounded border py-3 text-caption lg:min-h-0 focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:border-line-2 aria-disabled:bg-transparent aria-disabled:text-fg-3 ${side === "buy" ? "border-glow bg-glow/10 text-glow hover:bg-glow/20" : "border-ember bg-ember/10 text-ember hover:bg-ember/20"}`}>
          {state.busy ? "Signing…" : `Trade: ${side === "buy" ? "Buy" : "Sell"} ${market.symbol}`}
        </button>
        {live && <div className="mt-3"><SigningFor /></div>}
        <div aria-live="polite" className="mt-3 space-y-1 text-label leading-relaxed text-ember">
          {gate && <p className="text-fg-2">{gate} {state.wallet && !state.wallet.readOnly && state.eligibility === null && <FundingLink />}</p>}
          {!gate && problems.map((p) => <p key={p}>{p}{p === "Fund your account to trade." && <> <FundingLink /></>}</p>)}
        </div>
      </form>
      <MarketInfo market={market} preview={preview} side={side} price={kind === "market" ? prices.price : null} slippageBps={slippage} />
    </>
  );
}
