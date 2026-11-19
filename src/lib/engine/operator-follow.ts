/**
 * Which node the console talks to: the one whose hostname the operator the vault names registered (monkey-trading/engine#359 §9), found
 * through the connected wallet's chain reads. The reads are a claim, so they only ever choose among the origins the build lists; a move then
 * re-runs the whole trust path on a new client, whose attestation, release and signer must verify and whose enclave must answer a signed
 * read, before anything leaves the node in use. Until then the node in use stays: the incumbent sequences until the successor has the keys.
 *
 * Chain reads cost the wallet's provider money, so nothing here polls: it reads when a wallet connects, on an election event in the
 * stream, when the enclave fails, at once when the stream of the node in use drops (a handover takes that node's API down, so a drop is
 * no outage until a read finds the operator has not moved, and one around a turn boundary is a change of server from the first moment),
 * just after a pending election's effective time or the node's next daily turn (monkey-trading/console#280), and as `FollowPace` sets.
 */

import type { FeedStatus } from "./attestation";
import type { EngineClient, Unsubscribe } from "./client";
import { DropHold } from "./operator-follow-drop";
import { FollowPace, RETRY_MS } from "./operator-follow-pace";
import { ROTATION_EVENTS } from "./rotation-events";
import { SignerFloorWatch } from "./operator-follow-floor";
import { NodeWord } from "./operator-follow-node";
import { bounded, operatorTarget, refusedRoute, successor, type FollowerDeps, type FollowStatus, type NodeSaid, type WaitingStage } from "./operator-follow-status";
import { runTrial } from "./operator-follow-trial";
import type { DeploymentReads, NamedOperator } from "./registry";

export { operatorTarget, type FollowerDeps, type FollowStatus } from "./operator-follow-status";
export { RETRY_MS, SLOW_READ_MS, SWITCH_RETRY_MS } from "./operator-follow-pace";

export class OperatorFollower {
  private state: FollowStatus;
  private origin: string;
  private readonly listeners = new Set<() => void>();
  private checking: Promise<void> | null = null;
  /** A wallet changed while a check ran: its answer is for the old one, so the check runs again. */
  private again = false;
  private lastCheckAt = 0;
  private isHidden: (() => boolean) | null = null;
  private readonly pace: FollowPace;
  private inUseSinceMs: number; // since the page load or the last move: a boundary before it is the one being left
  /** A drop of the stream of the node in use that no read has explained yet. */
  private readonly drop: DropHold;
  /** The client being tried, kept between attempts so its verifier loads once; dropped when the target changes. */
  private trial: { origin: string; client: EngineClient } | null = null;
  /** The client of the node in use, which a move of the vault's signer judges again. */
  private current: EngineClient | null = null;
  /** The highest signer any signed route this visit read named, from the node in use, a node tried or a node moved away from, refused or not: no node is moved to whose own word lags it, and the node in use is judged against it (monkey-trading/console#373, #374, #377). */
  private readonly floor = new SignerFloorWatch(() => this.current);
  private refused = false; // whether the node in use has lost its verdict
  private skipped = false; // whether a timed read was skipped in a hidden tab, and is owed when the tab is seen
  private readonly word: NodeWord; // what the node in use says of where the operator runs

  constructor(private readonly deps: FollowerDeps) {
    this.word = new NodeWord(deps.scheduler, deps.nowMs);
    this.drop = new DropHold(deps.nowMs);
    this.pace = new FollowPace(deps.scheduler, deps.nowMs);
    this.inUseSinceMs = deps.nowMs();
    this.origin = deps.origin;
    this.state = { kind: "pinned", origin: deps.origin };
  }

  subscribe = (listener: () => void): Unsubscribe => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  getSnapshot = (): FollowStatus => this.state;

  private set(state: FollowStatus): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  /** Starts the timed reads, which skip a hidden tab; returns what stops them. */
  start(isHidden: () => boolean): () => void {
    this.isHidden = isHidden;
    this.arm();
    return () => { this.isHidden = null; this.pace.cancel(); };
  }

