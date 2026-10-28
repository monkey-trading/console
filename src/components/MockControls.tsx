"use client";

/** The mock build's controls: push the simulated node into each state the screens must handle. */

import { useId, useState } from "react";

import { fixedFromInt } from "@/lib/fixed";
import type { Region } from "@/lib/mock/state";
import { MAX_STRESS } from "@/lib/pricing";

import { useConsole, useSession } from "./ConsoleProvider";
import { Select } from "./Select";

const REGIONS = [
  { value: "allowed", label: "Allowed region" },
  { value: "united_states", label: "United States" },
  { value: "sanctioned_jurisdiction", label: "Sanctioned jurisdiction" },
] as const;
const ATTESTATIONS = [
  { value: "mock", label: "Mock quote (accepted in this build)" },
  { value: "unverifiable", label: "Hardware quote (cannot be verified)" },
] as const;
const BUTTON = "rounded border border-line-2 px-2 py-1.5 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow";

export function MockControls() {
  const { node, store } = useSession();
  const { markets, selected, attestation, wallet } = useConsole();
  const [open, setOpen] = useState(false);
  const [region, setRegion] = useState<Region>("allowed");
  const id = useId();
  const market = markets.find((m) => m.id === selected);
  const { controls } = node;
  const resetDemoAccount = () => {
    if (!wallet) return;
    controls.resetAccount(wallet.address);
    void store.refresh(true);
  };
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
          <Select label="Where the node sees you" value={region} options={REGIONS} onChange={changeRegion} />
          <div>
            <Select label="Node attestation" value={controls.attestationMode} options={ATTESTATIONS} onChange={(mode) => { controls.setAttestationMode(mode); void store.checkNode(); }} />
            <p className="mt-1 text-label text-fg-3">Now: {attestation.kind}</p>
          </div>
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
          <div>
            <button type="button" className={BUTTON} onClick={() => resetDemoAccount()}>Reset to an empty account</button>
            <p className="mt-1 text-label leading-relaxed text-fg-3">Clears the demo account's balance, positions, orders and history so the empty states show. Reload the page to restore it.</p>
          </div>
        </div>
      )}
    </div>
  );
}
