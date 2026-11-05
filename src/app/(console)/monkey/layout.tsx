/** The MONKEY screen's section: the heading and the Emissions and Activity tab bar over the tab the route opens. */

import type { ReactNode } from "react";

import { MonkeySection } from "@/components/monkey/MonkeySection";

/** Wraps the MONKEY section's tabs in the section that holds their shared panel. */
export default function MonkeyLayout({ children }: { children: ReactNode }) {
  return <MonkeySection>{children}</MonkeySection>;
}
