/** `robots.txt`: the console asks every crawler to stay out. */

import type { MetadataRoute } from "next";

/** Disallows every path for every crawler. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