  /** Reads again when `client` reports something a change of operator would explain. */
  watch(client: EngineClient): Unsubscribe {
    this.current = client;
    this.refused = false;
    this.pace.streamDown = false;
    this.floor.hear(client);
    const stopEvents = client.watch((event) => {
      if (event.type === "feed") this.feed(event.status);
      if (event.type === "enclave") this.poke();
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
    this.pace.restart();
    void this.check();
  }

  /**
   * The stream of the node in use dropped (`stale`): before the console calls it an outage, it reads where the operator runs, as a page
   * load does, and calls it one only if the operator has not moved. Back (`live`), a drop no read has explained was no change of server.
   */
  private feed(status: FeedStatus): void {
    const { state } = this;
    this.pace.streamDown = status === "stale";
    // Once the store has heard the same frame, so what watches both sees the stream back with the drop explained.
    if (status === "live" && state.kind === "confirming") queueMicrotask(() => { if (this.state === state) this.set(this.drop.end(this.origin)); });
    if (status !== "stale") return;
    this.pace.restart(); // the successor, if this is a handover, serves within seconds
    if (state.kind === "pinned" || state.kind === "following" || state.kind === "failed") this.set(this.drop.begin(state, this.origin, this.word.handoverWindow(this.deps.nowMs(), this.inUseSinceMs)));
    if (this.drop.readsAtOnce() || this.drop.holds(this.state)) void this.check();
    else this.poke();
  }

  /** Reads now, unless it read within `RETRY_MS`, when the read waits out the rest; a check running now may have read before this, so it runs again. */
  poke(): void {
    if (this.checking !== null) {
      this.again = true;
      return;
    }
    const left = this.lastCheckAt + RETRY_MS - this.deps.nowMs();
    if (left <= 0) void this.check();
    // A read already timed sooner, such as a successor's quick retry, keeps its time.
    else if (this.isHidden !== null) this.arm(Math.min(left, this.pace.pendingMs() ?? left));
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
        return;
      }
      // A check that ended without a conclusion of its own, such as one a wallet change cut short, leaves what was concluded before the drop;
      // a drop at a boundary is held until its window passes.
      if (this.state.kind === "confirming" && !this.drop.holds(this.state)) this.set(this.drop.end(this.origin));
      this.arm();
    });
    this.checking = run;
    return run;
  }

  /** Reads the chain, and beside it the node's word on its next turn, so a node that stalls holds nothing from the chain; after a move, the next turn of the node moved to. */
  private async run(): Promise<void> {
    this.pace.cancel();
    const reading = this.current;
    const node = this.word.read(reading);
    try {
      await this.readChain(node);
    } finally {
      const turn = this.current === reading || this.current === null ? node.then((said) => said.turnAtMs) : this.word.nextTurn(this.current);
      // A change under way is retried within seconds whatever the server being left says, which may not answer for a while.
      if (FollowPace.switching(this.state)) void turn.then((at) => { this.pace.turnAtMs = at; });
      else this.pace.turnAtMs = await turn;
    }
  }

  private async readChain(node: Promise<NodeSaid>): Promise<void> {
    this.lastCheckAt = this.deps.nowMs();
    const chain = this.deps.chain();
    const first = chain === null ? this.word.firstTarget(this.deps.deploy, this.state, this.origin, this.deps.nowMs()) : null; // tried at once, as the server being left may not answer for a while; then its word, if it came
    if (first !== null) {
      await this.tryNode(first, null, true);
      const said = await Promise.race([node, Promise.resolve(null)]);
      return said?.read === true && this.state.kind === "waiting" ? this.followNode(said, first) : undefined;
    }
    if (chain === null) return this.followNode(await node);
    const reason = (error: unknown) => (error instanceof Error ? error.message : "the request failed");
    // First, whatever the registry goes on to answer: a retirement or a promotion's `setSigner` ends
    // the verdict on the node in use whatever comes of the operator's node. A move of the release alone
    // does not: the incumbent holds the vault's signer key and keeps sequencing until its successor has taken it.
    let vaultFailed: string | null = null;
    try {
      const facts = await bounded(this.deps.scheduler, chain.vault());
      if (this.deps.chain() !== chain) return; // another wallet came while this ran; `check` runs again for it
      const heeding = this.current?.heedVault(facts, chain) ?? Promise.resolve(); // the server being left may re-verify slowly during a change
      if (FollowPace.switching(this.state)) heeding.catch(() => undefined); // its verdict, failed or not, is its own client's, not the successor's
      else await heeding;
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
    if (named === null) return this.unmoved({ kind: "pinned", origin: this.origin });
    this.pace.effectiveAtMs = named.pending?.effectiveAtMs ?? null;
    const target = operatorTarget(this.deps.deploy, named);
    if ("unlisted" in target) return this.settled({ kind: "unlisted", origin: this.origin, hostname: target.unlisted });
    if (target.origin !== null && target.origin !== this.origin) return this.tryNode(target.origin, chain, named.rotationEnabled);
    // Governance may turn rotation off to install a fallback on the deployment's own node (engine#359 §12), and the registry goes on naming the operator it left.
    const home = this.deps.deploy.origin;
    if (!named.rotationEnabled && this.refused && home !== null && home !== this.origin) return this.tryNode(home, chain, false);
    this.unmoved({ kind: "following", origin: this.origin });
  }

  /**
   * With no wallet to read a chain, the node's own word chooses among the origins the build lists, as the chain's would: the member its schedule
   * names for the turn under way, or the operator the registry names. A node that cannot be read says nothing against either; `tried` was just tried.
   */
  private async followNode(said: NodeSaid, tried: string | null = null): Promise<void> {
    if (said.read) await this.word.learn(this.current);
    if (!said.read && this.state.kind === "waiting") return this.tryNode(this.state.target, null, true);
    const hostname = this.word.hostname(said, this.deps.nowMs());
    const target = hostname === null ? { origin: this.origin } : operatorTarget(this.deps.deploy, { hostname, rotationEnabled: said.rotationEnabled });
    if ("unlisted" in target) return this.settled({ kind: "unlisted", origin: this.origin, hostname: target.unlisted });
    if (target.origin !== null && target.origin !== this.origin) return target.origin === tried ? undefined : this.tryNode(target.origin, null, said.rotationEnabled);
    this.unmoved({ kind: "pinned", origin: this.origin });
  }

  /** A read that failed; a handover under way keeps its pause, as the failed read says nothing of whether the successor verifies. */
  private failed = (reason: string): void => { if (this.state.kind !== "waiting") this.unmoved({ kind: "failed", origin: this.origin, reason }); };

  private settled(state: FollowStatus): void {
    this.trial = null;
    this.set(state);
  }

  /** A read found the operator where the console already is, or failed: a drop at a boundary stays held, as the chain may not yet name the successor. */
  private unmoved(state: FollowStatus): void {
    if (!this.drop.holds(this.state)) return this.settled(state);
    this.trial = null;
    this.drop.keep(state);
  }

  /**
   * Runs the whole trust path against the node at `target`, and moves to it only if it holds. Until it does the node in use stays; with rotation
   * off that is no change of operator on its way, as governance may have installed a fallback on the deployment's own node, so it is not told as one.
   */
  private async tryNode(target: string, chain: DeploymentReads | null, rotationEnabled: boolean, tried: readonly string[] = [this.origin]): Promise<void> {
    const before = this.state; // trading pauses the moment the chain names another node, as its verification takes the time (monkey-trading/console#280)
    // A trial another wallet came during says nothing for it, failed or not: the pause it began goes, unless `check` runs again for the new
    // one, which decides it; going back for a moment would say trading resumed when it has not.
    const abandon = () => { if (!this.again) this.set(before); };
    const waiting = (stage: WaitingStage, reason: string | null = null) => (this.deps.chain() !== chain ? abandon() : rotationEnabled ? this.set({ kind: "waiting", origin: this.origin, target, stage, reason }) : this.settled({ kind: "following", origin: this.origin }));
    if (rotationEnabled && !(this.state.kind === "waiting" && this.state.target === target)) waiting("connecting");
    if (this.trial?.origin !== target) this.trial = { origin: target, client: this.deps.open(target) };
    const { client } = this.trial;
    let answered = false;
    // With no wallet, a node refused for the signer the vault names still says in its signed route where the operator now runs: the next node, among the listed origins, bounded; its client and turns are never taken.
    // A node not serving yet is not refused: a successor answers once it has taken the keys, and signs once its time is confirmed.
    const failed = async (reason: string, error: unknown, notAnswering: boolean): Promise<void> => {
      const route = chain === null ? await refusedRoute(this.deps.scheduler, client, error) : null;
      const next = route === null || this.deps.chain() !== chain ? null : successor(this.deps.deploy, route, [...tried, target]);
      if (route === null || next === null) return notAnswering ? waiting(answered ? "verifying" : "connecting") : waiting("refused", reason);
      if ("unlisted" in next) return this.settled({ kind: "unlisted", origin: this.origin, hostname: next.unlisted });
      return this.tryNode(next.origin, chain, route.rotation_enabled, [...tried, target]);
    };
    const end = await runTrial(client, chain, this.floor, () => {
      answered = true;
      if (rotationEnabled) waiting("verifying");
    });
    if (end.kind === "failed") return failed(end.reason, end.error, end.notReady);
    if (end.kind === "held") return waiting(end.stage, end.reason);
    if (this.deps.chain() !== chain) return abandon();
    if (this.deps.busy()) return waiting("wallet");
    this.deps.adopt(client, target);
    // In use from now, before the provider watches it: a check the floor's refusal of the old node starts reads this one.
    this.current = client;
    this.floor.inUse(client);
    this.origin = target;
    this.inUseSinceMs = this.deps.nowMs();
    this.settled({ kind: "following", origin: target });
  }

  private arm(delay?: number): void {
    this.pace.cancel();
    if (this.isHidden === null) return;
    this.pace.schedule(delay ?? this.pace.next(this.state, this.drop.windowEnd(this.state)), () => {
      // A target that is on its way, or a drop held as one, is worth a read; the rest wait for the tab to be seen.
      if (this.isHidden?.() === true && this.state.kind !== "waiting" && !this.drop.holds(this.state)) {
        this.skipped = true;
        this.arm();
      } else void this.check();
    });
  }
}
