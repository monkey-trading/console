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
const BUTTON = "min-h-11 min-w-11 rounded border border-line-2 px-2 py-1.5 lg:min-h-0 lg:min-w-0 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow";

export function MockControls() {
  const { node, store } = useSession();
  const { markets, selected, attestation, wallet, paused } = useConsole();
  const [open, setOpen] = useState(false);
  const [region, setRegion] = useState<Region>("allowed");
  const id = useId();
  const market = markets.find((m) => m.id === selected);
  const { controls } = node;
  const haltedNow = market ? node.client.state.markets.get(market.id)?.halted === true : false;
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
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="min-h-11 rounded border border-amber/60 px-2.5 py-2 sm:px-3 lg:min-h-0 text-label tracking-caps text-amber uppercase focus-visible:outline-2 focus-visible:outline-glow">
        Mock<span className="max-sm:sr-only"> controls</span>
      </button>
      {open && (
        <div id={id} className="fixed inset-x-4 top-24 z-50 max-h-[calc(100dvh-7rem)] space-y-4 overflow-y-auto sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:w-80 rounded border border-line-2 bg-ink-2 p-4 text-caption shadow-platform">
          <p className="text-label leading-relaxed text-fg-3">Simulated node only. These change the node in your browser to show how the screens behave.{paused && <span className="text-amber"> The simulation is paused, so price shocks and stress changes apply when you press Play.</span>}</p>
          <Select label="Where the node sees you" value={region} options={REGIONS} onChange={changeRegion} />
          <div>
            <Select label="Node attestation" value={controls.attestationMode} options={ATTESTATIONS} onChange={(mode) => { controls.setAttestationMode(mode); void store.checkNode(); }} />
            <p className="mt-1 text-label text-fg-3">Now: {attestation.kind}</p>
          </div>
          {market && (
            <fieldset className="space-y-2">
              <legend className="text-fg-2">{market.symbol}</legend>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={BUTTON} onClick={() => { controls.shock(market.id, -300); void store.refresh(false); }}>Drop 3%</button>
                <button type="button" className={BUTTON} onClick={() => { controls.shock(market.id, 300); void store.refresh(false); }}>Jump 3%</button>
                <button type="button" className={BUTTON} onClick={() => { controls.setHalted(market.id, !haltedNow); void store.refresh(false); }}>{haltedNow ? "Resume market" : "Halt market"}</button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-fg-3">Stress floor</span>
                {Array.from({ length: MAX_STRESS + 1 }, (_, level) => (
                  <button key={level} type="button" className={BUTTON} onClick={() => { controls.setStressFloor(market.id, level); void store.refresh(false); }}>{level}</button>
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
