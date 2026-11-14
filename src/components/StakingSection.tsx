"use client";

/**
 * The Staking screen (monkey-trading/console#271) as a section: its heading, the Delegate, Rewards,
 * Epochs and Governance tab bar, and one provider for the reads its tabs share (monkey-trading/console#308).
 * The reads are created once per visit to the section, so what they hold — a typed amount, a loaded
 * page of history, the operator list — survives a tab switch, and the Delegate tab's editing
 * context (its open editor, the Move form's destination, the addresses typed) is kept here too
 * (monkey-trading/console#309). Each tab starts only the reads its cards show, and they stop when
 * the tab is left.
 */

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { readBlock } from "@/lib/engine/attestation";
import { OperatorReads, operatorsShown } from "@/lib/monkey/operators";
import { MonkeyPanel } from "@/lib/monkey/panel";
import { isCurrentTab, readsFor, SECTIONS } from "@/lib/nav";
import { DelegationReads } from "@/lib/staking/delegation-reads";
import { editingFor, keptFor, NO_EDITING, type DelegateEditing, type EditingState, type EditingUpdate } from "@/lib/staking/delegation-form";
import { EpochReads } from "@/lib/staking/epoch-reads";
import { GovernanceReads } from "@/lib/staking/governance-reads";
import { DistributionHistoryReads } from "@/lib/staking/history-reads";
import { MemberVoteReads } from "@/lib/staking/member-vote-reads";
import { NO_TABLE_VIEW, type TableViewState } from "@/lib/staking/operator-table";

import { useSession } from "./ConsoleProvider";
import { MonkeyPanelProvider, useConsoleSelect } from "./monkey/use-monkey";
import { SectionTabs } from "./SectionTabs";

const SECTION = SECTIONS["/staking"];

/** The reads the Staking section's tabs share, and whether its operators card shows. */
export interface StakingReads {
  panel: MonkeyPanel;
  operators: OperatorReads;
  epochs: EpochReads;
  delegations: DelegationReads;
  history: DistributionHistoryReads;
  /** The Governance tab's reads: the node's house state for the votes the log holds, and how the account and the members it delegates to voted. */
  governance: GovernanceReads;
  memberVotes: MemberVoteReads;
  /** Whether the operators card shows: from the node's first verdict, kept through a re-verification. */
  operatorsSettled: boolean;
  /**
   * The Delegate tab's editing context: which row's editor is open, the Move form's destination,
   * the addresses typed and the amounts — kept here, not on the tab, so a tab switch loses none of
   * it.
   */
  delegateEditing: DelegateEditing;
  setDelegateEditing: (next: EditingUpdate) => void;
  /** The operator table's view — its search, sort, page and All/Yours choice — kept here beside the editing context, so the view an open editor sits on survives a tab switch too. */
  table: TableViewState;
  setTable: (next: TableViewState) => void;
  /** Whether the "Delegate to an address" way has been offered on this visit, so its slot stays when the node's current list withdraws it and nothing under it moves (monkey-trading/console#331). */
  typedSlot: boolean;
  setTypedSlot: (next: boolean) => void;
}

/** The context the Staking section provides its tabs; a test harness may stand it in without the section's route. */
export const StakingContext = createContext<StakingReads | null>(null);

/** The Staking section's reads and gates. Throws outside the Staking section. */
export function useStaking(): StakingReads {
  const reads = useContext(StakingContext);
  if (reads === null) throw new Error("useStaking is used outside the Staking section");
  return reads;
}

const hidden = () => document.visibilityState === "hidden";

