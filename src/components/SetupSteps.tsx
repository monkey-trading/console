"use client";

/** The body of the setup popup's current step. A step that fails or is declined stays on screen, with the reason in the toast over it. */

import Link from "next/link";
import { useId, useState } from "react";

import { FAUCET_USDC } from "@/lib/engine/faucet";
import type { EligibilityClass } from "@/lib/engine/types";
import { describeReject } from "@/lib/messages";
import { revokeClears, type SetupStep } from "@/lib/setup-steps";
import { attestEligibility, authorizeBrowser, fundWithAnvil, STATEMENTS } from "@/lib/store/actions";
import { dismissSetup, settleFund } from "@/lib/store/setup";
import { formatUsdc } from "@/lib/vault";

import { useConsole, useSession } from "./ConsoleProvider";
import { useSignGate } from "./SignGate";

const CLASSES: readonly EligibilityClass[] = ["professional", "eligible_client"];
const NOTE = "mt-2 text-caption leading-relaxed text-fg-2";
const PRIMARY = "min-h-11 rounded border border-glow bg-glow/10 px-4 py-2.5 text-caption text-glow hover:bg-glow/20 focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:border-line-2 aria-disabled:bg-transparent aria-disabled:text-fg-3";
const SECONDARY = "min-h-11 rounded border border-line-2 px-4 py-2.5 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow";

/** Called once a step's action has done what it asks. */
interface StepProps {
  onDone: () => void;
}

/** The current step's text and controls. */
export function SetupSteps({ step, onDone }: StepProps & { step: SetupStep }) {
  switch (step) {
    case "fund": return <FundStep onDone={onDone} />;
    case "declare": return <DeclareStep onDone={onDone} />;
    case "authorize": return <AuthorizeStep onDone={onDone} />;
    default: {
      const unhandled: never = step;
      throw new Error(`no body for setup step ${String(unhandled)}`);
    }
  }
}

/** The dev faucet: mints to the wallet, or is skipped. Nothing else depends on it. */
function FundStep({ onDone }: StepProps) {
  const { store, deploy } = useSession();
  const { busy } = useConsole();
  const gate = useSignGate(`${useId()}-gate`);
  const able = !busy && !gate.blocked;
  const settle = () => {
    settleFund(store);
    onDone();
  };
  return (
    <>
      <p className={NOTE}>Mint {formatUsdc(FAUCET_USDC)} to this wallet (mock tokens) and top its gas up to 1 ETH. Dev builds only.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" aria-disabled={!able} aria-describedby={gate.describedBy} onClick={() => { if (able) void fundWithAnvil(store, deploy).then((funded) => { if (funded) settle(); }); }} className={PRIMARY}>{busy ? "Waiting for your wallet…" : "Fund with Anvil"}</button>
        <button type="button" onClick={settle} className={SECONDARY}>Skip</button>
      </div>
      {gate.note}
    </>
  );
}

/** The eligibility declaration, signed by the wallet. A declaration refused for access closes the popup, as the access gate takes over. */
function DeclareStep({ onDone }: StepProps) {
  const { store } = useSession();
  const { busy } = useConsole();
  const [choice, setChoice] = useState<EligibilityClass>("professional");
  const gate = useSignGate(`${useId()}-gate`);
  const able = !busy && !gate.blocked;
  return (
    <form onSubmit={(event) => { event.preventDefault(); if (able) void attestEligibility(store, choice).then((recorded) => { if (recorded) onDone(); }); }}>
      <p className={NOTE}>Your wallet signs which kind of client you are. It goes in the public log against your account.</p>
      <fieldset className="mt-4 space-y-2">
        <legend className="sr-only">Client class</legend>
        {CLASSES.map((cls) => (
          <button key={cls} type="button" aria-pressed={choice === cls} onClick={() => setChoice(cls)} className={`min-h-11 w-full rounded border px-3 py-2.5 text-left text-caption focus-visible:outline-2 focus-visible:outline-glow ${choice === cls ? "border-glow bg-glow/10 text-glow" : "border-line-2 text-fg-2 hover:text-fg"}`}>{STATEMENTS[cls]}</button>
        ))}
      </fieldset>
      <button type="submit" aria-disabled={!able} aria-describedby={gate.describedBy} className={`mt-4 ${PRIMARY}`}>{busy ? "Waiting for your wallet…" : "Sign the declaration"}</button>
      {gate.note}
    </form>
  );
}

/** The one signature that authorizes this browser's session key; a refusal says why, and points to Settings when revoking a key would clear it. */
function AuthorizeStep({ onDone }: StepProps) {
  const { store } = useSession();
  const { busy, sessionRefusal } = useConsole();
  const gate = useSignGate(`${useId()}-gate`);
  const able = !busy && !gate.blocked;
  return (
    <>
      <p className={NOTE}>One wallet signature lets this browser place and cancel orders for 24 hours with no more prompts. It can&apos;t move funds: deposits, withdrawals and claims still ask your wallet.</p>
      <button type="button" aria-disabled={!able} aria-describedby={gate.describedBy} onClick={() => { if (able) void authorizeBrowser(store).then((keyed) => { if (keyed) onDone(); }); }} className={`mt-4 ${PRIMARY}`}>{busy ? "Waiting for your wallet…" : "Authorize this browser"}</button>
      {gate.note}
      {sessionRefusal !== null && (
        <p className="mt-3 text-label leading-relaxed text-ember">
          {describeReject(sessionRefusal)} Until this is fixed, each order asks your wallet.
          {revokeClears(sessionRefusal) && <> <Link href="/settings" onClick={() => dismissSetup(store)} className="text-glow underline focus-visible:outline-2 focus-visible:outline-glow">Revoke one in Settings</Link>.</>}
        </p>
      )}
    </>
  );
}
