/**
 * The Staking page's operator table (monkey-trading/console#271): one row per operator the registry
 * lists, with the role the registry gives it, and the search, sort and paging the table offers, done
 * in memory over the whole list so they hold at hundreds of rows. Roles follow `OperatorRegistry.sol`:
 * the operator in effect (`operatorInEffect`), the candidate a pending election or promotion names
 * (`pendingElection`), and the standby the liveness rule promotes (`_standby`).
 */

import type { CandidateTable, NamedOperator } from "../engine/registry";
import { shareBps } from "../monkey/figures";
import { shownHostname } from "../monkey/operators";

/** `elected` and `promoted` wait on `pendingElection`; `standby` is the one `promote()` would pick now. */
export type OperatorRole = "active" | "elected" | "promoted" | "standby" | "candidate";

export interface OperatorRow {
  address: string;
  /** The registered hostname as the page may show it; null for text the build could not connect to. */
  hostname: string | null;
  role: OperatorRole;
  /** Whether the registry lists it, so stake can be delegated to it; an operator in effect may never have registered. */
  listed: boolean;
  eligible: boolean;
  /** MONKEY base units delegated to it; null where the registry lists it not, so its votes were not read. */
  votes: bigint | null;
  /** `votes` as a share of all stake, in basis points. */
  shareBps: number;
  /** Its self-bond in MONKEY base units, the release it runs and its handover endpoint; null where it never registered. */
  bond: bigint | null;
  release: string;
  endpoint: string | null;
}

export type SortId = "role" | "votes-desc" | "votes-asc" | "bond-desc" | "bond-asc" | "name-asc" | "name-desc";
/** The column a sort orders by, and which way; the role order is the registry's, neither way. */
export type SortColumn = "role" | "votes" | "bond" | "name";

export const SORTS: readonly { value: SortId; label: string; column: SortColumn; direction: "ascending" | "descending" | "other" }[] = [
  { value: "role", label: "Role, then delegated stake", column: "role", direction: "other" },
  { value: "votes-desc", label: "Delegated stake, most first", column: "votes", direction: "descending" },
  { value: "votes-asc", label: "Delegated stake, least first", column: "votes", direction: "ascending" },
  { value: "bond-desc", label: "Self-bond, most first", column: "bond", direction: "descending" },
  { value: "bond-asc", label: "Self-bond, least first", column: "bond", direction: "ascending" },
  { value: "name-asc", label: "Hostname, A to Z", column: "name", direction: "ascending" },
  { value: "name-desc", label: "Hostname, Z to A", column: "name", direction: "descending" },
];

/** What `aria-sort` says of `column` under `sort`: nothing for a column the sort does not order by. */
export function ariaSort(column: SortColumn, sort: SortId): "ascending" | "descending" | "other" | undefined {
  const chosen = SORTS.find((option) => option.value === sort);
  return chosen?.column === column ? chosen.direction : undefined;
}

/** Rows a page of the table shows. */
export const PAGE_SIZE = 25;
/** The longest search the table takes: longer than any address, hostname or endpoint a visitor would type. */
export const MAX_SEARCH = 100;

const ROLE_ORDER: Record<OperatorRole, number> = { active: 0, promoted: 1, elected: 2, standby: 3, candidate: 4 };

/**
 * The candidate `promote()` would pick now, as `OperatorRegistry._standby` does: the eligible
 * candidate with the most votes other than the operator in effect, the earlier registration on a
 * tie. Only while rotation is on and no election waits, the only time `promote()` may run.
 */
function standbyOf(table: CandidateTable, named: NamedOperator | null): string | null {
  if (named === null || !named.rotationEnabled || named.pending !== null) return null;
  let best: CandidateTable["candidates"][number] | null = null;
  for (const candidate of table.candidates) {
    if (candidate.address === table.inEffect.candidate || !candidate.eligible) continue;
    if (best === null || candidate.votes > best.votes || (candidate.votes === best.votes && candidate.registration < best.registration)) best = candidate;
  }
  return best?.address ?? null;
}

