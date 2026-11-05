/** The words of the operator table's cells, the same in its card and table layouts. */

import { formatMonkey, formatRate, shortHex } from "../format";
import type { OperatorRole, OperatorRow } from "./operator-table";

export const ROLE_LABELS: Record<OperatorRole, string> = { active: "Active", elected: "Elected", promoted: "Promoted", standby: "Standby", candidate: "Candidate", unlisted: "Unlisted" };

export interface OperatorCells {
  /** What the name cell shows, which may say why there is no hostname to show. */
  name: string;
  /** What a message or a control calls it: the hostname the build can show, else the short address, never the name cell's placeholder. */
  label: string;
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
    // A row no list names (yoursRows' unlisted one) carries no release: it is named by its address,
    // like its label, not by the deployment words an unlisted operator in effect gets.
    name: row.hostname ?? (row.role === "unlisted" ? shortHex(row.address) : row.bond === null ? "The deployment's initial operator" : "Not a plain hostname"),
    label: row.hostname ?? shortHex(row.address),
    address: shortHex(row.address),
    role: ROLE_LABELS[row.role],
    eligibility: row.role === "unlisted" ? "—" : !row.listed ? "Not listed" : row.eligible ? "Eligible" : "Not eligible",
    delegated: row.votes === null ? "—" : `${formatMonkey(row.votes)} (${formatRate(row.shareBps)})`,
    bond: row.bond === null ? "—" : formatMonkey(row.bond),
    release: row.release === "" ? "—" : shortHex(row.release),
    endpoint: row.endpoint === null || row.endpoint === "" ? "—" : row.endpoint,
  };
}

/** A candidate as a transaction or a payment names it: its label, with its short address beside a hostname, since two candidates may register one hostname. */
export function withAddress(label: string, address: string): string {
  const short = shortHex(address);
  return label === short ? short : `${label} (${short})`;
}
