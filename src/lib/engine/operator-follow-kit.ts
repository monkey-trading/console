/** Tests only: a follower over a client whose verdict a test sets, and a chain read it can change. */

import type { AttestationStatus } from "./attestation";
import type { ClientEvent, EngineClient } from "./client";
import { OperatorFollower } from "./operator-follow";
import type { DeploymentReads, NamedOperator } from "./registry";
import { FakeScheduler } from "./test-kit";
import type { StreamMessage } from "./types";

export const BUILD = "https://build.example";
export const B = "https://b.example";
export const DEPLOY = { origin: BUILD, candidateOrigins: [B, "https://c.example:8443"] };
export const VERIFIED: AttestationStatus = { kind: "verified", release: "r", config: "c", address: "0xk" };
export const named = (partial: Partial<NamedOperator> = {}): NamedOperator => ({ rotationEnabled: true, candidate: "0xb", adminKey: "0xk", sinceMs: 0, hostname: "b.example", pending: null, ...partial });

/** A client whose verdict and signed read a test sets, and whose watch and stream it can drive. */
export class TrialClient {
  verdict: AttestationStatus = VERIFIED;
  signedRead: () => Promise<unknown> = async () => ({});
  chains: (DeploymentReads | null)[] = [];
  verifies = 0;
  watchers = new Set<(event: ClientEvent) => void>();
  subscribers = new Set<(message: StreamMessage) => void>();
  readChainThrough = async (chain: DeploymentReads | null) => { this.chains.push(chain); };
  verify = async () => { this.verifies += 1; return this.verdict; };
  stats = { operator: () => this.signedRead() };
  watch(listener: (event: ClientEvent) => void) { this.watchers.add(listener); return () => { this.watchers.delete(listener); }; }
  subscribe(onMessage: (message: StreamMessage) => void) { this.subscribers.add(onMessage); return () => { this.subscribers.delete(onMessage); }; }
}

export function rig(options: { reads?: DeploymentReads | null; operator?: () => Promise<NamedOperator | null> } = {}) {
  const scheduler = new FakeScheduler();
  let now = 1_000_000;
  let answer = options.operator ?? (async () => named());
  const operatorReads = { count: 0 };
  const reads: DeploymentReads = { vault: async () => ({ release: "0x", signer: "0x" }), operator: () => { operatorReads.count += 1; return answer(); }, candidates: async () => null };
  const held = { chain: options.reads === undefined ? (reads as DeploymentReads | null) : options.reads, busy: false };
  const opened: { origin: string; client: TrialClient }[] = [];
  const adopted: string[] = [];
  const trial = new TrialClient();
  const follower = new OperatorFollower({
    deploy: DEPLOY, origin: BUILD, chain: () => held.chain, busy: () => held.busy, scheduler, nowMs: () => now,
    open: (origin) => { opened.push({ origin, client: trial }); return trial as unknown as EngineClient; }, // the follower uses only what TrialClient has
    adopt: (_client, origin) => { adopted.push(origin); },
  });
  return { follower, scheduler, trial, opened, adopted, reads, held, operatorReads, setOperator: (next: () => Promise<NamedOperator | null>) => { answer = next; }, advance: (ms: number) => { now += ms; scheduler.advance(ms); } };
}
