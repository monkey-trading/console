/**
 * The account's live session keys, from the public history route: the `session_key_registered` and
 * `session_key_revoked` events it serves (monkey-trading/console#169). Nothing private about a
 * session is read or kept: a key is its address, when its registration was sequenced and when it
 * expires.
 */

import type { HistoryPage } from "./engine/types";
import { formatSpan } from "./time";

/** No key outlives its registration by more than this (`MAX_SESSION_KEY_EXPIRY_MS`), so older events cannot matter. */
export const KEY_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** Events per page, and the most pages one kind is read through: a bound on what an account with a flood of registrations costs. */
const PAGE_LIMIT = 100;
const MAX_PAGES = 10;

export interface LiveKey {
  address: string;
  /** Unix milliseconds the latest registration was sequenced. */
  startedAt: number;
  /** Unix milliseconds. */
  expiresAt: number;
}

/** Reads one page of the account's history of one event kind, newest first. */
export type ReadHistory = (params: { limit: number; before?: string; kind: string }) => Promise<HistoryPage>;

/** Orders two `<seq>:<index>` cursors; positive when `a` is later in the log. */
export function compareCursors(a: string, b: string): number {
  const [aSeq = 0, aIndex = 0] = a.split(":").map(Number);
  const [bSeq = 0, bIndex = 0] = b.split(":").map(Number);
  return aSeq - bSeq || aIndex - bIndex;
}

/** What one kind's read covered: its events, and whether it reached back 24 hours rather than stopping at the page bound or at `stop`. */
interface Recent {
  events: HistoryPage["events"];
  complete: boolean;
}

/** The newest `kind` events no older than 24 hours before `nowMs`, as far as the page bound reaches and until `stop` says the read is no longer wanted. */
async function recent(read: ReadHistory, kind: "session_key_registered" | "session_key_revoked", nowMs: number, stop: () => boolean): Promise<Recent> {
  const events: HistoryPage["events"] = [];
  let before: string | undefined;
  for (let page = 0; page < MAX_PAGES && !stop(); page++) {
    const answer = await read({ limit: PAGE_LIMIT, kind, ...(before === undefined ? {} : { before }) });
    for (const event of answer.events) if (event.type === kind) events.push(event);
    const oldest = answer.events.at(-1);
    if (answer.next === null || oldest === undefined || oldest.ts < nowMs - KEY_LIFETIME_MS) return { events, complete: true };
    before = answer.next;
  }
  return { events, complete: false };
}

/** The live keys and whether the read covered every event that could matter; an incomplete read may miss a key, or list one revoked past the bound. */
export interface LiveKeys {
  keys: LiveKey[];
  complete: boolean;
}

/**
 * The keys live at node time `nowMs`, newest start first: a key is live when its latest registration
 * expires ahead of `nowMs` and no revocation of it came after that registration in the log.
 */
export async function readLiveKeys(read: ReadHistory, nowMs: number, stop: () => boolean = () => false): Promise<LiveKeys> {
  const [registered, revoked] = await Promise.all([recent(read, "session_key_registered", nowMs, stop), recent(read, "session_key_revoked", nowMs, stop)]);
  const registrations = registered.events;
  const revocations = revoked.events;
  const latest = new Map<string, { cursor: string; startedAt: number; expiresAt: number }>();
  for (const event of registrations) {
    if (event.type !== "session_key_registered") continue;
    const address = event.session_key.toLowerCase();
    const held = latest.get(address);
    if (held === undefined || compareCursors(event.cursor, held.cursor) > 0) latest.set(address, { cursor: event.cursor, startedAt: event.ts, expiresAt: event.expires_at });
  }
  for (const event of revocations) {
    if (event.type !== "session_key_revoked") continue;
    const held = latest.get(event.session_key.toLowerCase());
    if (held !== undefined && compareCursors(event.cursor, held.cursor) > 0) latest.delete(event.session_key.toLowerCase());
  }
  const keys = [...latest].filter(([, key]) => key.expiresAt > nowMs).map(([address, key]) => ({ address, startedAt: key.startedAt, expiresAt: key.expiresAt })).sort((a, b) => b.startedAt - a.startedAt || a.address.localeCompare(b.address));
  return { keys, complete: registered.complete && revoked.complete };
}

/** How long the key has been active at node time `nowMs`. */
export const activeFor = (nowMs: number, startedAt: number): string => formatSpan(nowMs - startedAt);

/** When the key expires, relative to node time `nowMs`. */
export const expiresIn = (nowMs: number, at: number): string => (at <= nowMs ? "expired" : `in ${formatSpan(at - nowMs)}`);