/** The Staking section: the heading and the sticky tab bar over the tab the route opens. */
export function StakingSection({ children }: { children: ReactNode }) {
  const { store } = useSession();
  const [panel] = useState(() => new MonkeyPanel(store, "staking"));
  const [operators] = useState(() => new OperatorReads(store));
  const [history] = useState(() => new DistributionHistoryReads(store));
  const [epochs] = useState(() => new EpochReads(store));
  const [delegations] = useState(() => new DelegationReads(store));
  const [governance] = useState(() => new GovernanceReads(store));
  const [memberVotes] = useState(() => new MemberVoteReads(store, operators, governance, delegations));
  const trusted = useConsoleSelect((state) => readBlock(state.attestation, state.stream) === null);
  const [shownOnce, setShownOnce] = useState(false);
  const operatorsSettled = useConsoleSelect((state) => operatorsShown(state.attestation, state.stream, shownOnce));
  if (operatorsSettled && !shownOnce) setShownOnce(true);
  // The wallet object changes whenever a wallet connects, even to the same address, and the chain reads follow it.
  const wallet = useConsoleSelect((state) => state.wallet);
  const pathname = usePathname();
  // The tab the route opens; a sub-route the table does not list opens the section's default tab.
  const href = SECTION.tabs.find((tab) => isCurrentTab(pathname, tab.href))?.href ?? "/staking";
  const scrollRef = useRef<HTMLDivElement>(null);
  // A tab switch shows the new tab from its top. Below lg the document scrolls, at lg and up the region
  // does; resetting both is a no-op on whichever does not scroll at the breakpoint.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, [pathname]);
  // Each read starts once and stays started while any shown tab wants it, so moving between two
  // tabs that share one never restarts it; the booleans come from the tab's read table and are the
  // effects' only deps.
  const wanted = readsFor(href);
  const panelWanted = wanted.includes("panel") && trusted;
  const operatorsWanted = wanted.includes("operators");
  const delegationsWanted = wanted.includes("delegations");
  const epochsWanted = trusted && wanted.includes("epochs");
  const historyWanted = trusted && wanted.includes("history");
  const governanceWanted = wanted.includes("governance");
  const votesWanted = wanted.includes("votes");
  useEffect(() => (panelWanted ? panel.start(hidden) : undefined), [panel, panelWanted]);
  useEffect(() => (operatorsWanted ? operators.start(hidden) : undefined), [operators, operatorsWanted]);
  useEffect(() => (delegationsWanted ? delegations.start(hidden) : undefined), [delegations, delegationsWanted]);
  useEffect(() => (epochsWanted ? epochs.start(hidden) : undefined), [epochs, epochsWanted]);
  useEffect(() => (historyWanted ? history.start(hidden) : undefined), [history, historyWanted]);
  useEffect(() => (governanceWanted ? governance.start(hidden) : undefined), [governance, governanceWanted]);
  useEffect(() => (votesWanted ? memberVotes.start(hidden) : undefined), [memberVotes, votesWanted]);
  // The history's registration on the session lives for the section's whole mount, not for its
  // reads' run, so the mock's account reset reaches the retained rows from any tab.
  useEffect(() => {
    history.attach();
    return () => history.detach();
  }, [history]);
  useEffect(() => {
    if (trusted) void panel.refreshWallet();
  }, [panel, trusted, wallet]);
  useEffect(() => history.walletChanged(), [history, wallet]);
  // Writes belong to their render's account; a late completion checks the connected wallet again.
  const account = wallet?.address ?? null;
  const [editingState, setEditingState] = useState<EditingState>({ account, editing: NO_EDITING, issued: 0 });
  const delegateEditing = editingFor(editingState, account);
  const setDelegateEditing = (next: EditingUpdate) => setEditingState((held) => keptFor(account, next, held, store.getSnapshot().wallet?.address ?? null));
  const [table, setTable] = useState<TableViewState>(NO_TABLE_VIEW);
  const [typedSlot, setTypedSlot] = useState(false);
  const reads: StakingReads = { panel, operators, epochs, delegations, history, governance, memberVotes, operatorsSettled, delegateEditing, setDelegateEditing, table, setTable, typedSlot, setTypedSlot };
  return (
    <StakingContext.Provider value={reads}>
      <MonkeyPanelProvider value={panel}>
        {/* Keyboard scrolling needs a tab stop on the scroll container, as on the House and MONKEY pages. Below lg the document scrolls and this region grows with its content (the tab bar sticks to the viewport; scroll-padding on html in globals.css keeps a focused card clear of it); at lg and up the region scrolls and its scroll-padding does the same. */}
        <div ref={scrollRef} role="region" aria-label="Staking details" tabIndex={0} className="relative min-h-0 flex-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-glow lg:overflow-y-auto lg:scroll-pt-12">
          <div className="mx-auto w-full max-w-[110rem] px-4 py-5 max-lg:min-h-dvh sm:px-6">
            <h2 className="text-lead tracking-caps text-glow uppercase">Staking</h2>
            {!trusted && <p className="mt-3 text-data leading-relaxed text-fg-2">Figures appear once the node&apos;s attestation is verified and its feed is live.</p>}
            {/* The tab bar stays in view at the top of the scroll region; its background covers what scrolls under it. A level above the charts' crosshair readout, which is later in the tree at the same z. */}
            <div className="sticky top-0 z-20 -mx-4 mt-4 bg-ink-1 px-4 sm:-mx-6 sm:px-6">
              <SectionTabs section={SECTION} />
            </div>
            {children}
          </div>
        </div>
      </MonkeyPanelProvider>
    </StakingContext.Provider>
  );
}
