/** Tests for the operator table: the roles the registry gives each row of the node's signed list, and search, sort and paging at hundreds of rows. */

import { describe, expect, it } from "vitest";

import type { ListedCandidate, OperatorList } from "../engine/staking-reads";
import { ariaSort, countText, MAX_SEARCH, operatorsView, PAGE_SIZE, SORTS, tableView, type OperatorRow, type SortId } from "./operator-table";

const RELEASE = `0x${"ab".repeat(32)}`;
const DEPLOYER = "0x00000000000000000000000000000000000000aa";

/** A candidate numbered `n`, as `GET /v1/operators` lists it: its address and hostname carry the number, so a test can tell rows apart. */
function candidate(n: number, over: Partial<ListedCandidate> = {}): ListedCandidate {
  const address = `0x${n.toString(16).padStart(40, "0")}`;
  return {
    address, admin_key: address, enclave: address, self_bond: String(n * 3), release: RELEASE, registration: n, api_hostname: `op-${n}.example`,
    handover_endpoint: `https://op-${n}.example/handover`, votes: String(n * 10), eligible: true, role: "candidate", ...over,
  };
}

/** The list the node answers, with `inEffect` the operator in effect: the first candidate's by default. */
function list(candidates: ListedCandidate[], inEffect = candidates[0]?.address ?? DEPLOYER, over: Partial<OperatorList> = {}): OperatorList {
  const operator = { candidate: inEffect, admin_key: inEffect, release: RELEASE, since_ms: 0 };
  return {
    block: { number: 1_234_567, hash: `0x${"cd".repeat(32)}`, time_ms: 1_793_000_000_000 }, registry: DEPLOYER, lens: DEPLOYER, rotation_enabled: true,
    parameters: { epoch_length_secs: 60, min_term_secs: 0, finality_margin_secs: 60, margin_bps: 1_000, eligibility_bps: 500, quorum_bps: 2_000, max_candidates: 100, min_self_bond: "1", liveness_timeout_secs: 604_800 },
    open_epoch: 3, open_epoch_start_ms: 0, total_staked: "1000", operator_in_effect: operator, named_operator: operator, pending_election: null, pending_promotion: false, candidates, ...over,
  };
}

const roles = (rows: readonly OperatorRow[]) => Object.fromEntries(rows.map((row) => [row.hostname, row.role]));
const election = (n: number, promoted = false) => ({ epoch: 3, candidate: candidate(n).address, admin_key: candidate(n).address, release: RELEASE, effective_at_ms: 5, promoted });

