/** The House screen's Withdrawals tab: the withdrawal queue's totals, the connected account's place in it, and the queue's health. */

import type { Metadata } from "next";

import { HouseWithdrawals } from "@/components/house/HouseWithdrawals";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = { title: `Withdrawals · House | ${SITE_NAME}` };

export default function Page() {
  return <HouseWithdrawals />;
}
