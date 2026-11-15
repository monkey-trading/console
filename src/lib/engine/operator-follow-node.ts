/**
 * What the node in use says of where the operator runs (monkey-trading/console#280): its signed
 * operator route, and, for a visit with no wallet to read a chain, the member its own schedule names
 * for each daily turn, which holds from the turn's boundary, before the registry's finalized read
 * the route's hostname comes from names it, and still once the node handing over has stopped.
 */

import type { EngineClient } from "./client";
import type { Scheduler } from "./live-stream";
import { bounded, nodeSaid, NOTHING_SAID, type NodeSaid, type SaidTurn } from "./operator-follow-status";
import type { OperatorRoute } from "./stats-types";
import { RefusedAnswer } from "./trust-errors";

export class NodeWord {
  /** The turns the last answer named, kept through reads that fail. */
  private turns: readonly SaidTurn[] = [];
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
      // A node the vault no longer names still says where the registry now runs the operator (the signed route the refusal carries); any other failure says nothing.
      return error instanceof RefusedAnswer ? this.heard(nodeSaid(error.answer as OperatorRoute, this.nowMs())) : NOTHING_SAID;
    }
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

  private heard(said: NodeSaid): NodeSaid {
    this.turns = said.turns;
    return said;
  }
}
