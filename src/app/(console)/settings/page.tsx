/** The settings screen: trading preferences and the account's active sessions. */

import type { Metadata } from "next";

import { SettingsPage } from "@/components/SettingsPage";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = { title: `Settings | ${SITE_NAME}` };

export default function Page() {
  return <SettingsPage />;
}
