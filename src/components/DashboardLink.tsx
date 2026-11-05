/** A line linking a section's page to its charts on the Dashboard: the sentence names what moved there. */

import Link from "next/link";
import type { ReactNode } from "react";

/** "See the history of … on the Dashboard", linking to the section's anchor there. */
export function DashboardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <p className="text-caption text-fg-3">
      <Link href={href} className="text-glow hover:text-glow-hover focus-visible:outline-2 focus-visible:outline-glow">
        {children}
      </Link>
    </p>
  );
}
