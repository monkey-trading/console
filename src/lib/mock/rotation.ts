/**
 * The simulated daily rotation as `GET /v1/operator` carries it (monkey-trading/console#280): a
 * rotation set of the four leading candidates weighted by their votes, today's turn held by the
 * operator in effect, tomorrow's drawn from the set, a next set on its way, and a history of the
 * last days' turns with one skip, one promotion and one refused assignment. The turn changes at
 * 22:30 UTC as the engine's does; the draw is seeded, so the same day gives the same member.
 */

import type { OperatorRoute, TurnRecordView, TurnView } from "../engine/stats-types";
import { mulberry32, SEED } from "../prng";
import type { MockState } from "./state";

const DAY_MS = 86_400_000;
/** A turn's boundary is 22:30 UTC. */
const BOUNDARY_MS = 22.5 * 3_600_000;
/** How many earlier turns the history holds. */
const HISTORY_DAYS = 12;
/** The history's seq origin: records are mirrored in order, ten commands apart. */
const SEQ_ORIGIN = 1_000;

/** The turn number whose boundary is the latest at or before `ms`. */
const turnAt = (ms: number): number => Math.floor((ms - BOUNDARY_MS) / DAY_MS);
/** When turn `turn` begins. */
const boundaryOf = (turn: number): number => turn * DAY_MS + BOUNDARY_MS;

interface Member {
  candidate: string;
  admin_key: string;
  weight: string;
}

/** The member the seeded draw names for `turn`, as the weights make it likely. */
function drawn(members: readonly Member[], turn: number): Member {
  const total = members.reduce((sum, member) => sum + BigInt(member.weight), 0n);
  // A point over the whole of the weights, whatever their scale: 52 random bits spread across the total.
  const point = (BigInt(Math.floor(mulberry32(SEED + turn)() * 2 ** 52)) * total) >> 52n;
  let acc = 0n;
  for (const member of members) {
    acc += BigInt(member.weight);
    if (point < acc) return member;
  }
  const last = members.at(-1);
  if (last === undefined) throw new Error("The mock rotation set has no members.");
  return last;
}

/** The rotation's part of the route at `state.now`. */
export function mockRotation(state: MockState, params: { before?: number; limit?: number } = {}): Pick<OperatorRoute, "rotation_set" | "next_rotation_set" | "turn" | "next_turn" | "turns"> {
  const now = state.now;
  const today = turnAt(now);
  const leaders = state.operators.candidates.slice(0, 4);
  const members: Member[] = leaders.map((leader) => ({ candidate: leader.address, admin_key: leader.adminKey, weight: leader.votes.toString() }));
  const holder = state.operators.named(now);
  const holderMember = members.find((member) => member.candidate === holder.candidate) ?? members[0];
  if (holderMember === undefined) throw new Error("The mock rotation set has no members.");
  const view = (turn: number, member: Member, taken: boolean): TurnView => ({
    turn, position: 0, reason: "draw", set: 3, candidate: member.candidate, admin_key: member.admin_key, applies_at: boundaryOf(turn), taken,
  });
  const records: TurnRecordView[] = [];
  let seq = SEQ_ORIGIN;
  const push = (record: Omit<TurnRecordView, "assigned_seq">) => {
    records.push({ ...record, assigned_seq: seq });
    seq += 10;
  };
  for (let turn = today - HISTORY_DAYS; turn <= today + 1; turn += 1) {
    const member = turn === today ? holderMember : drawn(members, turn);
    const at = boundaryOf(turn);
    const base: Omit<TurnRecordView, "assigned_seq"> = { turn, position: 0, reason: "draw", candidate: member.candidate, admin_key: member.admin_key, assigned_ms: at - 36 * 3_600_000, applies_at: at, refused: null, taken_seq: null, taken_ms: null, release: null };
    const taken = turn <= today;
    const stamp = (record: Omit<TurnRecordView, "assigned_seq">): Omit<TurnRecordView, "assigned_seq"> => (taken ? { ...record, taken_seq: seq + 5, taken_ms: at + 4_000, release: `0x${"ab".repeat(32)}` } : record);
    if (turn === today - 9) {
      // The liveness rule moved this turn from a failed member to the next in its order.
      const failed = drawn(members, turn);
      push({ ...base, candidate: failed.candidate, admin_key: failed.admin_key });
      const next = members.find((candidate) => candidate.candidate !== failed.candidate) ?? failed;
      push(stamp({ ...base, position: 1, reason: "promotion", candidate: next.candidate, admin_key: next.admin_key, assigned_ms: at + 3_600_000 }));
    } else if (turn === today - 5) {
      push(stamp({ ...base, position: 0, assigned_ms: at - 36 * 3_600_000 }));
      push({ ...base, position: 1, reason: "skip", refused: "no set mirrored seven days earlier names its key", applies_at: null, assigned_ms: at + 600_000 });
    } else if (turn === today - 3) {
      const first = drawn(members, turn);
      const second = members.find((candidate) => candidate.candidate !== first.candidate) ?? first;
      push({ ...base, candidate: first.candidate, admin_key: first.admin_key });
      push(stamp({ ...base, position: 1, reason: "skip", candidate: second.candidate, admin_key: second.admin_key, assigned_ms: at + 1_800_000 }));
    } else push(stamp(base));
  }
  const newestFirst = [...records].reverse();
  const older = params.before === undefined ? newestFirst : newestFirst.filter((record) => record.assigned_seq < (params.before ?? 0));
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
  const page = older.slice(0, limit);
  const next = older.length > limit ? (page.at(-1)?.assigned_seq ?? null) : null;
  const set = (id: number, epoch: number, effectiveAt: number, list: readonly Member[]) => ({ set: id, epoch, effective_at: effectiveAt, logged_at: effectiveAt - 7 * DAY_MS, members: [...list] });
  return {
    rotation_set: set(3, 41, now - 8 * DAY_MS, members),
    next_rotation_set: set(4, 42, now + 3 * DAY_MS, members.slice(0, 3).map((member, index) => ({ ...member, weight: (BigInt(member.weight) + BigInt(index) * 10_000n).toString() }))),
    turn: view(today, holderMember, true),
    next_turn: view(today + 1, drawn(members, today + 1), false),
    turns: { records: page, next, truncated: false, retained_from_seq: SEQ_ORIGIN },
  };
}
