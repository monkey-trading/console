/** Shared fixtures for the log-scan tests: canned rules and sessions, frame builders, and scanners over fake sockets. */

import { scanForMarks, type ScanBudget } from "./live-marks";
import { sessionRule } from "./mark-session";
import { acceptAll, FakeScheduler, FakeSocket } from "./test-kit";
import { VECTORS, vectorResponse } from "./test-vectors";
import type { MarketId, PriceRules } from "./types";
import type { Verifier } from "./verifier";

/** A verifier whose frame check always fails, for the scan's rejection paths. */
export const rejectFrames: Verifier = {
  verifyAttestation: () => ({ ok: false, reason: "unused" }),
  verifyMockAttestation: () => ({ ok: false, reason: "unused" }),
  verifyResponse: (input) => ({ ok: true, response: { timeMs: Number(input.time) } }),
  openFrames: () => ({ verify: () => ({ ok: false, reason: "bad signature" }) }),
};

export const conflict = vectorResponse("nonce conflict");
export const RULES: Record<number, PriceRules> = { 1: { max_age_ms: 1_000, max_divergence_bps: 100, min_sources: 1 } };
/** The test market trades around the clock, so every quoted price counts. */
export const SESSIONS: Record<number, ReturnType<typeof sessionRule>> = { 1: sessionRule({ kind: "always_open" }) };
export const BUDGET: ScanBudget = { maxMessages: 100, maxMs: 30_000, coverMs: 5_000, stepMs: 1_000 };

export const frame = (n: number, msg: object) => JSON.stringify({ v: 1, n, time: 1_000, msg: JSON.stringify(msg), sig: "0x00" });
export const prices = (seq: number, ts: number, mid: string, source = "a") => ({
  offset: `${seq}:0`, type: "command", seq, ts, cmd: { type: "prices", market: 1, quotes: [{ source, mid, ts }] }, events: [],
});

/** An always-open session rule for each market id, the tests' default. */
export function sessionRulesFor(ids: readonly MarketId[]): Record<number, ReturnType<typeof sessionRule>> {
  return Object.fromEntries(ids.map((id) => [id, sessionRule({ kind: "always_open" })]));
}

function deps(sockets: FakeSocket[], verifier: Verifier = acceptAll) {
  return {
    origin: "wss://node.test", chainId: 31337, vault: conflict.vault, signer: VECTORS.signer, verifier,
    openSocket: (url: string) => { const socket = new FakeSocket(url); sockets.push(socket); return socket; },
    scheduler: new FakeScheduler(), challenge: () => "ab".repeat(32),
  };
}

/** The shared-rule scan: `run(fromSeq)` starts reading, `scheduler` drives its timeout. */
export function scanning(sockets: FakeSocket[]) {
  const d = deps(sockets);
  const run = (fromSeq: number, budget: ScanBudget = BUDGET) => scanForMarks(d, fromSeq, budget, RULES, SESSIONS);
  return { run, scheduler: d.scheduler };
}

/** A scan with its own rules and sessions, for tests the shared set does not fit. */
export function scanWith(sockets: FakeSocket[], rules: Record<number, PriceRules>, sessions: Record<number, ReturnType<typeof sessionRule>>, dead?: () => boolean, verifier?: Verifier) {
  const d = deps(sockets, verifier);
  const found = scanForMarks(d, 40, BUDGET, rules, sessions, dead);
  return { found, scheduler: d.scheduler };
}
