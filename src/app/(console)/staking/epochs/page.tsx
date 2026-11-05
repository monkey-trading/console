/** The Staking screen's Epochs tab: the distribution's state, every closed epoch, and the two distribution charts. */

import type { Metadata } from "next";

import { StakingEpochs } from "@/components/staking/StakingEpochs";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = { title: `Epochs · Staking | ${SITE_NAME}` };

export default function Page() {
  return <StakingEpochs />;
}
