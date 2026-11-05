/** The MONKEY screen's Activity tab: the latest MONKEY events, newest first. */

import type { Metadata } from "next";

import { MonkeyActivity } from "@/components/monkey/MonkeyActivity";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = { title: `Activity · MONKEY | ${SITE_NAME}` };

export default function Page() {
  return <MonkeyActivity />;
}
