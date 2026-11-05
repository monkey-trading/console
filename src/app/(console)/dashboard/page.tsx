/** The Dashboard screen: every series chart the node serves, in House, MONKEY and Staking sections under one range. */

import type { Metadata } from "next";

import { DashboardPage } from "@/components/DashboardPage";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = { title: `Dashboard | ${SITE_NAME}` };

export default function Page() {
  return <DashboardPage />;
}
