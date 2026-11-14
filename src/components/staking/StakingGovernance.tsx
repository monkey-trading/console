"use client";

/**
 * The Staking section's Governance tab (monkey-trading/console#281): the proposals still taking votes,
 * from the node's operator list, and the passed changes waiting out their notice and the fast-path
 * restrictions in force, from its house state (monkey-trading/engine#548), each with how the members
 * the account delegates to voted, from the chain through the wallet, and a member's own vote. The
 * figures land together, once the node's two reads, the account's delegations and the wallet's first
 * vote read have answered, so nothing on the tab moves when one of them does; a wallet slow to answer
 * holds them back three seconds at most.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { readBlock } from "@/lib/engine/attestation";
import { accountReadsSettled } from "@/lib/staking/delegation-reads";
import { awayLabelShown, focusAfterLeaving, focusLeftCards, governanceGate, stillOpen, type Tally } from "@/lib/staking/governance";
import { commandDetails, commandTitle, failureLine, lifetimeText, limitDetails, limitTitle, listingsKey, listingsOf, walletLine, type InForce } from "@/lib/staking/governance-words";
import { standing, weightIn, type MemberVoteFacts } from "@/lib/staking/member-votes";

import { Notice } from "../Notice";
import { Card } from "../monkey/Card";
import { ReadNote } from "../monkey/ReadNote";
import { NOTE } from "../monkey/styles";
import { useConsoleSelect } from "../monkey/use-monkey";
import { useStaking } from "../StakingSection";
import { ProposalItem, type MemberLine } from "./ProposalItem";
import { useOperatorLabel } from "./use-operator-label";
import { VoteControl } from "./VoteControl";

/** A passed proposal's tally as the chain holds it, once read. */
function chainTally(facts: MemberVoteFacts, id: number): Tally | null {
  const proposal = facts.proposals.get(id);
  return proposal === undefined || proposal === null ? null : { yes: proposal.yes, total: proposal.total };
}

/** How long the figures wait for the wallet's first vote read before they show anyway, as the Delegate tab's operators card waits. */
const VOTES_WAIT_MS = 3_000;

/** A list of proposals in a card, or the sentence that says there are none. */
function Items({ empty, children }: { empty: string; children: ReactNode[] }) {
  return children.length === 0 ? <p className={NOTE}>{empty}</p> : <ul className="space-y-3">{children}</ul>;
}

