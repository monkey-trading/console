"use client";

/** The body of the setup popup's current step. A step that fails or is declined stays on screen, with the reason under its button. */

import { useEffect, useId, useState } from "react";

import { FAUCET_USDC } from "@/lib/engine/faucet-gate";
import type { EligibilityClass } from "@/lib/engine/types";
import type { SetupStep } from "@/lib/setup-steps";
import { attestEligibility, authorizeBrowser, fundWithAnvil, STATEMENTS } from "@/lib/store/actions";
import { dismissSetup, settleFund } from "@/lib/store/setup";
import { formatUsdc } from "@/lib/vault";

import { useConsole, useSession } from "./ConsoleProvider";
import { DepositForm } from "./DepositForm";
import { Notice } from "./Notice";
import { SessionRefusalNote } from "./SessionRefusalNote";
import { useSignGate } from "./SignGate";

const CLASSES: readonly EligibilityClass[] = ["professional", "eligible_client"];
const NOTE = "mt-2 text-caption leading-relaxed text-fg-2";
const PRIMARY = "min-h-11 rounded border border-glow bg-glow/10 px-4 py-2.5 text-caption text-glow hover:bg-glow/20 focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:border-line-2 aria-disabled:bg-transparent aria-disabled:text-fg-3";
const SECONDARY = "min-h-11 rounded border border-line-2 px-4 py-2.5 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow";

/** The current step's text and controls. */
export function SetupSteps({ step }: { step: SetupStep }) {
  const { store } = useSession();
  // A step's failure belongs to that step: the next one starts clean.
  useEffect(() => store.clearNotice("setup"), [store, step]);
  switch (step) {
    case "fund": return <FundStep />;
    case "declare": return <DeclareStep />;
    case "authorize": return <AuthorizeStep />;
    case "deposit": return <DepositStep />;
    default: {
      const unhandled: never = step;
      throw new Error(`no body for setup step ${String(unhandled)}`);
    }
  }
}

/** The dev faucet: mints to the wallet through the local chain, with nothing for the wallet to sign, or is skipped. Nothing else depends on it. */
function FundStep() {
  const { store, deploy } = useSession();
  const { busy } = useConsole();
  const able = !busy;
  return (
    <>
      <p className={NOTE}>The test faucet adds {formatUsdc(FAUCET_USDC)} of test USDC to this wallet and tops up its gas balance to 1 ETH, directly from the local test chain. Your wallet is not asked to sign anything, and the faucet is available only in test versions of the app.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" aria-disabled={!able} onClick={() => { if (able) void fundWithAnvil(store, deploy, "setup").then((funded) => { if (funded) settleFund(store, "minted"); }); }} className={PRIMARY}>{busy ? "Adding funds…" : "Get test funds"}</button>
        <button type="button" onClick={() => settleFund(store, "skipped")} className={SECONDARY}>Skip</button>
      </div>
      <Notice surface="setup" />
    </>
  );
}

/** The eligibility declaration, signed by the wallet. A declaration refused for access closes the popup, as the access gate takes over. */
function DeclareStep() {
  const { store } = useSession();
  const { busy } = useConsole();
  const [choice, setChoice] = useState<EligibilityClass>("professional");
  const gate = useSignGate(`${useId()}-gate`);
  const able = !busy && !gate.blocked;
  return (
    <form onSubmit={(event) => { event.preventDefault(); if (able) void attestEligibility(store, choice); }}>
      <p className={NOTE}>Sign a declaration with your wallet to confirm which category of client you are. The declaration is recorded publicly against your account.</p>
      <fieldset className="mt-4 space-y-2">
        <legend className="sr-only">Client class</legend>
        {CLASSES.map((cls) => (
          <button key={cls} type="button" aria-pressed={choice === cls} onClick={() => setChoice(cls)} className={`min-h-11 w-full rounded border px-3 py-2.5 text-left text-caption focus-visible:outline-2 focus-visible:outline-glow ${choice === cls ? "border-glow bg-glow/10 text-glow" : "border-line-2 text-fg-2 hover:text-fg"}`}>{STATEMENTS[cls]}</button>
        ))}
      </fieldset>
      <button type="submit" aria-disabled={!able} aria-describedby={gate.describedBy} className={`mt-4 ${PRIMARY}`}>{busy ? "Waiting for your wallet…" : "Sign the declaration"}</button>
      {gate.note}
      <Notice surface="setup" />
    </form>
  );
}

/** The one signature that authorizes this browser's session key; a refusal says why, and points to Settings when revoking a key would clear it. */
function AuthorizeStep() {
  const { store } = useSession();
  const { busy } = useConsole();
  const gate = useSignGate(`${useId()}-gate`);
  const able = !busy && !gate.blocked;
  return (
    <>
      <p className={NOTE}>A single wallet signature authorizes this browser to place and cancel orders for 24 hours without further wallet prompts. The authorization cannot move funds, so your wallet will still ask you to approve each deposit, withdrawal and claim.</p>
      <button type="button" aria-disabled={!able} aria-describedby={gate.describedBy} onClick={() => { if (able) void authorizeBrowser(store, "setup"); }} className={`mt-4 ${PRIMARY}`}>{busy ? "Waiting for your wallet…" : "Authorize this browser"}</button>
      {gate.note}
      <Notice surface="setup" />
      <SessionRefusalNote onNavigate={() => dismissSetup(store)} />
    </>
  );
}

/** The deposit itself, in the same form as Funding; once the wallet has sent one, it says so until the node credits it. */
function DepositStep() {
  const { setup } = useConsole();
  if (setup.deposit === null) return <DepositForm embedded />;
  return <p role="status" className={NOTE}>Your deposit is on its way. It will be credited to your account a few blocks after the transaction is confirmed on chain. You can close this window now: the deposit will still be processed, and the Funding page shows its progress.</p>;
}
