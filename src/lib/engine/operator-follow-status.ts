/** What the operator follower concludes of the node to use, and the helpers its checks share. */

import { EngineError, type EngineClient } from "./client";
import { hostnameOrigin, listedOrigins, type Deploy } from "./deploy";
import type { Scheduler } from "./live-stream";
import type { OperatorRoute } from "./stats-types";
import { RefusedAnswer } from "./trust-errors";
import type { DeploymentReads, NamedOperator } from "./registry";
import type { NamedSigner } from "./signer-naming";

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

/** The enclave answered a signed read, and its route: an enclave the vault does not name serves only its attestation, and a node that predates the route still signs its 404, which answers null. */
export async function signedAnswer(client: EngineClient): Promise<OperatorRoute | null> {
  try {
    return await client.stats.operator();
  } catch (error) {
    if (!(error instanceof EngineError && error.status === 404)) throw error;
    return null;
  }
}

/** The highest signer a visit has read named, by epoch, which no node it moves to may lag behind. */
export type SignerFloor = { epoch: number; address: string };

/** `floor` raised by `named`, the highest signer a client's signed routes named; `floor` itself when that is no higher. */
export function raised(floor: SignerFloor | null, named: Readonly<NamedSigner> | null): SignerFloor | null {
  return named !== null && (floor === null || named.epoch > floor.epoch) ? { epoch: named.epoch, address: named.address.toLowerCase() } : floor;
}

/** Why a node whose route is `route` is not taken under `floor`: its own word on the signer is older than that, names another key at that epoch, or is absent. */
export function lagging(floor: SignerFloor | null, route: OperatorRoute | null): string | null {
  if (floor === null) return null;
  const named = route?.signer;
  if (named !== undefined && (named.epoch > floor.epoch || (named.epoch === floor.epoch && named.address.toLowerCase() === floor.address))) return null;
  return "A node named a newer signer than this node states, so this node's answers are not taken yet.";
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

/** How many nodes past the one in use a visit with no wallet follows in one run: each refused node's signed route names the next. */
export const MAX_SUCCESSIVE_MOVES = 3;

/** The signed route a refused node answers with: the one `error` carries, or, when the node answered a verdict instead of failing, the one its refusal keeps; null for a node that is not refused. */
export async function refusedRoute(scheduler: Scheduler, client: EngineClient, error?: unknown): Promise<OperatorRoute | null> {
  if (error instanceof RefusedAnswer) return error.answer;
  if (error !== undefined) return null;
  try {
    await bounded(scheduler, client.stats.operator({ limit: 1 }));
    return null;
  } catch (read) {
    return read instanceof RefusedAnswer ? read.answer : null;
  }
}

/** Where `route` says the operator runs, when it is a node not yet `tried` and within the bound on successive moves; or that the build does not list it. */
export function successor(deploy: Pick<Deploy, "origin" | "candidateOrigins">, route: OperatorRoute, tried: readonly string[]): { origin: string } | { unlisted: string | null } | null {
  const hostname = route.api_hostname?.hostname;
  if (hostname === undefined || tried.length > MAX_SUCCESSIVE_MOVES) return null;
  const target = operatorTarget(deploy, { hostname, rotationEnabled: route.rotation_enabled });
  if ("unlisted" in target) return target;
  return target.origin === null || tried.includes(target.origin) ? null : { origin: target.origin };
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
