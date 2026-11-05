/** The House screen's Overview tab: the house's figures, its book against the cap, and the log's parameters and checkpoints. */

import type { Metadata } from "next";

import { HouseOverview } from "@/components/house/HouseOverview";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = { title: `House | ${SITE_NAME}` };

export default function Page() {
  return <HouseOverview />;
}