describe("operatorsView", () => {
  it("names the operator in effect active, the top eligible other candidate standby, and the rest candidates", () => {
    const { rows } = operatorsView(list([candidate(1), candidate(2), candidate(3), candidate(4, { eligible: false })]));
    // Candidate 4 has the most votes but is not eligible; 3 has the most of the eligible others.
    expect(roles(rows)).toEqual({ "op-1.example": "active", "op-2.example": "candidate", "op-3.example": "standby", "op-4.example": "candidate" });
  });

  it("breaks a tie in votes for the standby by the earlier registration, as the registry does", () => {
    const { rows } = operatorsView(list([candidate(1), candidate(2, { votes: "50", registration: 9 }), candidate(3, { votes: "50", registration: 4 })]));
    expect(roles(rows)).toMatchObject({ "op-2.example": "candidate", "op-3.example": "standby" });
  });

  it("names no standby while rotation is off or while an election or a promotion waits, and names the one waiting", () => {
    const candidates = [candidate(1), candidate(2), candidate(3)];
    const rolesOf = (over: Partial<OperatorList>) => operatorsView(list(candidates, undefined, over)).rows.map((row) => row.role);
    expect(rolesOf({ rotation_enabled: false })).toEqual(["active", "candidate", "candidate"]);
    expect(rolesOf({ pending_promotion: true })).toEqual(["active", "candidate", "candidate"]);
    expect(rolesOf({ pending_election: election(2) })).toEqual(["active", "elected", "candidate"]);
    expect(rolesOf({ pending_election: election(2, true) })).toEqual(["active", "promoted", "candidate"]);
    expect(operatorsView(list(candidates, undefined, { pending_election: election(2, true) })).pending).toEqual({ candidate: candidate(2).address, effectiveAtMs: 5, promoted: true });
  });

  it("adds an operator in effect the registry does not list, with no votes, no registration and no Delegate", () => {
    const { rows, inEffect } = operatorsView(list([candidate(2)], DEPLOYER.toUpperCase().replace("0X", "0x")));
    expect(inEffect).toBe(DEPLOYER);
    expect(rows.at(-1)).toEqual({ address: DEPLOYER, hostname: null, registeredHostname: "", role: "active", listed: false, eligible: false, votes: null, shareBps: 0, bond: null, release: RELEASE, endpoint: null, registration: null });
    expect(rows[0]).toMatchObject({ role: "standby", listed: true, votes: 20n, shareBps: 200, bond: 6n, endpoint: "https://op-2.example/handover", registration: 2 });
  });

  it("shows no hostname the build could not connect to, so a lookalike never reads as a host, and keeps the registered one for the build's check", () => {
    const { rows } = operatorsView(list([candidate(1, { api_hostname: "раураl.example" }), candidate(2, { api_hostname: "OP-2.Example" })]));
    expect(rows.map((row) => [row.hostname, row.registeredHostname])).toEqual([[null, "раураl.example"], ["op-2.example", "OP-2.Example"]]);
  });

  it("names the final block the list reflects, the total stake, and the rotation switch", () => {
    expect(operatorsView(list([candidate(1)], undefined, { rotation_enabled: false }))).toMatchObject({ block: { number: 1_234_567, hash: `0x${"cd".repeat(32)}`, timeMs: 1_793_000_000_000 }, totalStaked: 1_000n, rotationEnabled: false });
  });

  it("refuses a malformed amount or address, or more candidates than the registry holds", () => {
    expect(() => operatorsView(list([candidate(1, { votes: "1e3" })]))).toThrow("not a whole amount");
    expect(() => operatorsView(list([candidate(1, { self_bond: "-1" })]))).toThrow("not a whole amount");
    expect(() => operatorsView(list([candidate(1)], undefined, { total_staked: "" }))).toThrow("not a whole amount");
    expect(() => operatorsView(list([candidate(1, { address: "0x12" })]))).toThrow("address that is not one");
    expect(() => operatorsView(list(Array.from({ length: 101 }, (_, i) => candidate(i + 1))))).toThrow("more candidates than the registry can hold");
  });

  it("sorts, searches and pages a full list of 100 candidates in four pages", () => {
    const { rows } = operatorsView(list(Array.from({ length: 100 }, (_, i) => candidate(i + 1)), undefined, { rotation_enabled: false, total_staked: "100000" }));
    expect(rows).toHaveLength(100);
    const pages = [0, 1, 2, 3].map((page) => tableView(rows, "", "votes-desc", page));
    expect(pages.map((view) => view.rows.length)).toEqual([25, 25, 25, 25]);
    expect(pages[0]?.rows[0]).toMatchObject({ hostname: "op-100.example", votes: 1_000n, shareBps: 100 });
    expect(pages[3]?.rows.at(-1)?.hostname).toBe("op-1.example");
    expect(countText(pages[1] ?? tableView([], "", "role", 0), "")).toBe("Showing 26–50 of 100 operators.");
    expect(tableView(rows, "op-7", "name-asc", 0).rows.map((row) => row.hostname)).toEqual(["op-7.example", "op-70.example", "op-71.example", "op-72.example", "op-73.example", "op-74.example", "op-75.example", "op-76.example", "op-77.example", "op-78.example", "op-79.example"]);
    expect(tableView(rows, "", "role", 0).rows[0]).toMatchObject({ hostname: "op-1.example", role: "active" });
  });
});

/** `count` rows numbered from 1, the first active, as the table sees them: more than a list holds, to show the table holds at hundreds. */
function many(count: number): OperatorRow[] {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    return { address: candidate(n).address, hostname: `op-${n}.example`, registeredHostname: `op-${n}.example`, role: n === 1 ? "active" : "candidate", listed: true, eligible: true, votes: BigInt(n) * 10n, shareBps: 0, bond: BigInt(n) * 3n, release: RELEASE, endpoint: `https://op-${n}.example/handover`, registration: n };
  });
}

describe("tableView paging", () => {
  it("pages 500 rows in pages of the page size, the last one partial, and keeps a page asked past the end on the last", () => {
    const rows = many(510);
    const first = tableView(rows, "", "votes-asc", 0);
    expect({ ...first, rows: first.rows.length }).toEqual({ rows: PAGE_SIZE, matched: 510, total: 510, page: 0, pages: 21 });
    expect(first.rows.map((row) => row.hostname)).toEqual(Array.from({ length: PAGE_SIZE }, (_, i) => `op-${i + 1}.example`));
    const last = tableView(rows, "", "votes-asc", 20);
    expect(last.rows.map((row) => row.hostname)).toEqual(Array.from({ length: 10 }, (_, i) => `op-${501 + i}.example`));
    expect(tableView(rows, "", "votes-asc", 99)).toMatchObject({ page: 20, rows: last.rows });
    expect(tableView(rows, "", "votes-asc", -3).page).toBe(0);
  });

  it("shows one empty page for no rows", () => {
    expect(tableView([], "", "role", 4)).toEqual({ rows: [], matched: 0, total: 0, page: 0, pages: 1 });
  });
});

