/**
 * Which node the console talks to: the one whose hostname the operator the vault names registered
 * (monkey-trading/engine#359 §9), found through the connected wallet's chain reads. The reads are a
 * claim, so they only ever choose among the origins the build lists; a move then re-runs the whole
 * trust path on a new client, whose attestation, release and signer must verify and whose enclave
 * must answer a signed read, before anything leaves the node in use. Until then the node in use
 * stays: the incumbent keeps sequencing until the successor's enclave has taken the keys.
 *
 * Chain reads cost the wallet's provider money, so nothing here polls: it reads when a wallet
 * connects, on an election event in the stream, when the feed or the enclave fails, right after a
 * pending election's effective time or just after the node's next daily turn begins (monkey-trading/console#280), soon after a read that failed, waiting longer each time up to the
 * slow read, and otherwise every five minutes while the tab is visible.
 */

import type { EngineClient, Unsubscribe } from "./client";
import { ROTATION_EVENTS } from "./rotation-events";
import { NodeWord } from "./operator-follow-node";
import { bounded, lagging, operatorTarget, raised, refusedRoute, signedAnswer, soonest, successor, type FollowerDeps, type FollowStatus, type NodeSaid, type SignerFloor } from "./operator-follow-status";
import type { DeploymentReads, NamedOperator } from "./registry";

export { operatorTarget, type FollowerDeps, type FollowStatus } from "./operator-follow-status";

/** The slow read, in milliseconds. */
export const SLOW_READ_MS = 5 * 60_000;
/** The first wait before a target that did not verify or a read that failed is tried again, and the least time between event-driven reads, in milliseconds; waits double up to the slow read. */
export const RETRY_MS = 30_000;
/** How long after a pending election's effective time it is read again, so the chain has passed it, in milliseconds. */
const AFTER_EFFECT_MS = 5_000;

export class OperatorFollower {
  private state: FollowStatus;
  private origin: string;
  private readonly listeners = new Set<() => void>();
  private checking: Promise<void> | null = null;
  /** A wallet changed while a check ran: its answer is for the old one, so the check runs again. */
  private again = false;
  private lastCheckAt = 0;
  private timer: unknown = null;
  private isHidden: (() => boolean) | null = null;
  private wait = RETRY_MS;
  /** The pending election's effective time, a chain event that has a known time. */
  private effectiveAtMs: number | null = null;
  /** When the node says its next daily turn begins, another; null when it said none. */
  private turnAtMs: number | null = null;
  /** The client being tried, kept between attempts so its verifier loads once; dropped when the target changes. */
  private trial: { origin: string; client: EngineClient } | null = null;
  /** The client of the node in use, which a move of the vault's signer judges again. */
  private current: EngineClient | null = null;
  /** With no wallet, the highest signer a refused node's route named. */
  private floor: SignerFloor | null = null;
  /** Whether the node in use has lost its verdict. */
  private refused = false;
  /** Whether a timed read was skipped in a hidden tab, and is owed when the tab is seen. */
  private skipped = false;
  /** What the node in use says of where the operator runs. */
  private readonly word: NodeWord;

  constructor(private readonly deps: FollowerDeps) {
    this.word = new NodeWord(deps.scheduler, deps.nowMs);
    this.origin = deps.origin;
    this.state = { kind: "pinned", origin: deps.origin };
  }

