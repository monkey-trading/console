/** The Staking screen's Delegate tab: the account's stake and the operators its stake is delegated to. */

import type { Metadata } from "next";

import { StakingDelegate } from "@/components/staking/StakingDelegate";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = { title: `Staking | ${SITE_NAME}` };

export default function Page() {
  return <StakingDelegate />;
}