describe("tableView search", () => {
  const rows = many(300);

  it("keeps rows whose hostname, address, release or endpoint holds the text, ignoring case and outer spaces", () => {
    expect(tableView(rows, "  OP-27.", "votes-asc", 0).rows.map((row) => row.hostname)).toEqual(["op-27.example"]);
    expect(tableView(rows, candidate(255).address.toUpperCase().replace("0X", "0x"), "votes-asc", 0).rows.map((row) => row.hostname)).toEqual(["op-255.example"]);
    expect(tableView(rows, "op-12.example/hand", "votes-asc", 0).matched).toBe(1);
    expect(tableView(rows, RELEASE.slice(0, 20), "votes-asc", 0).matched).toBe(300);
  });

  it("pages what the search kept, counting the kept rows against all of them", () => {
    // op-1 and op-10 to op-19, op-100 to op-199: 111 rows.
    const view = tableView(rows, "op-1", "votes-asc", 4);
    expect({ matched: view.matched, total: view.total, pages: view.pages, page: view.page, shown: view.rows.length }).toEqual({ matched: 111, total: 300, pages: 5, page: 4, shown: 11 });
  });

  it("finds nothing for text no row holds, and reads no further than the longest search it takes", () => {
    expect(tableView(rows, "no such operator", "role", 0)).toMatchObject({ matched: 0, rows: [], pages: 1 });
    expect(tableView(rows, `op-27.example${"x".repeat(MAX_SEARCH)}`, "role", 0).matched).toBe(0);
    expect(tableView(rows, `${"op-27.example".padEnd(MAX_SEARCH, " ")}trailing`, "role", 0).matched).toBe(1);
  });
});

describe("tableView sorting", () => {
  const { rows } = operatorsView(list([candidate(2), candidate(3, { api_hostname: "" }), candidate(4), candidate(5, { votes: "40" })], DEPLOYER, { pending_election: election(2) }));
  const order = (sort: SortId) => tableView(rows, "", sort, 0).rows.map((row) => row.address.slice(-2));

  it("orders by role, then by delegated stake, ties by address", () => {
    // The unlisted deployer is active, op-2 elected; then candidates by votes: op-5 and op-4 both 40, op-3 30.
    expect(order("role")).toEqual(["aa", "02", "04", "05", "03"]);
  });

  it("orders by delegated stake and self-bond both ways, with an operator whose figure was not read last either way", () => {
    expect(order("votes-desc")).toEqual(["04", "05", "03", "02", "aa"]);
    expect(order("votes-asc")).toEqual(["02", "03", "04", "05", "aa"]);
    expect(order("bond-desc")).toEqual(["05", "04", "03", "02", "aa"]);
    expect(order("bond-asc")).toEqual(["02", "03", "04", "05", "aa"]);
  });

  it("orders by hostname both ways, with a row that shows none last either way", () => {
    expect(order("name-asc")).toEqual(["02", "04", "05", "03", "aa"]);
    expect(order("name-desc")).toEqual(["05", "04", "02", "03", "aa"]);
  });

  it("offers every sort it knows, each once", () => {
    const ids: SortId[] = ["role", "votes-desc", "votes-asc", "bond-desc", "bond-asc", "name-asc", "name-desc"];
    expect(SORTS.map((sort) => sort.value)).toEqual(ids);
    for (const id of ids) expect(tableView(rows, "", id, 0).rows).toHaveLength(rows.length);
  });
});

describe("countText", () => {
  const rows = many(60);

  it("says which rows a page shows of all of them, and of those a search kept", () => {
    expect(countText(tableView(rows, "", "role", 0), "")).toBe("Showing 1–25 of 60 operators.");
    expect(countText(tableView(rows, "", "role", 2), "")).toBe("Showing 51–60 of 60 operators.");
    expect(countText(tableView(rows, "op-1", "role", 0), "op-1")).toBe("11 of 60 operators match; showing 1–11.");
    expect(countText(tableView(rows, "op-27.", "role", 0), "op-27.")).toBe("1 of 60 operators matches; showing 1.");
    expect(countText(tableView(rows, "nothing", "role", 0), "nothing")).toBe("No operator matches.");
    expect(countText(tableView(rows.slice(0, 1), "", "role", 0), "  ")).toBe("Showing 1 of 1 operator.");
    expect(countText(tableView([], "", "role", 0), "")).toBe("No operators.");
  });
});

describe("ariaSort", () => {
  it("marks only the column a sort orders by, with its direction, and the role order as neither", () => {
    expect(ariaSort("votes", "votes-desc")).toBe("descending");
    expect(ariaSort("bond", "bond-asc")).toBe("ascending");
    expect(ariaSort("name", "name-desc")).toBe("descending");
    expect(ariaSort("role", "role")).toBe("other");
    expect(ariaSort("role", "votes-desc")).toBeUndefined();
    expect(ariaSort("votes", "role")).toBeUndefined();
  });
});
