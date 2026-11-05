/** The Staking screen's Rewards tab: the USDC distribution claim, the rewards figures, and the account's distributions by epoch. */

import type { Metadata } from "next";

import { StakingRewards } from "@/components/staking/StakingRewards";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = { title: `Rewards · Staking | ${SITE_NAME}` };

export default function Page() {
  return <StakingRewards />;
}
