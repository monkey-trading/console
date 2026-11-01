/** The House solvency screen. */

import type { Metadata } from "next";

import { HousePage } from "@/components/HousePage";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = { title: `House | ${SITE_NAME}` };

export default function Page() {
  return <HousePage />;
}
