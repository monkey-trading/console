/** The operator table's rotation set columns (monkey-trading/console#280): each row's place in the set in effect. */

import type { OperatorRow, RowMembership } from "./operator-table";
import type { RotationSet } from "./rotation";

/** What the table's membership cell says: "Member", "Outside the set", or a dash while no set is known. */
export function membershipWord(membership: RowMembership | null): string {
  return membership === null ? "—" : membership.inSet ? "Member" : "Outside the set";
}

/** `rows` with each one's place in `set`; with no set, every row's membership is unknown. */
export function withMembership(rows: readonly OperatorRow[], set: RotationSet | null): readonly OperatorRow[] {
  if (set === null) return rows.map((row) => ({ ...row, membership: null }));
  const members = new Map(set.members.map((member) => [member.address, member]));
  return rows.map((row) => {
    const member = members.get(row.address);
    return { ...row, membership: member === undefined ? { inSet: false, weight: 0n, turnShareBps: 0 } : { inSet: true, weight: member.weight, turnShareBps: member.turnShareBps } };
  });
}
