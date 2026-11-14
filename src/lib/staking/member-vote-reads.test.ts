/** Tests for the Governance tab's chain read of how members voted, and a member's vote, against the mock node and its wallet. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MONKEY_UNIT } from "../format";
import { DEMO_ADDRESS } from "../mock/demo";
import { MockGovernance } from "../mock/governance";
import { castVote, stakeMonkey } from "../monkey/actions";
import { WALLET_READ_EVERY_MS } from "../monkey/live-reads";
import { OperatorReads } from "../monkey/operators";
import { flush, holdReads, setup } from "../monkey/panel-kit";
import { disconnectWallet } from "../store/actions";
import { DelegationReads } from "./delegation-reads";
import { GovernanceReads } from "./governance-reads";
import { MemberVoteReads } from "./member-vote-reads";
import { standing, weightIn } from "./member-votes";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const ME = DEMO_ADDRESS.toLowerCase();

/**
 * The tab's reads over the mock node, with the demo account delegating to the first two candidates;
 * `member` puts the demo account in the set third, between the leaders' weights, so its vote can pass proposal 7.
 */
async function tab({ member = false, hidden = (): boolean => false } = {}) {
  const kit = await setup();
  const state = kit.node.client.state;
  const [alpha, bravo, charlie] = state.operators.candidates.map((candidate) => candidate.address);
  if (alpha === undefined || bravo === undefined || charlie === undefined) throw new Error("the mock lists candidates");
  if (member) state.governance = new MockGovernance(state.now, [{ address: alpha }, { address: bravo }, { address: ME }, { address: charlie }]);
  kit.node.controls.stake(DEMO_ADDRESS, 1_000n * MONKEY_UNIT);
  kit.node.controls.moveDelegation(DEMO_ADDRESS, null, alpha, 600n * MONKEY_UNIT);
  kit.node.controls.moveDelegation(DEMO_ADDRESS, null, bravo, 400n * MONKEY_UNIT);
  const governanceWallet = kit.store.liveWallet?.governance;
  if (governanceWallet === undefined) throw new Error("the mock wallet votes");
  const calls = { voted: 0 };
  const voted = governanceWallet.voted.bind(governanceWallet);
  governanceWallet.voted = (vote, id, who) => { calls.voted += 1; return voted(vote, id, who); };
  const operators = new OperatorReads(kit.store);
  const governance = new GovernanceReads(kit.store);
  const delegations = new DelegationReads(kit.store);
  const votes = new MemberVoteReads(kit.store, operators, governance, delegations);
  const stops = [operators.start(hidden), governance.start(hidden), delegations.start(hidden), votes.start(hidden)];
  await flush();
  return { ...kit, alpha, bravo, charlie, operators, governance, delegations, votes, calls, wallet: governanceWallet, stop: () => { for (const stop of stops) stop(); kit.stop(); } };
}

