"use client";

/** A page's section tab bar: a labelled nav of links to its sub-routes, wrapping onto a further row rather than scrolling. */

import Link from "next/link";
import { usePathname } from "next/navigation";

import { isCurrentTab, type PageSection } from "@/lib/nav";

const TAB = "inline-flex min-h-11 items-center border-b-2 px-1.5 text-caption uppercase focus-visible:outline-2 focus-visible:outline-glow lg:min-h-6";
const TAB_IDLE = `${TAB} -mb-px border-transparent text-fg-3 hover:text-fg`;
const TAB_CURRENT = `${TAB} -mb-px border-glow text-glow`;

/** The section's tabs, one per sub-route; the open one is underlined and named with `aria-current`. The `data-section-tabs` mark scopes the phone's scroll padding to a page whose bar sticks to the viewport top. */
export function SectionTabs({ section }: { section: PageSection }) {
  const pathname = usePathname();
  return (
    <nav aria-label={section.label} data-section-tabs="" className="flex flex-wrap items-center gap-x-3 border-b border-line">
      {section.tabs.map(({ href, label }) => {
        const current = isCurrentTab(pathname, href);
        return (
          <Link key={href} href={href} aria-current={current ? "page" : undefined} className={current ? TAB_CURRENT : TAB_IDLE}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