  subscribe = (listener: () => void): Unsubscribe => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): FollowStatus => this.state;

  private set(state: FollowStatus): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  /** Starts the timed reads, which skip a hidden tab, and returns what stops them. */
  start(isHidden: () => boolean): () => void {
    this.isHidden = isHidden;
    this.arm();
    return () => {
      this.isHidden = null;
      this.disarm();
    };
  }

  /** Reads again when `client` reports something a change of operator would explain. */
  watch(client: EngineClient): Unsubscribe {
    this.current = client;
    this.refused = false;
    const stopEvents = client.watch((event) => {
      if ((event.type === "feed" && event.status === "stale") || event.type === "enclave") this.poke();
      if (event.type !== "attestation") return;
      const refused = event.status.kind === "unverified";
      // The first refusal only: a refused node is asked again on every retry of the stream, and each would cost the wallet a read.
      if (refused && !this.refused) this.poke();
      if (refused || event.status.kind === "mock" || event.status.kind === "verified" || event.status.kind === "attested") this.refused = refused;
    });
    const stopStream = client.subscribe((message) => {
      if (message.events.some((event) => ROTATION_EVENTS.has(event.type))) this.poke();
    });
    return () => {
      stopEvents();
      stopStream();
    };
  }

  /** The tab can be seen again: a timed read skipped while it could not runs now. */
  resume(): void {
    if (!this.skipped) return;
    this.skipped = false;
    // The waits a hidden tab skipped read nothing, so they say nothing of the wallet.
    this.wait = RETRY_MS;
    void this.check();
  }

  /** Reads now, unless it read within `RETRY_MS`, when the read waits out the rest; a check running now may have read before this, so it runs again. */
  poke(): void {
    if (this.checking !== null) {
      this.again = true;
      return;
    }
    const left = this.lastCheckAt + RETRY_MS - this.deps.nowMs();
    if (left <= 0) void this.check();
    else if (this.isHidden !== null) this.arm(left);
  }

  /** Reads the chain and moves to the node it names, if that verifies; joins a check already running, which then runs again for a wallet that changed since. */
  check(): Promise<void> {
    if (this.checking !== null) {
      this.again = true;
      return this.checking;
    }
    const run = this.run().finally(() => {
      this.checking = null;
      if (this.again) {
        this.again = false;
        void this.check();
      } else this.arm();
    });
    this.checking = run;
    return run;
  }

  /** Reads the chain, and beside it the node's word on its next turn, so a node that stalls holds nothing from the chain. */
  private async run(): Promise<void> {
    this.disarm();
    const node = this.word.read(this.current);
    try {
      await this.readChain(node);
    } finally {
      this.turnAtMs = (await node).turnAtMs;
    }
  }

  private async readChain(node: Promise<NodeSaid>): Promise<void> {
    this.lastCheckAt = this.deps.nowMs();
    const chain = this.deps.chain();
    if (chain === null) return this.followNode(await node);
    const reason = (error: unknown) => (error instanceof Error ? error.message : "the read failed");
    // First, whatever the registry goes on to answer: a retirement or a promotion's `setSigner` ends
    // the verdict on the node in use whatever comes of the operator's node. A move of the release alone
    // does not: the incumbent holds the vault's signer key and keeps sequencing until its successor has taken it.
    let vaultFailed: string | null = null;
    try {
      const facts = await bounded(this.deps.scheduler, chain.vault());
      if (this.deps.chain() !== chain) return; // another wallet came while this ran; `check` runs again for it
      await this.current?.heedVault(facts, chain);
    } catch (error) {
      vaultFailed = reason(error);
    }
    let named: NamedOperator | null;
    try {
      named = await bounded(this.deps.scheduler, chain.operator());
    } catch (error) {
      if (this.deps.chain() === chain) this.failed(reason(error));
      return;
    }
    if (this.deps.chain() !== chain) return;
    if (vaultFailed !== null) return this.failed(vaultFailed);
    if (named === null) return this.settled({ kind: "pinned", origin: this.origin });
    this.effectiveAtMs = named.pending?.effectiveAtMs ?? null;
    const target = operatorTarget(this.deps.deploy, named);
    if ("unlisted" in target) return this.settled({ kind: "unlisted", origin: this.origin, hostname: target.unlisted });
    if (target.origin !== null && target.origin !== this.origin) return this.tryNode(target.origin, chain, named.rotationEnabled);
    // Governance may turn rotation off to install a fallback on the deployment's own node (engine#359 §12), and the registry goes on naming the operator it left.
    const home = this.deps.deploy.origin;
    if (!named.rotationEnabled && this.refused && home !== null && home !== this.origin) return this.tryNode(home, chain, false);
    this.settled({ kind: "following", origin: this.origin });
  }

  /**
   * With no wallet to read a chain, the node's own word chooses among the origins the build lists, as the chain's would: the member its
   * schedule names for the turn under way, or the operator the registry names. A node that cannot be read says nothing against either.
   */
  private async followNode(said: NodeSaid): Promise<void> {
    if (said.read) await this.word.learn(this.current);
    if (!said.read && this.state.kind === "waiting") return this.tryNode(this.state.target, null, true);
    const hostname = this.word.hostname(said, this.deps.nowMs());
    const target = hostname === null ? { origin: this.origin } : operatorTarget(this.deps.deploy, { hostname, rotationEnabled: said.rotationEnabled });
    if ("unlisted" in target) return this.settled({ kind: "unlisted", origin: this.origin, hostname: target.unlisted });
    if (target.origin !== null && target.origin !== this.origin) return this.tryNode(target.origin, null, said.rotationEnabled);
    this.settled({ kind: "pinned", origin: this.origin });
  }

  /** A read that failed; a handover under way keeps its pause, as the failed read says nothing of whether the successor verifies. */
  private failed = (reason: string): void => { if (this.state.kind !== "waiting") this.set({ kind: "failed", origin: this.origin, reason }); };

  private settled(state: FollowStatus): void {
    this.trial = null;
    this.set(state);
  }

  /**
   * Runs the whole trust path against the node at `target`, and moves to it only if it holds. Until
   * it does the node in use stays; with rotation off that is no change of operator on its way, as
   * governance may have installed a fallback on the deployment's own node, so it is not told as one.
   */
  private async tryNode(target: string, chain: DeploymentReads | null, rotationEnabled: boolean, tried: readonly string[] = [this.origin]): Promise<void> {
    const before = this.state; // trading pauses the moment the chain names another node, as its verification takes the time (monkey-trading/console#280)
    // A trial another wallet came during says nothing for it, failed or not: the pause it began goes, and `check` runs again for the new one.
    const waiting = (reason: string) => (this.deps.chain() !== chain ? this.set(before) : rotationEnabled ? this.set({ kind: "waiting", origin: this.origin, target, reason }) : this.settled({ kind: "following", origin: this.origin }));
    if (rotationEnabled && !(this.state.kind === "waiting" && this.state.target === target)) waiting("The new operator's node is being verified.");
    let client: EngineClient | null = null;
    // With no wallet, a node refused for the signer the vault names still says in its signed route where the operator now runs: the next node, among the listed origins, bounded; its client and turns are never taken.
    const failed = async (reason: string, error?: unknown): Promise<void> => {
      const route = chain === null && client !== null ? await refusedRoute(this.deps.scheduler, client, error) : null;
      if (route !== null) this.floor = raised(this.floor, route);
      const next = route === null || this.deps.chain() !== chain ? null : successor(this.deps.deploy, route, [...tried, target]);
      if (route === null || next === null) return waiting(reason);
      if ("unlisted" in next) return this.settled({ kind: "unlisted", origin: this.origin, hostname: next.unlisted });
      return this.tryNode(next.origin, chain, route.rotation_enabled, [...tried, target]);
    };
    try {
      if (this.trial?.origin !== target) this.trial = { origin: target, client: this.deps.open(target) };
      ({ client } = this.trial);
      await client.readChainThrough(chain);
      const status = await client.verify();
      if (status.kind === "unverified") return failed(status.reason);
      // With no wallet no verdict reads the vault, so an attested node is the best a visit without one can have; it reads, and never signs.
      if (status.kind === "attested" && chain !== null) return waiting(status.why);
      const said = await signedAnswer(client);
      const behind = chain === null ? lagging(this.floor, said) : null; // each client judges the signer from its own first check, so the refused route's is held here
      if (behind !== null) return waiting(behind);
    } catch (error) {
      return failed(error instanceof Error ? error.message : "The node did not answer.", error);
    }
    if (this.deps.chain() !== chain) return this.set(before);
    if (this.deps.busy()) return waiting("A wallet request is in progress; the console moves once it has finished.");
    this.deps.adopt(client, target);
    this.origin = target;
    this.settled({ kind: "following", origin: target });
  }

  private disarm(): void {
    if (this.timer !== null) this.deps.scheduler.clearTimeout(this.timer);
    this.timer = null;
  }

  private arm(delay = this.nextDelay()): void {
    this.disarm();
    if (this.isHidden === null) return;
    this.timer = this.deps.scheduler.setTimeout(() => {
      this.timer = null;
      // A target that is on its way is worth a read; the rest wait for the tab to be seen.
      if (this.isHidden?.() === true && this.state.kind !== "waiting") {
        this.skipped = true;
        this.arm();
      } else void this.check();
    }, delay);
  }

  /** What the last read said to wait for: a target coming up, a read that failed or an effective time just past, soon and then slower; the effective time ahead; or the slow read. */
  private nextDelay(): number {
    const changeAt = soonest(this.effectiveAtMs, this.turnAtMs);
    const untilEffect = changeAt === null ? null : changeAt - this.deps.nowMs();
    if (this.state.kind === "waiting" || this.state.kind === "failed" || (untilEffect !== null && untilEffect <= 0)) {
      const delay = this.wait;
      this.wait = Math.min(this.wait * 2, SLOW_READ_MS);
      return delay;
    }
    this.wait = RETRY_MS;
    return untilEffect === null ? SLOW_READ_MS : Math.min(SLOW_READ_MS, untilEffect + AFTER_EFFECT_MS);
  }
}
