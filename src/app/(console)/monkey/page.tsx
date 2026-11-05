/** The MONKEY screen's Emissions tab: the account's MONKEY emissions with their claim, and the token. */

import type { Metadata } from "next";

import { MonkeyEmissions } from "@/components/monkey/MonkeyEmissions";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = { title: `MONKEY | ${SITE_NAME}` };

export default function Page() {
  return <MonkeyEmissions />;
}