/** The Governance tab: the open proposals, then the passed changes waiting and the restrictions in force, in two columns from 1280 px. */
export function StakingGovernance() {
  const { operators, governance, memberVotes, delegations } = useStaking();
  const trusted = useConsoleSelect((state) => readBlock(state.attestation, state.stream) === null);
  const wallet = useConsoleSelect((state) => state.wallet);
  const decided = useConsoleSelect((state) => state.walletDecided);
  // Whether the `governance` surface has a notice or the wallet's request to show.
  const speaks = useConsoleSelect((state) => state.notices.governance !== undefined || state.promptAt === "governance");
  // The listings' terms, not the markets themselves, which every price patches.
  const listings = useConsoleSelect((state) => listingsKey(state.markets));
  const market = useMemo(() => listingsOf(listings), [listings]);
  const { list } = useSyncExternalStore(operators.subscribe, operators.getSnapshot, operators.getSnapshot);
  const held = useSyncExternalStore(governance.subscribe, governance.getSnapshot, governance.getSnapshot);
  const votes = useSyncExternalStore(memberVotes.subscribe, memberVotes.getSnapshot, memberVotes.getSnapshot);
  const chain = useSyncExternalStore(delegations.subscribe, delegations.getSnapshot, delegations.getSnapshot);
  const labelOf = useOperatorLabel(operators);
  const readable = votes.status !== "unavailable" && chain.read.status !== "unavailable";
  const votesSettled = !readable || votes.status !== "idle";
  // Once shown, the figures stay: a later read of the wallet only fills in what they hold.
  const [shownOnce, setShownOnce] = useState(false);
  const [waited, setWaited] = useState(false);
  const walletSettled = accountReadsSettled({ wallet, decided, delegations: chain, position: "ready" }) && votesSettled;
  const gate = governanceGate({ list: list.status, held: held.status, wallet: walletSettled, waited, shown: shownOnce });
  const settled = gate === "shown";
  if (settled && !shownOnce) setShownOnce(true);
  useEffect(() => {
    if (gate !== "wallet") return;
    const timer = setTimeout(() => setWaited(true), VOTES_WAIT_MS);
    return () => clearTimeout(timer);
  }, [gate]);
  const inForce: InForce = { params: held.value?.params ?? null, market };
  const proposals = list.value?.proposals ?? null;
  const view = held.value?.view ?? null;
  const account = votes.account;
  const delegated = chain.account !== null && chain.account.toLowerCase() === account ? [...new Set((chain.read.value?.delegations ?? []).map((delegation) => delegation.candidate.toLowerCase()))] : [];
  const open = proposals === null ? [] : view === null ? proposals.open : stillOpen(proposals, view);
  // Focus left in an open proposal that leaves the list goes where that proposal went, as `keep-focus.ts` keeps a tab panel's.
  const focused = useRef<number | null>(null);
  const shown = useRef<readonly number[]>([]);
  const openIds = open.map((proposal) => proposal.id).join(",");
  useEffect(() => {
    const now = openIds === "" ? [] : openIds.split(",").map(Number);
    const left = shown.current.filter((id) => !now.includes(id));
    shown.current = now;
    const active = document.activeElement;
    if (view === null || (active !== null && active !== document.body)) return;
    const target = focusAfterLeaving(left, focused.current, view);
    if (target === null) return;
    focused.current = null;
    document.getElementById(target)?.focus();
  }, [openIds, view]);
  // The cards' grid exists whenever the figures have settled; a proposal's focus is noted wherever in it.
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = grid.current;
    if (list === null) return;
    const noteFocus = (event: FocusEvent) => {
      const item = event.target instanceof HTMLElement ? event.target.closest("[data-proposal]") : null;
      focused.current = item === null ? null : Number(item.getAttribute("data-proposal"));
    };
    // Focus the visitor takes out of the cards is no longer a proposal's to follow, but a removed element fires the same event.
    const forget = (event: FocusEvent) => {
      const from = event.target;
      const movedTo = !(event.relatedTarget instanceof Node) ? "nowhere" : list.contains(event.relatedTarget) ? "cards" : "outside";
      // Whether the element is gone shows once its removal has finished, which the event may precede.
      queueMicrotask(() => {
        if (focusLeftCards(movedTo, !(from instanceof Node) || !from.isConnected)) focused.current = null;
      });
    };
    list.addEventListener("focusin", noteFocus);
    list.addEventListener("focusout", forget);
    return () => {
      list.removeEventListener("focusin", noteFocus);
      list.removeEventListener("focusout", forget);
    };
  }, [settled]);
  const membersOf = (target: { id: number; setId: number | null }): MemberLine[] | null =>
    readable ? delegated.map((address) => ({ address, label: labelOf(address), standing: standing(votes.facts, target, address) })) : null;
  const ttl = view?.restrictionTtlMs ?? null;
  return (
    // The figures are hidden, not unmounted, while the node is not trusted, as on the other tabs.
    <div className={`mt-4 ${trusted ? "grid" : "hidden"} gap-4`}>
      {/* Mounted before any vote, so a vote that lands is read out wherever its proposal now sits. */}
      <p role="status" className="sr-only">{votes.landed === null ? "" : `Your yes vote on proposal ${votes.landed} landed.`}</p>
      <p className={`${NOTE} max-w-prose`}>
        Members of the rotation set vote with the stake the set adopted, and a proposal passes once more than two thirds of its set&apos;s weight has voted yes; a member that does not vote counts against it.
        A normal change takes effect seven days after the engine logs it, so anyone holding a position can act first.
        A fast-path change takes effect at once, but only as a restriction that reduces risk, which lapses {ttl === null ? "after a recorded lifetime" : `after ${lifetimeText(ttl)}`} unless another vote renews it.
      </p>
      {!readable && <p className={NOTE}>{walletLine(wallet, readable)}</p>}
      {/* Said only from a read that succeeded: a failed one is not an empty list. */}
      {readable && settled && chain.read.status === "ready" && delegated.length === 0 && <p className={NOTE}>This account delegates to no member, so no member&apos;s vote is shown for it.</p>}
      {!settled ? (
        <p className={NOTE}>{gate === "wallet" ? "Reading the votes through your wallet…" : "Reading the node's proposals…"}</p>
      ) : (
        <div ref={grid} className="grid items-start gap-4 xl:grid-cols-2">
          <Card id="open-proposals-title" title="Open proposals" aside={list.value === null ? undefined : <span className="text-label text-fg-3">At final block {list.value.block.number}</span>}>
            <ReadNote read={list} />
            {list.value !== null && proposals === null && <p className={NOTE}>This node follows no vote contract.</p>}
            {list.value?.proposalsProblem != null && <p role="status" className="text-caption leading-relaxed text-amber">The node&apos;s open proposals did not pass the console&apos;s check: {list.value.proposalsProblem}</p>}
            {proposals?.unavailable === true && <p role="status" className="text-caption leading-relaxed text-amber">The node could not read the open proposals at its last read; they are read again shortly.</p>}
            {proposals !== null && !proposals.unavailable && (
              <Items empty="No proposal is taking votes.">
                {open.map((proposal) => {
                  const target = { id: proposal.id, setId: proposal.setId };
                  const headingId = `proposal-open-${proposal.id}`;
                  return (
                    <ProposalItem
                      key={proposal.id} id={proposal.id} headingId={headingId} fast={proposal.fast} stage="open" title={commandTitle(proposal.command, inForce)} details={commandDetails(proposal.command, inForce)}
                      tally={proposal.tally} command={proposal.command} members={membersOf(target)}
                      wait={{ label: "Voting closes", atMs: proposal.closesAtMs, reached: "Voting has closed; it leaves this list once the node reads a final block past the close", onReached: () => void operators.refresh() }}
                      vote={account === null ? null : (
                        <VoteControl
                          vote={proposals.vote} id={proposal.id} standing={standing(votes.facts, target, account)} weight={weightIn(votes.facts, target, account)}
                          rotationOn={list.value?.rotationEnabled ?? false} closesAtMs={proposal.closesAtMs} noticeHere={votes.votingOn === proposal.id} headingId={headingId}
                        />
                      )}
                    />
                  );
                })}
              </Items>
            )}
            {proposals?.truncated === true && <p className={NOTE}>The node read the newest proposals only; older ones may still be open.</p>}
            {/* A vote's request or refusal keeps a place once its proposal has left the list. */}
            {awayLabelShown(votes.votingOn, open.map((proposal) => proposal.id), speaks) && (
              <div>
                <p className="text-label tracking-caps text-fg-3 uppercase">Your vote on proposal {votes.votingOn}</p>
                <Notice surface="governance" />
              </div>
            )}
          </Card>
          <div className="grid gap-4">
            <Card id="waiting-changes-title" title="Passed, waiting out the notice">
              <ReadNote read={held} />
              {view !== null && (
                <Items empty="No passed change is waiting.">
                  {view.waiting.map((change) => (
                    <ProposalItem
                      key={change.id} id={change.id} headingId={`proposal-waiting-${change.id}`} fast={false} stage="waiting" title={commandTitle(change.command, inForce)} details={commandDetails(change.command, inForce)}
                      tally={chainTally(votes.facts, change.id)} command={change.command} members={membersOf({ id: change.id, setId: null })}
                      wait={{ label: "Applies", atMs: change.appliesAtMs, reached: "Applying with the node's next command", onReached: () => void governance.refresh() }}
                    />
                  ))}
                </Items>
              )}
            </Card>
            <Card id="restrictions-title" title="Fast-path restrictions in force">
              <ReadNote read={held} />
              {view !== null && (
                <Items empty="No fast-path restriction is in force.">
                  {view.inForce.map((restriction) => (
                    <ProposalItem
                      key={restriction.id} id={restriction.id} headingId={`proposal-restriction-${restriction.id}`} fast stage="in-force" title={limitTitle(restriction.limit, inForce)}
                      details={limitDetails(restriction.limit, { params_baseline: view.paramsBaseline ?? undefined, market_baselines: view.marketBaselines })}
                      tally={chainTally(votes.facts, restriction.id)} command={null} members={membersOf({ id: restriction.id, setId: null })}
                      wait={{ label: "Lapses", atMs: restriction.expiresAtMs, reached: "Lapsing with the node's next command", onReached: () => void governance.refresh() }}
                    />
                  ))}
                </Items>
              )}
            </Card>
          </div>
        </div>
      )}
      {/* Below the cards, so a line that comes and goes with a flaky wallet moves nothing above it. */}
      {chain.read.status === "failed" && <p role="status" className="text-caption leading-relaxed text-amber">{failureLine("your delegations", chain.read.message)}</p>}
      {votes.status === "failed" && <p role="status" className="text-caption leading-relaxed text-amber">{failureLine("the votes", votes.error)}</p>}
    </div>
  );
}
