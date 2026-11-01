/** The pages the top bar links to, in the order it shows them. */
export const PAGES = [
  { href: "/", label: "Trade" },
  { href: "/house", label: "House" },
  { href: "/funding", label: "Funding" },
] as const;

/** Whether `pathname` is the page `href` names; a trailing slash on the path does not change the page. */
export function isCurrentPage(pathname: string | null, href: string): boolean {
  if (pathname === null) return false;
  return (pathname.replace(/\/+$/, "") || "/") === href;
}
