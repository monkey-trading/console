/** Tests only: a started store with a session list over it, and a scripted history for it to read. */

import vectors from "../engine/eip712-vectors.json";
import { requestDomain } from "../engine/eip712";
import type { Scheduler } from "../engine/live-stream";
import { settle } from "../engine/test-kit";
import type { EngineEvent, HistoryEvent, HistoryPage, StreamMessage } from "../engine/types";
import { ACCOUNT } from "../engine/wallet-kit";
import { compareCursors } from "../live-keys";
import { loginSession } from "./session";
import { connected, NODE_TIME, VAULT, type ActionClient } from "./live-kit";
import { SessionList } from "./session-list";

export const DOMAIN = requestDomain(vectors.chain_id, VAULT);
export const OTHER_KEY = "0x00000000000000000000000000000000000000aa";
export const H = 3_600_000;

/** A scheduler that records its timers and fires them on demand, so no test waits. */
export class ManualScheduler implements Scheduler {
  timers: { id: number; run: () => void; ms: number }[] = [];
  private next = 1;
  setTimeout(run: () => void, ms: number) { const id = this.next++; this.timers.push({ id, run, ms }); return id; }
  clearTimeout(handle: unknown) { this.timers = this.timers.filter((t) => t.id !== handle); }
  fire() { const [timer] = this.timers; this.timers = []; timer?.run(); }
}

export const registered = (cursor: string, key: string, ts: number, expiresAt: number): HistoryEvent => ({ type: "session_key_registered", account: ACCOUNT, session_key: key, expires_at: expiresAt, cursor, ts });
export const revokedAt = (cursor: string, key: string, ts: number): HistoryEvent => ({ type: "session_key_revoked", account: ACCOUNT, session_key: key, cursor, ts });
export const message = (events: EngineEvent[]): StreamMessage => ({ offset: "1:0", type: "command", seq: 1, ts: NODE_TIME, cmd: { type: "tick" }, events });

/** Serves `events` (newest first) from the client's history route, as the node filters it by kind, and counts the reads by kind. */
export function serve(client: ActionClient, events: () => HistoryEvent[]) {
  const reads: string[] = [];
  client.history = async (_address, params) => {
    reads.push(params.kind ?? "");
    const matching = events().filter((e) => e.type === params.kind && (params.before === undefined || compareCursors(e.cursor, params.before) < 0));
    const page: HistoryPage = { events: matching, next: null };
    return page;
  };
  return reads;
}

/** A started store with a session list over it, open, over a history with this browser's key and another's. */
export async function opened(login = true) {
  const kit = await connected();
  kit.store.patch({ now: NODE_TIME });
  if (login) await loginSession(kit.store);
  const own = kit.store.sessionKey?.address ?? "0x00000000000000000000000000000000000000ee";
  let events: HistoryEvent[] = [registered("9:0", OTHER_KEY, NODE_TIME - H, NODE_TIME + 20 * H), registered("5:0", own, NODE_TIME - 3 * H, NODE_TIME + 20 * H)];
  const reads = serve(kit.client, () => events);
  let hidden = false;
  const scheduler = new ManualScheduler();
  const list = new SessionList(kit.store, () => hidden, scheduler);
  const close = list.open();
  await settle();
  return { ...kit, list, scheduler, close, own, reads, setEvents: (next: HistoryEvent[]) => { events = next; }, hide: (value: boolean) => { hidden = value; } };
}

export const walletSignatures = (provider: { calls: { method: string }[] }) => provider.calls.filter((c) => c.method === "eth_signTypedData_v4").length;
export const registeredReads = (reads: string[]) => reads.filter((kind) => kind === "session_key_registered").length;