/** Every operator the table shows: the registry's candidates, and the operator in effect where the registry does not list it. */
export function operatorRows(table: CandidateTable, named: NamedOperator | null): OperatorRow[] {
  const pending = named?.pending ?? null;
  const standby = standbyOf(table, named);
  const roleOf = (address: string): OperatorRole => {
    if (address === table.inEffect.candidate) return "active";
    if (pending !== null && address === pending.candidate) return pending.promoted ? "promoted" : "elected";
    return address === standby ? "standby" : "candidate";
  };
  const rows: OperatorRow[] = table.candidates.map((candidate) => ({
    address: candidate.address, hostname: shownHostname(candidate.hostname), role: roleOf(candidate.address), listed: true, eligible: candidate.eligible,
    votes: candidate.votes, shareBps: shareBps(candidate.votes, table.totalStaked), bond: candidate.bond, release: candidate.release, endpoint: candidate.handoverEndpoint,
  }));
  const { inEffect } = table;
  if (!rows.some((row) => row.address === inEffect.candidate)) {
    rows.push({
      address: inEffect.candidate, hostname: shownHostname(inEffect.hostname), role: "active", listed: false, eligible: false, votes: null, shareBps: 0,
      bond: inEffect.registered?.bond ?? null, release: inEffect.release, endpoint: inEffect.registered?.handoverEndpoint ?? null,
    });
  }
  return rows;
}

/** Whether `row` holds `query` (lowercase, trimmed) in its hostname, address, release or endpoint. */
function matches(row: OperatorRow, query: string): boolean {
  return [row.hostname, row.address, row.release, row.endpoint].some((field) => field !== null && field.toLowerCase().includes(query));
}

/** Orders two bigints that may be absent, an absent one after every value. */
function byAmount(a: bigint | null, b: bigint | null, descending: boolean): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a > b ? 1 : -1) * (descending ? -1 : 1);
}

/** Orders two hostnames, a row with none after every named one. */
function byName(a: string | null, b: string | null, descending: boolean): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a < b ? -1 : 1) * (descending ? -1 : 1);
}

/** The comparison for `sort`; every one ends on the address, so the order is total and stable across reads. */
function comparator(sort: SortId): (a: OperatorRow, b: OperatorRow) => number {
  const tie = (a: OperatorRow, b: OperatorRow) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0);
  const first = (a: OperatorRow, b: OperatorRow): number => {
    switch (sort) {
      case "role": return ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || byAmount(a.votes, b.votes, true);
      case "votes-desc": return byAmount(a.votes, b.votes, true);
      case "votes-asc": return byAmount(a.votes, b.votes, false);
      case "bond-desc": return byAmount(a.bond, b.bond, true);
      case "bond-asc": return byAmount(a.bond, b.bond, false);
      case "name-asc": return byName(a.hostname, b.hostname, false);
      case "name-desc": return byName(a.hostname, b.hostname, true);
      default: {
        const never: never = sort;
        throw new Error(`Unknown sort ${String(never)}.`);
      }
    }
  };
  return (a, b) => first(a, b) || tie(a, b);
}

export interface TableView {
  /** The rows on the page shown. */
  rows: readonly OperatorRow[];
  /** Rows the search kept, and rows in all. */
  matched: number;
  total: number;
  /** The page shown, from 0, kept within the pages there are; and how many there are, at least one. */
  page: number;
  pages: number;
}

/** One page of `rows`, searched and sorted; a page past the last shows the last. */
export function tableView(rows: readonly OperatorRow[], search: string, sort: SortId, page: number): TableView {
  const query = search.slice(0, MAX_SEARCH).trim().toLowerCase();
  const kept = (query === "" ? [...rows] : rows.filter((row) => matches(row, query))).sort(comparator(sort));
  const pages = Math.max(1, Math.ceil(kept.length / PAGE_SIZE));
  const shown = Math.min(Math.max(0, Math.trunc(page)), pages - 1);
  return { rows: kept.slice(shown * PAGE_SIZE, (shown + 1) * PAGE_SIZE), matched: kept.length, total: rows.length, page: shown, pages };
}

/** Which rows a page shows, in words, for the table's status line; `search` as typed. */
export function countText(view: TableView, search: string): string {
  const noun = view.total === 1 ? "operator" : "operators";
  const first = view.page * PAGE_SIZE + 1;
  const last = first + view.rows.length - 1;
  const range = first === last ? `${first}` : `${first}–${last}`;
  if (search.slice(0, MAX_SEARCH).trim() === "") return view.total === 0 ? "No operators." : `Showing ${range} of ${view.total} ${noun}.`;
  if (view.matched === 0) return "No operator matches.";
  return `${view.matched} of ${view.total} ${noun} ${view.matched === 1 ? "matches" : "match"}; showing ${range}.`;
}
