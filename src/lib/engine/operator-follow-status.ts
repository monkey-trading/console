/** What the operator follower concludes of the node to use, and the helpers its checks share. */

import { EngineError, type EngineClient } from "./client";
import { hostnameOrigin, listedOrigins, type Deploy } from "./deploy";
import type { Scheduler } from "./live-stream";
import type { OperatorRoute } from "./stats-types";
import type { NamedOperator } from "./registry";

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

/**
 * Where the chain's answer says to connect: the named operator's registered origin when the build
 * lists it, or the build's own node when it never registered a hostname. Turning rotation off leaves
 * the settled operator named, so it says nothing about the host. With rotation on, a hostname the
 * build does not list is a console that needs updating; with it off the operator may be the deployment's own.
 */
export function operatorTarget(deploy: Pick<Deploy, "origin" | "candidateOrigins">, named: Pick<NamedOperator, "hostname" | "rotationEnabled">): { origin: string | null } | { unlisted: string | null } {
  if (named.hostname === null) return { origin: deploy.origin };
  const origin = hostnameOrigin(named.hostname);
  if (origin !== null && listedOrigins(deploy).includes(origin)) return { origin };
  if (!named.rotationEnabled) return { origin: deploy.origin };
  return { unlisted: origin === null ? null : named.hostname.toLowerCase() };
}

/** The earlier of two times that may be absent. */
export function soonest(a: number | null, b: number | null): number | null {
  return a === null ? b : b === null ? a : Math.min(a, b);
}

/** The enclave answered a signed read: an enclave the vault does not name serves only its attestation, and a node that predates the route still signs its 404. */
export async function signedAnswer(client: EngineClient): Promise<void> {
  try {
    await client.stats.operator();
  } catch (error) {
    if (!(error instanceof EngineError && error.status === 404)) throw error;
  }
}

/** How long the wallet may take over one chain read before the check gives up on it, in milliseconds; a wallet asleep must not hold the follower from the next wallet. */
const CHAIN_READ_MS = 30_000;

/** `read`, or a rejection once the wallet has had its time. */
export function bounded<T>(scheduler: Scheduler, read: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = scheduler.setTimeout(() => reject(new Error("your wallet did not answer in time")), CHAIN_READ_MS);
    read.then(
      (value) => { scheduler.clearTimeout(timer); resolve(value); },
      (error: unknown) => { scheduler.clearTimeout(timer); reject(error); },
    );
  });
}

/** A daily turn the node's own schedule names: its member and when its key signs from. */
export interface SaidTurn {
  candidate: string;
  atMs: number;
}

/**
 * What a node says in its signed operator route that decides where the console connects: when its next daily turn begins (null once past
 * or unnamed), the hostname the registry names for the operator in effect, and today's and the next turn; `read` is false when the route
 * could not be read.
 */
export interface NodeSaid {
  turnAtMs: number | null;
  hostname: string | null;
  rotationEnabled: boolean;
  read: boolean;
  turns: readonly SaidTurn[];
}

export const NOTHING_SAID: NodeSaid = { turnAtMs: null, hostname: null, rotationEnabled: true, read: false, turns: [] };

/** What `route` says, at the device clock `nowMs`. */
export function nodeSaid(route: OperatorRoute, nowMs: number): NodeSaid {
  const at = route.next_turn?.applies_at;
  const turns = [route.turn, route.next_turn].flatMap((turn) => (turn ? [{ candidate: turn.candidate.toLowerCase(), atMs: turn.applies_at }] : []));
  return { turnAtMs: at !== undefined && at > nowMs ? at : null, hostname: route.api_hostname?.hostname ?? null, rotationEnabled: route.rotation_enabled, read: true, turns };
}
