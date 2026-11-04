/** How the Staking page treats a candidate's registered hostname: what it shows, and whether this build could connect there. */

import { hostnameOrigin, listedOrigins, type Deploy } from "../engine/deploy";

/** A hostname as the page shows it: plain ASCII as the build could connect to it, or null for text it could not, so a lookalike in another script never reads as a host. */
export function shownHostname(hostname: string | null): string | null {
  return hostname !== null && hostnameOrigin(hostname) !== null ? hostname.toLowerCase() : null;
}

/** Whether this build could connect to `hostname`: its CSP names the origin. */
export function hostnameListed(deploy: Pick<Deploy, "origin" | "candidateOrigins">, hostname: string): boolean {
  const origin = hostnameOrigin(hostname);
  return origin !== null && listedOrigins(deploy).includes(origin);
}
