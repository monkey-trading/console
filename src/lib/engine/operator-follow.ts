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
 * pending election's effective time, and otherwise every five minutes while the tab is visible.
 */

import type { AttestationStatus } from "./attestation";
import { EngineError, type EngineClient, type Unsubscribe } from "./client";
import { hostnameOrigin, listedOrigins, type Deploy } from "./deploy";
import type { Scheduler } from "./live-stream";
import type { DeploymentReads, NamedOperator } from "./registry";

/** The slow read, in milliseconds. */
export const SLOW_READ_MS = 5 * 60_000;
/** The first wait before a target that did not verify is tried again, and the least time between event-driven reads, in milliseconds; waits double up to the slow read. */
export const RETRY_MS = 30_000;
/** How long after a pending election's effective time it is read again, so the chain has passed it, in milliseconds. */
const AFTER_EFFECT_MS = 5_000;

/** What the console knows of the node it should talk to; `origin` is the node it talks to now. */
export type FollowStatus =
  /** No chain read decides: no wallet reads a chain, or the build names no registry. */
  | { kind: "pinned"; origin: string }
  /** The node in use is the one the chain names. */
  | { kind: "following"; origin: string }
  /** The chain names `target`, which has not verified yet; the node in use stays. */
  | { kind: "waiting"; origin: string; target: string; reason: string }
  /** The chain names an operator whose hostname this build does not list; `hostname` is null when it is not even a plain host. */
  | { kind: "unlisted"; origin: string; hostname: string | null }
  /** The chain read failed; the node in use stays, and it is tried again. */
  | { kind: "failed"; origin: string; reason: string };

/** Where the chain's answer says to connect: the operator's registered origin when the build lists it, or the build's own node while rotation is off or the operator never registered a hostname. */
export function operatorTarget(deploy: Pick<Deploy, "origin" | "candidateOrigins">, named: NamedOperator): { origin: string | null } | { unlisted: string | null } {
  if (!named.rotationEnabled || named.hostname === null) return { origin: deploy.origin };
  const origin = hostnameOrigin(named.hostname);
  if (origin === null) return { unlisted: null };
  return listedOrigins(deploy).includes(origin) ? { origin } : { unlisted: named.hostname.toLowerCase() };
}

export interface FollowerDeps {
  deploy: Pick<Deploy, "origin" | "candidateOrigins">;
  /** The node the session starts on. */
  origin: string;
  /** The connected wallet's chain reads; null with no wallet that reads a chain. */
  chain(): DeploymentReads | null;
  /** A new client for the node at `origin`. */
  open(origin: string): EngineClient;
  /** Whether a wallet request is in flight, which a move would orphan. */
  busy(): boolean;
  /** Moves the session to `client`, already verified. */
  adopt(client: EngineClient, origin: string): void;
  scheduler: Scheduler;
  nowMs(): number;
}

/** The enclave answered a signed read: an enclave the vault does not name serves only its attestation, and a node that predates the route still signs its 404. */
async function signedAnswer(client: EngineClient): Promise<void> {
  try {
    await client.stats.operator();
  } catch (error) {
    if (!(error instanceof EngineError && error.status === 404)) throw error;
  }
}

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
  /** The pending election's effective time, the one chain event that has a known time. */
  private effectiveAtMs: number | null = null;
  /** The client being tried, kept between attempts so its verifier loads once; dropped when the target changes. */
  private trial: { origin: string; client: EngineClient } | null = null;
  /** The client of the node in use, which a move of the vault's signer judges again. */
  private current: EngineClient | null = null;
  /** The signer the vault last named. */
  private signer: string | null = null;

  constructor(private readonly deps: FollowerDeps) {
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
    const stopEvents = client.watch((event) => {
      if ((event.type === "feed" && event.status === "stale") || event.type === "enclave" || (event.type === "attestation" && event.status.kind === "unverified")) this.poke();
    });
    const stopStream = client.subscribe((message) => {
      if (message.events.some((event) => event.type === "operator_elected" || event.type === "rotation_switched")) this.poke();
    });
    return () => {
      stopEvents();
      stopStream();
    };
  }

  /** Reads now, unless it read within `RETRY_MS`, when the read waits out the rest. */
  poke(): void {
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

  private async run(): Promise<void> {
    this.disarm();
    this.lastCheckAt = this.deps.nowMs();
    const chain = this.deps.chain();
    if (chain === null) return this.settled({ kind: "pinned", origin: this.origin });
    let named: NamedOperator | null;
    try {
      named = await chain.operator();
    } catch (error) {
      return this.set({ kind: "failed", origin: this.origin, reason: error instanceof Error ? error.message : "the read failed" });
    }
    if (named === null) {
      this.settled({ kind: "pinned", origin: this.origin });
      return this.followSigner(chain);
    }
    this.effectiveAtMs = named.pending?.effectiveAtMs ?? null;
    const target = operatorTarget(this.deps.deploy, named);
    if ("unlisted" in target) return this.settled({ kind: "unlisted", origin: this.origin, hostname: target.unlisted });
    if (target.origin !== null && target.origin !== this.origin) return this.tryNode(target.origin, chain);
    this.settled({ kind: "following", origin: this.origin });
    await this.followSigner(chain);
  }

  /**
   * Judges the node in use again if the vault's signer moved, by a retirement or a promotion's
   * `setSigner`, rather than wait for an answer to fail. A move of the release alone does not: the
   * incumbent holds the vault's signer key and keeps sequencing until its successor has taken it.
   */
  private async followSigner(chain: DeploymentReads): Promise<void> {
    try {
      const { signer } = await chain.vault();
      const moved = this.signer !== null && this.signer !== signer;
      this.signer = signer;
      if (moved) await this.current?.verify();
    } catch (error) {
      this.set({ kind: "failed", origin: this.origin, reason: error instanceof Error ? error.message : "the read failed" });
    }
  }

  private settled(state: FollowStatus): void {
    this.wait = RETRY_MS;
    this.trial = null;
    this.set(state);
  }

  /** Runs the whole trust path against the node at `target`, and moves to it only if it holds. */
  private async tryNode(target: string, chain: DeploymentReads): Promise<void> {
    if (this.trial?.origin !== target) this.trial = { origin: target, client: this.deps.open(target) };
    const { client } = this.trial;
    const waiting = (reason: string) => this.set({ kind: "waiting", origin: this.origin, target, reason });
    let status: AttestationStatus;
    try {
      await client.readChainThrough(chain);
      status = await client.verify();
      if (status.kind === "unverified") return waiting(status.reason);
      if (status.kind === "attested") return waiting(status.why);
      await signedAnswer(client);
    } catch (error) {
      return waiting(error instanceof Error ? error.message : "The node did not answer.");
    }
    if (this.deps.chain() !== chain) return; // another wallet came while this ran; `check` runs again for it
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
      if (this.isHidden?.() === true && this.state.kind !== "waiting") this.arm();
      else void this.check();
    }, delay);
  }

  /** What the last read said to wait for: a target coming up or an effective time just past, soon and then slower; the effective time ahead; or the slow read. */
  private nextDelay(): number {
    const untilEffect = this.effectiveAtMs === null ? null : this.effectiveAtMs - this.deps.nowMs();
    if (this.state.kind === "waiting" || (untilEffect !== null && untilEffect <= 0)) {
      const delay = this.wait;
      this.wait = Math.min(this.wait * 2, SLOW_READ_MS);
      return delay;
    }
    return untilEffect === null ? SLOW_READ_MS : Math.min(SLOW_READ_MS, untilEffect + AFTER_EFFECT_MS);
  }
}
