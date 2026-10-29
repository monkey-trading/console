/** The static page a request from a restricted country is rewritten to. */

import type { Metadata } from "next";

import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = { title: `Not available in your region | ${SITE_NAME}` };

/** The explanation shown in place of the console; the page itself holds no wallet code and no requests to the engine node. */
export default function Page() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-3 px-6">
      <p className="text-label tracking-label text-amber uppercase">{SITE_NAME}</p>
      <h1 className="text-lead tracking-caps text-glow uppercase">Not available in your region</h1>
      <p className="text-data text-fg-2">
        This app is not available in your region. It is in build, nothing is live yet, and nothing on it is an
        offer.
      </p>
    </main>
  );
}
