/** One labelled figure on the MONKEY and Staking pages, the label left and the value right. */

import type { ReactNode } from "react";

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-caption">
      <dt className="min-w-0 [overflow-wrap:anywhere] text-fg-3">{label}</dt>
      <dd className="ml-auto min-w-0 max-w-full text-right [overflow-wrap:anywhere] text-fg">{children}</dd>
    </div>
  );
}
