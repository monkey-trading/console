/** The pages the top bar links to, in the order it shows them, each page's section tabs, and which reads the Staking section's tabs start. */

export const PAGES = [
  { href: "/", label: "Trade" },
  { href: "/house", label: "House" },
  { href: "/monkey", label: "MONKEY" },
  { href: "/staking", label: "Staking" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/funding", label: "Funding" },
  { href: "/settings", label: "Settings" },
] as const;

/** One of a page's section tabs: a sub-route and the label the tab bar shows for it. */
export interface SectionTab {
  readonly href: string;
  readonly label: string;
}

/** A page's section tab bar: the label its nav carries and its tabs in the order they show. */
export interface PageSection {
  readonly label: string;
  readonly tabs: readonly SectionTab[];
}

/** The section tabs each page's layout shows, by the page's href. */
export const SECTIONS: Readonly<Record<"/house" | "/monkey" | "/staking", PageSection>> = {
  "/house": {
    label: "House sections",
    tabs: [
      { href: "/house", label: "Overview" },
      { href: "/house/risk", label: "Risk" },
      { href: "/house/withdrawals", label: "Withdrawals" },
    ],
  },
  "/monkey": {
    label: "MONKEY sections",
    tabs: [
      { href: "/monkey", label: "Emissions" },
      { href: "/monkey/activity", label: "Activity" },
    ],
  },
  "/staking": {
    label: "Staking sections",
    tabs: [
      { href: "/staking", label: "Delegate" },
      { href: "/staking/rewards", label: "Rewards" },
      { href: "/staking/epochs", label: "Epochs" },
    ],
  },
};

/** One of the Staking section's reads, keyed by what it reads. */
export type StakingRead = "panel" | "operators" | "delegations" | "epochs" | "history";

/**
 * Which of the Staking section's reads each of its tabs starts (monkey-trading/console#308): the
 * panel's overview and wallet reads on every tab, the operator reads on Delegate and Epochs (Epochs
 * names the operator-share recipients), the delegation reads on Delegate, the epoch reads on Rewards
 * and Epochs, and the history reads on Rewards.
 */
const STAKING_READS: Readonly<Record<string, readonly StakingRead[]>> = {
  "/staking": ["panel", "operators", "delegations"],
  "/staking/rewards": ["panel", "epochs", "history"],
  "/staking/epochs": ["panel", "operators", "epochs"],
};

/**
 * Which of the Staking section's reads its tab `tabHref` starts.
 * Error cases:
 * - `tabHref` is not one of the Staking section's tabs
 */
export function readsFor(tabHref: string): readonly StakingRead[] {
  const reads = STAKING_READS[tabHref];
  if (reads === undefined) throw new Error(`no reads recorded for the section tab ${tabHref}`);
  return reads;
}

/**
 * Whether `pathname` is the page `href` names or one of its section's sub-routes; a trailing slash
 * on the path does not change the page. `/` matches only `/`.
 */
export function isCurrentPage(pathname: string | null, href: string): boolean {
  if (pathname === null) return false;
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === href || (href !== "/" && path.startsWith(`${href}/`));
}

/**
 * The `aria-current` value the top bar's link to `href` carries on `pathname`: `"page"` on the exact
 * match, `"true"` when the path is one of the page's section's sub-routes, nothing elsewhere — a
 * sub-route is not the page the link opens.
 */
export function currentMark(pathname: string | null, href: string): "page" | "true" | undefined {
  if (pathname === null) return undefined;
  if ((pathname.replace(/\/+$/, "") || "/") === href) return "page";
  return isCurrentPage(pathname, href) ? "true" : undefined;
}

/** Whether `pathname` is the section tab `href` names; a trailing slash on the path does not change the tab. */
export function isCurrentTab(pathname: string | null, href: string): boolean {
  if (pathname === null) return false;
  return (pathname.replace(/\/+$/, "") || "/") === href;
}
