/** Shared fixtures for the house log-scan tests: frame builders, canned commands, and scanners over fake sockets. */

import { scanHouse, type HouseScanBudget } from "./live-house";
import { acceptAll, FakeScheduler, FakeSocket } from "./test-kit";
import { VECTORS, vectorResponse } from "./test-vectors";

export const conflict = vectorResponse("nonce conflict");
export const frame = (n: number, msg: object) => JSON.stringify({ v: 1, n, time: 1_000, msg: JSON.stringify(msg), sig: "0x00" });

export const SET_PARAMS = { action: "set_params", profit_fee_bps: 1000, closeout_level_bps: 5000, house_total_cap_bps: 20000, house_total_cap_floor: "2000000" };
export const PARAMS_FIELDS = { profit_fee_bps: 1000, closeout_level_bps: 5000, house_total_cap_bps: 20000, house_total_cap_floor: "2000000" };

export const command = (seq: number, cmd: object, events: object[] = []) => ({ offset: `${seq}:0`, type: "command", seq, ts: 1_000, cmd, events });
export const checkpoint = (seq: number, index = 1) => ({ type: "checkpoint", offset: `${seq}:${index}`, seq, root: `0x${"ab".repeat(32)}` });

export const BUDGET: HouseScanBudget = { maxMessages: 100, maxMs: 30_000 };

/** The shared-rule scan: `run(fromSeq)` starts reading, `scheduler` drives its timeout. */
export function scanning(sockets: FakeSocket[]) {
  const scheduler = new FakeScheduler();
  const deps = {
    origin: "wss://node.test", chainId: 31337, vault: conflict.vault, signer: VECTORS.signer, verifier: acceptAll,
    openSocket: (url: string) => { const socket = new FakeSocket(url); sockets.push(socket); return socket; },
    scheduler, challenge: () => "ab".repeat(32),
  };
  const run = (fromSeq: number, budget: HouseScanBudget = BUDGET, skipPast?: [number, number]) => scanHouse(deps, fromSeq, budget, skipPast);
  return { run, scheduler };
}