describe("MemberVoteReads", () => {
  it("reads how the members the account delegates to stand on every proposal shown, open and passed", async () => {
    const { votes, alpha, bravo, stop } = await tab();
    const { status, facts } = votes.getSnapshot();
    expect(status).toBe("ready");
    expect(standing(facts, { id: 7, setId: 1 }, alpha)).toBe("yes");
    expect(standing(facts, { id: 7, setId: 1 }, bravo)).toBe("no");
    expect(standing(facts, { id: 8, setId: 1 }, alpha)).toBe("yes");
    // Passed: the waiting change and the restriction, whose set comes from the chain.
    expect(standing(facts, { id: 5, setId: null }, bravo)).toBe("yes");
    expect(standing(facts, { id: 6, setId: null }, alpha)).toBe("yes");
    expect(facts.proposals.get(5)).toMatchObject({ passed: true, yes: 800_000n * MONKEY_UNIT, total: 1_000_000n * MONKEY_UNIT });
    expect(standing(facts, { id: 7, setId: 1 }, ME)).toBe("outside");
    stop();
  });

  it("reads the open proposals' votes again every 15 seconds, a yes included, and nothing in a hidden tab", async () => {
    const visible = await tab();
    const first = visible.calls.voted;
    await vi.advanceTimersByTimeAsync(WALLET_READ_EVERY_MS);
    // Alpha and bravo on proposals 7 and 8: a passed proposal's answers are final, an open one's are read again.
    expect(visible.calls.voted - first).toBe(4);
    visible.stop();
    const hidden = await tab({ hidden: () => true });
    const before = hidden.calls.voted;
    await vi.advanceTimersByTimeAsync(WALLET_READ_EVERY_MS * 3);
    expect(hidden.calls.voted).toBe(before);
    hidden.stop();
  });

  it("counts as answered with no vote contract shown, so the tab does not wait on it", async () => {
    const kit = await setup();
    const operators = new OperatorReads(kit.store);
    const governance = new GovernanceReads(kit.store);
    const votes = new MemberVoteReads(kit.store, operators, governance, new DelegationReads(kit.store));
    const stop = votes.start(() => false);
    await flush();
    expect(votes.getSnapshot()).toMatchObject({ status: "ready", vote: null });
    stop();
    kit.stop();
  });

  it("reads nothing it keeps while the wallet is on another chain, checked before and after the reads", async () => {
    const { votes, wallet, stop } = await tab();
    const held = votes.getSnapshot().facts;
    let checks = 0;
    wallet.onChain = async () => {
      checks += 1;
      if (checks === 2) throw new Error("your wallet is on chain 1, not chain 31337");
    };
    wallet.voted = async () => true; // what another chain's contract would answer
    await votes.refresh();
    expect(votes.getSnapshot()).toMatchObject({ status: "failed", error: "your wallet is on chain 1, not chain 31337" });
    expect(votes.getSnapshot().facts).toBe(held);
    stop();
  });

  it("reads a passed proposal again when the wallet's chain does not hold it yet (monkey-trading/console#345)", async () => {
    const kit = await setup();
    const governanceWallet = kit.store.liveWallet?.governance;
    if (governanceWallet === undefined) throw new Error("the mock wallet votes");
    const real = governanceWallet.proposal.bind(governanceWallet);
    let behind = true;
    governanceWallet.proposal = (vote, id) => (behind ? Promise.resolve(null) : real(vote, id));
    const operators = new OperatorReads(kit.store);
    const governance = new GovernanceReads(kit.store);
    const delegations = new DelegationReads(kit.store);
    const votes = new MemberVoteReads(kit.store, operators, governance, delegations);
    const stops = [operators.start(() => false), governance.start(() => false), delegations.start(() => false), votes.start(() => false)];
    await flush();
    expect(votes.getSnapshot().facts.proposals.has(5)).toBe(false);
    behind = false;
    await votes.refresh();
    expect(votes.getSnapshot().facts.proposals.get(5)).toMatchObject({ passed: true });
    for (const stop of stops) stop();
    kit.stop();
  });

  it("is unavailable without a wallet that reads the chain, and keeps what it read through a failed read", async () => {
    const { votes, store, wallet, stop } = await tab();
    const held = votes.getSnapshot().facts;
    wallet.voted = () => Promise.reject(new Error("your wallet is on chain 1, not chain 31337"));
    await votes.refresh();
    expect(votes.getSnapshot()).toMatchObject({ status: "failed", error: "your wallet is on chain 1, not chain 31337" });
    expect(votes.getSnapshot().facts).toBe(held);
    disconnectWallet(store);
    await flush();
    expect(votes.getSnapshot()).toMatchObject({ account: null, status: "unavailable" });
    stop();
  });
});

