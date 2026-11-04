/** The Staking screen: the account's stake, its USDC distributions with their claim and history, and the operators its stake is delegated to. */

import type { Metadata } from "next";

import { StakingPage } from "@/components/StakingPage";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = { title: `Staking | ${SITE_NAME}` };

export default function Page() {
  return <StakingPage />;
}
