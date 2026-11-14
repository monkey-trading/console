/** The Staking screen's section: the heading and the Delegate, Rewards, Epochs and Governance tab bar over the tab the route opens. */

import type { ReactNode } from "react";

import { StakingSection } from "@/components/StakingSection";

/** Wraps the Staking section's tabs in the section that holds their shared reads. */
export default function StakingLayout({ children }: { children: ReactNode }) {
  return <StakingSection>{children}</StakingSection>;
}
