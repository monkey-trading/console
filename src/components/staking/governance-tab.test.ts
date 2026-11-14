/** Tests for the Governance tab's vote control and proposal items: what each state shows, and the countdown's hold at zero. */

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MONKEY_UNIT } from "@/lib/format";
import { OperatorReads } from "@/lib/monkey/operators";
import { MonkeyPanel } from "@/lib/monkey/panel";
import { DelegationReads } from "@/lib/staking/delegation-reads";
import { NO_EDITING } from "@/lib/staking/delegation-form";
import { EpochReads } from "@/lib/staking/epoch-reads";
import { GovernanceReads } from "@/lib/staking/governance-reads";
import { DistributionHistoryReads } from "@/lib/staking/history-reads";
import { MemberVoteReads } from "@/lib/staking/member-vote-reads";
import { NO_TABLE_VIEW } from "@/lib/staking/operator-table";

import { ConsoleProvider, useSession } from "../ConsoleProvider";
import { StakingContext, type StakingReads } from "../StakingSection";
import { ProposalItem, type ProposalItemProps } from "./ProposalItem";
import { VoteControl, type VoteControlProps } from "./VoteControl";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

/** The Staking section's reads, stood in around `children`, over a session whose clock reads `NOW` and that is `busy` or not. */
function Section({ busy = false, children }: { busy?: boolean; children?: ReactNode }) {
  const { store } = useSession();
  store.patch({ now: NOW, busy });
  const operators = new OperatorReads(store);
  const governance = new GovernanceReads(store);
  const delegations = new DelegationReads(store);
  const reads: StakingReads = {
    panel: new MonkeyPanel(store, "staking"), operators, epochs: new EpochReads(store), delegations, history: new DistributionHistoryReads(store),
    governance, memberVotes: new MemberVoteReads(store, operators, governance, delegations), operatorsSettled: true, delegateEditing: NO_EDITING,
    setDelegateEditing: () => undefined, table: NO_TABLE_VIEW, setTable: () => undefined, typedSlot: false, setTypedSlot: () => undefined,
  };
  return createElement(StakingContext.Provider, { value: reads }, children);
}

const vote = (over: Partial<VoteControlProps> = {}, busy = false) => {
  const props: VoteControlProps = { vote: `0x${"7a".repeat(20)}`, id: 7, standing: "no", weight: 200_000n * MONKEY_UNIT, rotationOn: true, closesAtMs: NOW + DAY, noticeHere: false, headingId: "proposal-open-7", ...over };
  return renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Section, { busy }, createElement(VoteControl, props))));
};

describe("VoteControl", () => {
  it("offers a member that has not voted one yes vote, named for its weight and proposal, with an empty status region ready for the outcome", () => {
    const html = vote();
    expect(html).toContain('aria-label="Vote yes with 200,000 MONKEY on proposal 7"');
    expect(html).toContain(">Vote yes with 200,000 MONKEY</button>");
    expect(html).toContain('aria-disabled="false"');
    expect(html).toContain('<div role="status"></div>');
  });

  it("holds the button while another request is in progress", () => {
    expect(vote({}, true)).toContain('aria-disabled="true"');
  });

  it("says a member voted, in its status region, in place of the button", () => {
    const html = vote({ standing: "yes" });
    expect(html).toMatch(/<div role="status"><p[^>]*>You voted yes with 200,000 MONKEY\.<\/p><\/div>/);
    expect(html).not.toContain("<button");
  });

  it("offers no vote once voting has closed, and says so while rotation is off", () => {
    expect(vote({ closesAtMs: NOW })).not.toContain("<button");
    const off = vote({ rotationOn: false });
    expect(off).toContain("The vote contract takes no votes while operator rotation is off.");
    expect(off).not.toContain("<button");
  });

  it("shows nothing to an account outside the set, or before its set is read, unless its notice is here", () => {
    for (const over of [{ standing: "outside" as const, weight: 0n }, { standing: "unknown" as const, weight: null }, { weight: 0n }]) expect(vote(over)).toBe("");
    expect(vote({ standing: "outside", weight: 0n, noticeHere: true })).toContain('role="alert"');
  });
});

const item = (over: Partial<ProposalItemProps> = {}) => {
  const props: ProposalItemProps = {
    id: 5, headingId: "proposal-waiting-5", fast: false, stage: "waiting", title: "New protocol parameters", details: ["Close-out level 55.00% (now 50.00%)"],
    tally: { yes: 800n * MONKEY_UNIT, total: 1_000n * MONKEY_UNIT }, command: { action: "set_params", closeout_level_bps: 5500 },
    wait: { label: "Applies", atMs: NOW + 7 * DAY - 60_000, reached: "Applying with the node's next command", onReached: () => undefined },
    members: [{ address: "0xa1", label: "alpha.example", standing: "yes" }, { address: "0xb2", label: "bravo.example", standing: "no" }], ...over,
  };
  return renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Section, null, createElement(ProposalItem, props))));
};

describe("ProposalItem", () => {
  it("counts down to its next step in days, with a spoken label, and holds its place at zero until the node moves it on", () => {
    const html = item();
    expect(html).toContain("Applies in 6d 23h 59m");
    expect(html).toContain('aria-label="Applies in 6 days 23 hours"');
    const reached = item({ wait: { label: "Applies", atMs: NOW, reached: "Applying with the node's next command", onReached: () => undefined } });
    expect(reached).toContain("Applying with the node&#x27;s next command");
    expect(reached).not.toContain("Applies in");
  });

  it("shows its number and path, what it does, its tally, how the members voted, and the command as proposed", () => {
    const html = item();
    expect(html).toContain("Proposal 5 · normal path");
    expect(html).toContain('id="proposal-waiting-5"');
    expect(html).toContain("Close-out level 55.00% (now 50.00%)");
    expect(html).toContain("Yes 800 MONKEY of 1,000 MONKEY (80.00%): more than two thirds, so it passed.");
    expect(html).toContain("alpha.example</span> voted yes");
    expect(html).toContain("bravo.example</span> did not vote");
    expect(html).toContain("The command as proposed");
    expect(html).toContain("&quot;closeout_level_bps&quot;: 5500");
  });

  it("says a passed proposal passed when its tally is not read, and leaves out the members it cannot read", () => {
    const html = item({ tally: null, members: null, command: null });
    expect(html).toContain("Passed with more than two thirds of its set&#x27;s weight.");
    expect(html).not.toContain("Members you delegate to");
    expect(html).not.toContain("The command as proposed");
  });
});
