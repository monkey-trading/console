/**
 * What the node in use says of where the operator runs (monkey-trading/console#280): its signed
 * operator route, and, for a visit with no wallet to read a chain, the member its own schedule names
 * for each daily turn, which holds from the turn's boundary, before the registry's finalized read
 * the route's hostname comes from names it, and still once the node handing over has stopped.
 */

import type { EngineClient } from "./client";
import type { Deploy } from "./deploy";
import type { Scheduler } from "./live-stream";
import { FollowPace } from "./operator-follow-pace";
import { bounded, nodeSaid, NOTHING_SAID, operatorTarget, type FollowStatus, type NodeSaid, type SaidTurn } from "./operator-follow-status";
import { CLOCK_TOLERANCE_MS } from "./transport";
import { notReady, RefusedAnswer } from "./trust-errors";

/**
 * How long after a turn's boundary its member may take to serve, in milliseconds: the engine's own allowance for a member coming up
 * (`COMING_UP` in its `node/member/turn.rs`), half a turn and at most five minutes.
 */
const COMING_UP_MS = 5 * 60_000;
/** The boundaries kept, oldest first: enough to tell the member before a boundary from the one after it. */
const KEPT_BOUNDARIES = 4;

export class NodeWord {
  /** The turns the last answer named, kept through reads that fail. */
  private turns: readonly SaidTurn[] = [];
  /** Every turn any answer named, by boundary, the latest `KEPT_BOUNDARIES`, oldest first. */
  private boundaries: readonly SaidTurn[] = [];
  /** Each member's registered hostname, from the node's signed operator list. */
  private readonly hostOf = new Map<string, string>();

  constructor(private readonly scheduler: Scheduler, private readonly nowMs: () => number) {}

  /**
   * What the node in use says in its signed operator route that decides where the console connects (`nodeSaid`); nothing when it
   * cannot be read. The read is a signed one, so it also lets the client judge the signer the vault names.
   */
  async read(current: EngineClient | null): Promise<NodeSaid> {
    if (current === null) return NOTHING_SAID;
    try {
      return this.heard(nodeSaid(await bounded(this.scheduler, current.stats.operator({ limit: 1 })), this.nowMs()));
    } catch (error) {
      // A node not serving yet says nothing, and its turns stay as they were heard.
      if (!(error instanceof RefusedAnswer) || notReady(error)) return NOTHING_SAID;
      // A node the vault no longer names still says where the registry now runs the operator (the signed route the refusal carries), but
      // its own turns are not the operator's: a node promoted past has stopped mirroring them, so the registry's word decides.
      this.turns = [];
      return nodeSaid(error.answer, this.nowMs());
    }
  }

  /**
   * When the next turn begins by a node just moved to, whose turns are kept only as boundaries: the turns the console follows with no
   * wallet stay those of the node that named them, until a check reads the node in use. Null when it cannot be read or names none.
   */
  async nextTurn(moved: EngineClient): Promise<number | null> {
    const route = await bounded(this.scheduler, moved.stats.operator({ limit: 1 })).catch(() => null);
    if (route === null) return null;
    const said = nodeSaid(route, this.nowMs());
    this.keep(said.turns);
    return said.turnAtMs;
  }

  /**
   * Reads, from `current`'s signed operator list, the registered hostname of each member the kept turns name that is not known yet.
   * A list that cannot be read leaves them unknown, and the route's own hostname decides.
   */
  async learn(current: EngineClient | null): Promise<void> {
    if (current === null || this.turns.every((turn) => this.hostOf.has(turn.candidate))) return;
    const list = await bounded(this.scheduler, current.stats.operators()).catch(() => null);
    for (const candidate of list?.candidates ?? []) this.hostOf.set(candidate.address.toLowerCase(), candidate.api_hostname);
  }

  /** The hostname to follow at `nowMs`: that of the member the kept turns name then (the latest whose key signs from at or before it), when known; otherwise the route's own. */
  hostname(said: NodeSaid, nowMs: number): string | null {
    let member: SaidTurn | null = null;
    for (const turn of this.turns) if (turn.atMs <= nowMs && (member === null || turn.atMs >= member.atMs)) member = turn;
    return (member === null ? undefined : this.hostOf.get(member.candidate)) ?? said.hostname;
  }

  /**
   * The origin to try before anything is read, while a change of server is under way with no wallet to read a chain: the target a pause
   * waits on, or, for a drop held at a boundary, the member the turns heard name now when it is another listed node. Null otherwise.
   */
  firstTarget(deploy: Pick<Deploy, "origin" | "candidateOrigins">, state: FollowStatus, origin: string, nowMs: number): string | null {
    if (!FollowPace.switching(state)) return null;
    if (state.kind === "waiting") return state.target;
    const hostname = this.hostname(NOTHING_SAID, nowMs);
    const target = hostname === null ? null : operatorTarget(deploy, { hostname, rotationEnabled: true });
    return target !== null && "origin" in target && target.origin !== null && target.origin !== origin ? target.origin : null;
  }

  /**
   * The end of the stretch around a turn boundary at which the member changes that `nowMs` falls in, or null for none: from the device
   * clock's tolerance before the boundary to the time its member may take to serve. A boundary whose earlier member is unknown counts; one
   * the node in use came into use at or after (`inUseSinceMs`), as the member it brought, does not.
   */
  handoverWindow(nowMs: number, inUseSinceMs: number): number | null {
    for (const [i, turn] of this.boundaries.entries()) {
      const before = this.boundaries[i - 1];
      const after = this.boundaries[i + 1];
      if (before?.candidate === turn.candidate || inUseSinceMs >= turn.atMs) continue;
      // Turns are all one length, read from the boundary after this one or, before that is drawn, the one before.
      const length = after !== undefined ? after.atMs - turn.atMs : before !== undefined ? turn.atMs - before.atMs : null;
      const end = turn.atMs + Math.min(COMING_UP_MS, length === null ? COMING_UP_MS : length / 2);
      if (nowMs >= turn.atMs - CLOCK_TOLERANCE_MS && nowMs < end) return end;
    }
    return null;
  }

  private heard(said: NodeSaid): NodeSaid {
    this.turns = said.turns;
    this.keep(said.turns);
    return said;
  }

  private keep(turns: readonly SaidTurn[]): void {
    const byBoundary = new Map(this.boundaries.map((turn) => [turn.atMs, turn]));
    for (const turn of turns) byBoundary.set(turn.atMs, turn);
    this.boundaries = [...byBoundary.values()].sort((a, b) => a.atMs - b.atMs).slice(-KEPT_BOUNDARIES);
  }
}
