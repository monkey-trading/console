/** Tests only: a follower over a client whose verdict a test sets, and a chain read it can change. */

import type { AttestationStatus } from "./attestation";
import type { ClientEvent, EngineClient } from "./client";
import { OperatorFollower } from "./operator-follow";
import type { DeploymentReads, NamedOperator, VaultFacts } from "./registry";
import { SignerNaming, type OperatorClaim, type SignerFloor } from "./signer-naming";
import { FakeScheduler } from "./test-kit";
import { RefusedAnswer } from "./trust-errors";
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
  heeded: VaultFacts[] = [];
  heedVault = async (facts: VaultFacts, _chain: DeploymentReads) => { void _chain; this.heeded.push(facts); };
  verify = async () => { this.verifies += 1; return this.verdict; };
  /** The node's signed `/v1/operators`, of which the follower reads each candidate's registered hostname. */
  operatorList: () => Promise<unknown> = async () => ({ candidates: [] });
  stats = { operator: () => this.operatorRead(), operators: () => this.operatorList() };
  /** The signer every route read named, a refused one's included, as a live client's naming keeps it, and reports each rise of, or second key named at its epoch, through `watch`. */
  readonly naming = new SignerNaming(undefined, () => { for (const watcher of this.watchers) watcher({ type: "signer" }); });
  /** Each signer the follower put to this client, oldest first. */
  heard: SignerFloor[] = [];
  signerNamed = () => this.naming.highest;
  heedSigner = (signer: SignerFloor) => { this.heard.push(signer); this.naming.judge(null, { signer }); };
  /** Each signer the follower held this client to when it became the node in use, oldest first. */
  held: SignerFloor[] = [];
  holdSigner = (floor: SignerFloor) => { this.held.push(floor); this.naming.hold(floor); };
  watch(listener: (event: ClientEvent) => void) { this.watchers.add(listener); return () => { this.watchers.delete(listener); }; }
  subscribe(onMessage: (message: StreamMessage) => void) { this.subscribers.add(onMessage); return () => { this.subscribers.delete(onMessage); }; }
  private async operatorRead(): Promise<unknown> {
    try {
      const route = await this.signedRead();
      this.naming.judge(null, route as OperatorClaim); // a test's route has the operator route's shape, or none of its fields
      return route;
    } catch (error) {
      if (error instanceof RefusedAnswer) this.naming.judge(null, error.answer);
      throw error;
    }
  }
}

export function rig(options: { reads?: DeploymentReads | null; operator?: () => Promise<NamedOperator | null>; clients?: Record<string, TrialClient>; deploy?: typeof DEPLOY } = {}) {
  const scheduler = new FakeScheduler();
  let now = 1_000_000;
  let answer = options.operator ?? (async () => named());
  const operatorReads = { count: 0 };
  const reads: DeploymentReads = { vault: async () => ({ release: "0x", signer: "0x" }), operator: () => { operatorReads.count += 1; return answer(); } };
  const held = { chain: options.reads === undefined ? (reads as DeploymentReads | null) : options.reads, busy: false };
  const opened: { origin: string; client: TrialClient }[] = [];
  const adopted: string[] = [];
  const trial = new TrialClient();
  const follower = new OperatorFollower({
    deploy: options.deploy ?? DEPLOY, origin: BUILD, chain: () => held.chain, busy: () => held.busy, scheduler, nowMs: () => now,
    open: (origin) => { const client = options.clients?.[origin] ?? trial; opened.push({ origin, client }); return client as unknown as EngineClient; }, // the follower uses only what TrialClient has
    adopt: (_client, origin) => { adopted.push(origin); },
  });
  return { follower, scheduler, trial, opened, adopted, reads, held, operatorReads, setOperator: (next: () => Promise<NamedOperator | null>) => { answer = next; }, advance: (ms: number) => { now += ms; scheduler.advance(ms); } };
}
