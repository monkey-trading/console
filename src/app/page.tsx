/** The placeholder page until the trading screens land. */

import { SITE_NAME } from "@/lib/site";

export default function Page() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-3 px-6">
      <h1 className="text-lead tracking-caps text-glow uppercase">{SITE_NAME}</h1>
      <p className="text-data text-fg-2">The app is under construction.</p>
    </main>
  );
}
