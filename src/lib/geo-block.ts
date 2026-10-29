/**
 * The edge geo-block: the countries it covers and the rewrite rules built from them. The list below
 * is the one place to change it; every change is a reviewed pull request.
 */

/** A rewrite in the shape `next.config.ts` returns from `rewrites()`. */
export interface GeoBlockRewrite {
  source: string;
  has: { type: "header"; key: string; value: string }[];
  destination: string;
}

/**
 * ISO 3166-1 alpha-2 codes of the countries blocked before the console loads.
 * PLACEHOLDER: monkey-trading/engine#11 decides "the US and sanctioned jurisdictions" and names
 * only the US, which the owner extends to its territories (PR, GU, VI, AS, MP, UM) until counsel supplies the full list, which blocks public launch. Entries are whole
 * countries: a sanctioned region inside a country needs a rule on the edge's region header.
 */
export const RESTRICTED_COUNTRIES: readonly string[] = ["US", "PR", "GU", "VI", "AS", "MP", "UM"];

/** The request header the hosting edge sets from its IP lookup; it is absent when the lookup finds no country. */
export const COUNTRY_HEADER = "x-vercel-ip-country";

/** The static page a blocked request is rewritten to. */
export const RESTRICTED_PATH = "/restricted";

/**
 * Every path except the build's own assets, which the restricted page needs for its styles and
 * font, the restricted page itself, and `robots.txt`, which crawlers must read as written.
 */
export const BLOCKED_SOURCE = "/((?!_next/|restricted$|robots\\.txt$).*)";

/**
 * A regular expression source matching the whole header value of any listed country, or null when
 * the list is empty.
 * Error cases:
 * - a code is not two uppercase letters, so a typo fails the build instead of blocking nothing
 */
export function restrictedCountryPattern(countries: readonly string[]): string | null {
  for (const code of countries) {
    if (!/^[A-Z]{2}$/.test(code)) throw new Error(`Restricted country must be two uppercase letters: ${code}`);
  }
  return countries.length === 0 ? null : `(?:${countries.join("|")})`;
}

/**
 * The rewrites that send a request from a listed country to the restricted page. A request with no
 * country header matches none of them and is served normally. The rewrite is matched before files,
 * so it also covers the home page and public files.
 * Error cases:
 * - a code is not two uppercase letters (from `restrictedCountryPattern`)
 */
export function geoBlockRewrites(countries: readonly string[] = RESTRICTED_COUNTRIES): GeoBlockRewrite[] {
  const value = restrictedCountryPattern(countries);
  if (value === null) return [];
  return [
    { source: BLOCKED_SOURCE, has: [{ type: "header", key: COUNTRY_HEADER, value }], destination: RESTRICTED_PATH },
  ];
}
