/** The pages the top bar links to, in the order it shows them, and each page's section tabs. */

export const PAGES = [
  { href: "/", label: "Trade" },
  { href: "/house", label: "House" },
  { href: "/monkey", label: "MONKEY" },
  { href: "/staking", label: "Staking" },
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
export const SECTIONS: Readonly<Record<"/staking", PageSection>> = {
  "/staking": {
    label: "Staking sections",
    tabs: [
      { href: "/staking", label: "Delegate" },
      { href: "/staking/rewards", label: "Rewards" },
      { href: "/staking/epochs", label: "Epochs" },
    ],
  },
};

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
