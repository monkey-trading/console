/** Tests for the operator table: the roles the registry gives each row, and search, sort and paging at hundreds of rows. */

import { describe, expect, it } from "vitest";

import type { Candidate, CandidateTable, NamedOperator } from "../engine/registry";
import { ariaSort, countText, MAX_SEARCH, operatorRows, PAGE_SIZE, SORTS, tableView, type OperatorRow, type SortId } from "./operator-table";

const RELEASE = `0x${"ab".repeat(32)}`;

/** A candidate numbered `n`: its address and hostname carry the number, so a test can tell rows apart. */
function candidate(n: number, over: Partial<Candidate> = {}): Candidate {
  const hex = n.toString(16).padStart(40, "0");
  return { address: `0x${hex}`, hostname: `op-${n}.example`, votes: BigInt(n) * 10n, eligible: true, bond: BigInt(n) * 3n, release: RELEASE, registration: n, handoverEndpoint: `https://op-${n}.example/handover`, ...over };
}

function table(candidates: Candidate[], inEffect = candidates[0]?.address ?? "0x00000000000000000000000000000000000000aa"): CandidateTable {
  const listed = candidates.find((c) => c.address === inEffect);
  return {
    inEffect: { candidate: inEffect, hostname: listed?.hostname ?? null, release: RELEASE, registered: listed === undefined ? null : { bond: listed.bond, release: RELEASE, registration: listed.registration, handoverEndpoint: listed.handoverEndpoint } },
    candidates,
    totalStaked: 1_000n,
  };
}

function named(over: Partial<NamedOperator> = {}): NamedOperator {
  return { rotationEnabled: true, candidate: candidate(1).address, adminKey: candidate(1).address, sinceMs: 0, hostname: null, pending: null, ...over };
}

const roles = (rows: OperatorRow[]) => Object.fromEntries(rows.map((row) => [row.hostname, row.role]));

describe("operatorRows", () => {
  it("names the operator in effect active, the top eligible other candidate standby, and the rest candidates", () => {
    const rows = operatorRows(table([candidate(1), candidate(2), candidate(3), candidate(4, { eligible: false })]), named());
    // Candidate 4 has the most votes but is not eligible; 3 has the most of the eligible others.
    expect(roles(rows)).toEqual({ "op-1.example": "active", "op-2.example": "candidate", "op-3.example": "standby", "op-4.example": "candidate" });
  });

  it("breaks a tie in votes for the standby by the earlier registration, as the registry does", () => {
    const rows = operatorRows(table([candidate(1), candidate(2, { votes: 50n, registration: 9 }), candidate(3, { votes: 50n, registration: 4 })]), named());
    expect(roles(rows)).toMatchObject({ "op-2.example": "candidate", "op-3.example": "standby" });
  });

  it("names no standby while rotation is off, while an election waits, or with no registry read", () => {
    const candidates = [candidate(1), candidate(2), candidate(3)];
    expect(operatorRows(table(candidates), named({ rotationEnabled: false })).map((r) => r.role)).toEqual(["active", "candidate", "candidate"]);
    expect(operatorRows(table(candidates), null).map((r) => r.role)).toEqual(["active", "candidate", "candidate"]);
    const pending = { epoch: 3, candidate: candidate(2).address, adminKey: candidate(2).address, effectiveAtMs: 5, promoted: false };
    expect(operatorRows(table(candidates), named({ pending })).map((r) => r.role)).toEqual(["active", "elected", "candidate"]);
    expect(operatorRows(table(candidates), named({ pending: { ...pending, promoted: true } })).map((r) => r.role)).toEqual(["active", "promoted", "candidate"]);
  });

  it("adds an operator in effect the registry does not list, with no votes and no Delegate, and its registration where it has one", () => {
    const deployer = "0x00000000000000000000000000000000000000aa";
    const rows = operatorRows(table([candidate(2)], deployer), named());
    expect(rows.at(-1)).toEqual({ address: deployer, hostname: null, role: "active", listed: false, eligible: false, votes: null, shareBps: 0, bond: null, release: RELEASE, endpoint: null });
    expect(rows[0]).toMatchObject({ role: "standby", listed: true, votes: 20n, shareBps: 200, bond: 6n, endpoint: "https://op-2.example/handover" });
    // An operator in effect whose release approval the timelock withdrew: delisted, still registered.
    const delisted = table([candidate(2)], deployer);
    const registered = { ...delisted, inEffect: { candidate: deployer, hostname: "kept.example", release: RELEASE, registered: { bond: 77n, release: RELEASE, registration: 0, handoverEndpoint: "https://kept.example/handover" } } };
    expect(operatorRows(registered, named()).at(-1)).toEqual({ address: deployer, hostname: "kept.example", role: "active", listed: false, eligible: false, votes: null, shareBps: 0, bond: 77n, release: RELEASE, endpoint: "https://kept.example/handover" });
  });

  it("shows no hostname the build could not connect to, so a lookalike never reads as a host", () => {
    const rows = operatorRows(table([candidate(1, { hostname: "раураl.example" }), candidate(2, { hostname: "OP-2.Example" })]), named());
    expect(rows.map((row) => row.hostname)).toEqual([null, "op-2.example"]);
  });
});

/** `count` rows, numbered from 1, the first active. */
function many(count: number): OperatorRow[] {
  return operatorRows(table(Array.from({ length: count }, (_, i) => candidate(i + 1))), named({ rotationEnabled: false }));
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
  const deployer = "0x00000000000000000000000000000000000000aa";
  const pending = { epoch: 1, candidate: candidate(2).address, adminKey: candidate(2).address, effectiveAtMs: 1, promoted: false };
  const rows = operatorRows(table([candidate(2), candidate(3, { hostname: "" }), candidate(4), candidate(5, { votes: 40n })], deployer), named({ pending }));
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
