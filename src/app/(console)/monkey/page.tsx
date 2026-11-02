/** The MONKEY screen: claims, stake, the token's state, activity and charts. */

import type { Metadata } from "next";

import { MonkeyPage } from "@/components/MonkeyPage";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = { title: `MONKEY | ${SITE_NAME}` };

export default function Page() {
  return <MonkeyPage />;
}