describe("castVote", () => {
  it("votes as a member with one transaction, shows the yes at once, and the node's next answers carry the passed change", async () => {
    const { votes, operators, governance, panel, store, stop } = await tab({ member: true });
    const vote = operators.getSnapshot().list.value?.proposals?.vote ?? "";
    expect(weightIn(votes.getSnapshot().facts, { id: 7, setId: 1 }, ME)).toBe(200_000n * MONKEY_UNIT);
    expect(standing(votes.getSnapshot().facts, { id: 7, setId: 1 }, ME)).toBe("no");
    await expect(castVote(panel, operators, votes, vote, 7)).resolves.toBe(true);
    expect(votes.getSnapshot()).toMatchObject({ votingOn: 7, landed: 7 });
    expect(standing(votes.getSnapshot().facts, { id: 7, setId: 1 }, ME)).toBe("yes");
    expect(store.getSnapshot().notices.governance).toBeUndefined();
    await flush();
    // 500k of 1,000k plus the account's 200k passes: it leaves the open list and waits out its notice.
    expect(operators.getSnapshot().list.value?.proposals?.open.map((proposal) => proposal.id)).toEqual([8]);
    await governance.refresh();
    expect(governance.getSnapshot().value?.view.waiting.map((change) => [change.id, change.appliesAtMs - store.getSnapshot().now])).toEqual([[5, expect.any(Number)], [7, 7 * 86_400_000]]);
    stop();
  });

  it("sends no vote on a verdict that may not sign, saying why at the control, and reads no delegations again after one", async () => {
    const { votes, operators, panel, store, delegations, stop } = await tab({ member: true });
    const vote = operators.getSnapshot().list.value?.proposals?.vote ?? "";
    const attestation = store.getSnapshot().attestation;
    store.patch({ attestation: { kind: "unverified", reason: "the quote did not verify" } });
    await expect(castVote(panel, operators, votes, vote, 7)).resolves.toBe(false);
    expect(store.getSnapshot().notices.governance?.text).toMatch(/^The console will not vote: /);
    store.patch({ attestation });
    let landedAt = "";
    await expect(castVote(panel, operators, votes, vote, 7, () => { landedAt = standing(votes.getSnapshot().facts, { id: 7, setId: 1 }, ME); })).resolves.toBe(true);
    expect(landedAt).toBe("yes");
    expect(delegations.getSnapshot().settling).toBe(false);
    stop();
  });

  it("says at the control why the vote contract refused a vote, and sends nothing", async () => {
    const { votes, operators, panel, store, stop } = await tab({ member: true });
    const vote = operators.getSnapshot().list.value?.proposals?.vote ?? "";
    await expect(castVote(panel, operators, votes, vote, 5)).resolves.toBe(false);
    expect(store.getSnapshot().notices.governance).toMatchObject({ tone: "error", text: "This proposal has already passed, so the vote contract takes no more votes on it and nothing was sent." });
    expect(votes.getSnapshot().votingOn).toBe(5);
    stop();
  });

  it("keeps the notice with the vote the wallet's queue accepted, and a second press the queue refuses does not take it over (monkey-trading/console#344)", async () => {
    const { votes, operators, panel, store, stop } = await tab({ member: true });
    const vote = operators.getSnapshot().list.value?.proposals?.vote ?? "";
    const held = holdReads(store);
    void panel.refreshWallet(true);
    await flush();
    const first = castVote(panel, operators, votes, vote, 7);
    const second = castVote(panel, operators, votes, vote, 8);
    await expect(second).resolves.toBe(false);
    expect(store.getSnapshot().notices.governance?.text).toBe("Your earlier request is still with your wallet.");
    expect(votes.getSnapshot().votingOn).toBe(7);
    held.release();
    await expect(first).resolves.toBe(true);
    expect(votes.getSnapshot().votingOn).toBe(7);
    stop();
  });

  it("puts a refusal at the pressed proposal when no vote of the tab is the one waiting", async () => {
    const { votes, operators, panel, store, stop } = await tab({ member: true });
    const vote = operators.getSnapshot().list.value?.proposals?.vote ?? "";
    const held = holdReads(store);
    void panel.refreshWallet(true);
    await flush();
    const staked = stakeMonkey(panel, MONKEY_UNIT);
    await expect(castVote(panel, operators, votes, vote, 8)).resolves.toBe(false);
    expect(votes.getSnapshot().votingOn).toBe(8);
    held.release();
    await staked;
    // The next vote is a new press: it takes the place.
    await expect(castVote(panel, operators, votes, vote, 7)).resolves.toBe(true);
    expect(votes.getSnapshot().votingOn).toBe(7);
    stop();
  });
});

describe("a change of account (monkey-trading/console#348)", () => {
  it("clears the vote's notice place and landing, so the next account's landing reads out as a new message", async () => {
    const { votes, operators, panel, store, stop } = await tab({ member: true });
    const vote = operators.getSnapshot().list.value?.proposals?.vote ?? "";
    await expect(castVote(panel, operators, votes, vote, 7)).resolves.toBe(true);
    expect(votes.getSnapshot()).toMatchObject({ votingOn: 7, landed: 7 });
    disconnectWallet(store);
    await flush();
    expect(votes.getSnapshot()).toMatchObject({ account: null, votingOn: null, landed: null });
    stop();
  });

  it("does not read a landing out to the account the wallet has moved to", async () => {
    const { votes, operators, stop } = await tab({ member: true });
    const vote = operators.getSnapshot().list.value?.proposals?.vote ?? "";
    votes.votedLanded(vote, 7, "0x00000000000000000000000000000000000000b2");
    expect(votes.getSnapshot().landed).toBeNull();
    votes.votedLanded(vote, 7, DEMO_ADDRESS);
    expect(votes.getSnapshot().landed).toBe(7);
    stop();
  });
});
