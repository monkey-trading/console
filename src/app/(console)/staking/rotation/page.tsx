/** The Staking screen's Rotation tab: the rotation set in effect and the next, skips and promotions, and the turn history. */

import type { Metadata } from "next";

import { StakingRotation } from "@/components/staking/StakingRotation";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = { title: `Rotation · Staking | ${SITE_NAME}` };

export default function Page() {
  return <StakingRotation />;
}
