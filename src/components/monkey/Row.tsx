/** One labelled figure on the MONKEY and Staking pages, the label left and the value right. */

import type { ReactNode } from "react";

/**
 * `reserve` is the longest value the row is likely to show, laid out unseen under the value: the
 * row wraps as it will once its figure lands, so the figure arriving moves nothing below it.
 */
export function Row({ label, children, reserve }: { label: string; children: ReactNode; reserve?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-caption">
      <dt className="min-w-0 [overflow-wrap:anywhere] text-fg-3">{label}</dt>
      <dd className="ml-auto min-w-0 max-w-full text-right [overflow-wrap:anywhere] text-fg">
        {reserve === undefined ? children : (
          <span className="grid">
            <span aria-hidden="true" className="invisible col-start-1 row-start-1">{reserve}</span>
            <span className="col-start-1 row-start-1 justify-self-end">{children}</span>
          </span>
        )}
      </dd>
    </div>
  );
}
