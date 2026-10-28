"use client";

/** The mock build's controls: push the simulated node into each state the screens must handle. */

import { useId, useState } from "react";

import { EMBER_CANDIDATES, emberFor } from "@/lib/ember";
import { fixedFromInt } from "@/lib/fixed";
import type { Region } from "@/lib/mock/state";
import { MAX_STRESS } from "@/lib/pricing";

import { useConsole, useSession } from "./ConsoleProvider";

const BUTTON = "rounded border border-line-2 px-2 py-1.5 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow";

export function MockControls() {
  const { node, store } = useSession();
  const { markets, selected, attestation, downCandles, ember } = useConsole();
  const [open, setOpen] = useState(false);
  const [region, setRegion] = useState<Region>("allowed");
  const id = useId();
  const market = markets.find((m) => m.id === selected);
  const { controls } = node;
  const changeRegion = (value: Region) => {
    setRegion(value);
    controls.setRegion(value);
    void store.checkNode();
  };
  return (
    <div className="relative">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="rounded border border-amber/60 px-3 py-2 text-label tracking-caps text-amber uppercase focus-visible:outline-2 focus-visible:outline-glow">
        Mock controls
      </button>
      {open && (
        <div id={id} className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] space-y-4 rounded border border-line-2 bg-ink-2 p-4 text-caption shadow-platform">
          <p className="text-label leading-relaxed text-fg-3">Simulated node only. These change the node in your browser to show how the screens behave.</p>
          <label className="block text-fg-2">
            Where the node sees you
            <select value={region} onChange={(event) => changeRegion(event.target.value as Region)} className="mt-1 w-full rounded border border-line-2 bg-ink px-2 py-1.5 text-fg">
              <option value="allowed">Allowed region</option>
              <option value="united_states">United States</option>
              <option value="sanctioned_jurisdiction">Sanctioned jurisdiction</option>
            </select>
          </label>
          <label className="block text-fg-2">
            Node attestation
            <select
              value={controls.attestationMode}
              onChange={(event) => {
                controls.setAttestationMode(event.target.value === "mock" ? "mock" : "unverifiable");
                void store.checkNode();
              }}
              className="mt-1 w-full rounded border border-line-2 bg-ink px-2 py-1.5 text-fg"
            >
              <option value="mock">Mock quote (accepted in this build)</option>
              <option value="unverifiable">Hardware quote (cannot be verified)</option>
            </select>
            <span className="mt-1 block text-label text-fg-3">Now: {attestation.kind}</span>
          </label>
          <label className="block text-fg-2">
            Down candles <span className="text-label text-amber">(temporary design aid)</span>
            <select value={downCandles} onChange={(event) => store.setDownCandles(event.target.value === "ember" ? "ember" : "fg-2")} className="mt-1 w-full rounded border border-line-2 bg-ink px-2 py-1.5 text-fg">
              <option value="fg-2">Hollow, grey outline</option>
              <option value="ember">Hollow, red outline</option>
            </select>
          </label>
          <label className="block text-fg-2">
            Ember colour <span className="text-label text-amber">(temporary design aid)</span>
            <select
              value={ember}
              onChange={(event) => {
                const next = emberFor(event.target.value);
                document.documentElement.style.setProperty("--color-ember", next.base);
                document.documentElement.style.setProperty("--color-ember-hover", next.hover);
                store.setEmber(next.id);
              }}
              className="mt-1 w-full rounded border border-line-2 bg-ink px-2 py-1.5 text-fg"
            >
              {EMBER_CANDIDATES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          {market && (
            <fieldset className="space-y-2">
              <legend className="text-fg-2">{market.symbol}</legend>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={BUTTON} onClick={() => controls.shock(market.id, -300)}>Drop 3%</button>
                <button type="button" className={BUTTON} onClick={() => controls.shock(market.id, 300)}>Jump 3%</button>
                <button type="button" className={BUTTON} onClick={() => controls.setHalted(market.id, market.open)}>{market.open ? "Halt market" : "Resume market"}</button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-fg-3">Stress floor</span>
                {Array.from({ length: MAX_STRESS + 1 }, (_, level) => (
                  <button key={level} type="button" className={BUTTON} onClick={() => controls.setStressFloor(market.id, level)}>{level}</button>
                ))}
              </div>
            </fieldset>
          )}
          <button type="button" className={BUTTON} onClick={() => controls.addLiquidity(fixedFromInt(100_000))}>Add $100,000 vault liquidity</button>
        </div>
      )}
    </div>
  );
}
