/** The House screen's section: the heading and the Overview, Risk and Withdrawals tab bar over the tab the route opens. */

import type { ReactNode } from "react";

import { HouseSection } from "@/components/house/HouseSection";

/** Wraps the House section's tabs in the section that holds its shared reads. */
export default function HouseLayout({ children }: { children: ReactNode }) {
  return <HouseSection>{children}</HouseSection>;
}
