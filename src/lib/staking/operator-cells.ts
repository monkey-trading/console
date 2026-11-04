/** The words of the operator table's cells, the same in its card and table layouts. */

import { formatMonkey, formatRate, shortHex } from "../format";
import type { OperatorRole, OperatorRow } from "./operator-table";

export const ROLE_LABELS: Record<OperatorRole, string> = { active: "Active", elected: "Elected", promoted: "Promoted", standby: "Standby", candidate: "Candidate" };

export interface OperatorCells {
  name: string;
  /** The candidate's address, shortened; the cell's title carries it whole. */
  address: string;
  role: string;
  eligibility: string;
  delegated: string;
  bond: string;
  release: string;
  endpoint: string;
}

/**
 * What each cell of `row` says. An operator in effect with no candidacy is the deployment's initial
 * one: an elected operator is a registered candidate, and the registry lets no operator in effect leave.
 */
export function operatorCells(row: OperatorRow): OperatorCells {
  return {
    name: row.hostname ?? (row.bond === null ? "The deployment's initial operator" : "Not a plain hostname"),
    address: shortHex(row.address),
    role: ROLE_LABELS[row.role],
    eligibility: !row.listed ? "Not listed" : row.eligible ? "Eligible" : "Not eligible",
    delegated: row.votes === null ? "—" : `${formatMonkey(row.votes)} (${formatRate(row.shareBps)})`,
    bond: row.bond === null ? "—" : formatMonkey(row.bond),
    release: shortHex(row.release),
    endpoint: row.endpoint === null || row.endpoint === "" ? "—" : row.endpoint,
  };
}
