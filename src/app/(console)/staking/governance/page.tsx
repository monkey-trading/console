/** The Staking screen's Governance tab: the proposals taking votes, the passed changes waiting, the restrictions in force, and a member's vote. */

import type { Metadata } from "next";

import { StakingGovernance } from "@/components/staking/StakingGovernance";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = { title: `Governance · Staking | ${SITE_NAME}` };

export default function Page() {
  return <StakingGovernance />;
}
