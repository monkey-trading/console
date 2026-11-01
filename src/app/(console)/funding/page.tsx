/** The funding screen. */

import type { Metadata } from "next";

import { FundingPage } from "@/components/FundingPage";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = { title: `Funding | ${SITE_NAME}` };

export default function Page() {
  return <FundingPage />;
}
