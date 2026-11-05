/** The House screen's Risk tab: the close-out map, the position map, the house's result at ±1%, and every market's cap. */

import type { Metadata } from "next";

import { HouseRisk } from "@/components/house/HouseRisk";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = { title: `Risk · House | ${SITE_NAME}` };

export default function Page() {
  return <HouseRisk />;
}
