/** What the Dashboard page decides beyond its charts (monkey-trading/console#310): the section a URL hash names, and the line the House section is held with until the node's first signed answers land and while they have gone stale, as the House page does. */

import type { Read } from "./monkey/figures";

/** The ids of the Dashboard's three sections; its in-page links target them, and a #hash load scrolls to one once the page is trusted. */
export const SECTION_IDS = ["house", "monkey", "staking"] as const;
export type DashboardSectionId = (typeof SECTION_IDS)[number];

/** The section `hash` names, or null when it names none of them. */
export function sectionOfHash(hash: string): DashboardSectionId | null {
  const id = hash.startsWith("#") ? hash.slice(1) : hash;
  for (const section of SECTION_IDS) if (section === id) return section;
  return null;
}

/** What the page says above its charts while the house read warms up or has stopped refreshing; null when nothing holds it (the not-trusted line covers that wait). */
export function houseGateLine({ trusted, ready, fresh, simulated }: { trusted: boolean; ready: boolean; fresh: boolean; simulated: boolean }): string | null {
  if (!trusted) return null;
  if (!ready) return simulated ? "Reading the simulated node's first answers…" : "Reading the node's first signed answers…";
  if (!fresh) return "The node's answers have stopped refreshing, so the figures on this page may be behind.";
  return null;
}

/** A failed or unavailable MONKEY overview must qualify each chart that uses its floor or schedule. */
export function overviewProblem(read: Read<unknown>, what: string): string | null {
  if (read.status === "unavailable") return `This node does not serve ${what} yet.`;
  if (read.status !== "failed") return null;
  const reason = read.message === null ? "" : ` (${read.message.replace(/\.+$/, "")})`;
  return read.value === null
    ? `The node did not answer for ${what}${reason}, so there is nothing to show yet. The page keeps asking.`
    : `The last read of ${what} failed${reason}, so this may be behind.`;
}
