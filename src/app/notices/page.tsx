/** The static notices page: what leaves the browser, and the notices third-party software in the console requires. */

import type { Metadata } from "next";
import Link from "next/link";

import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = { title: `Notices | ${SITE_NAME}` };

const H2 = "text-label tracking-caps text-glow uppercase";
const P = "text-data leading-relaxed text-fg-2";
const LINK = "text-glow underline focus-visible:outline-2 focus-visible:outline-glow";

/** Privacy and third-party notices, readable without the console's wallet or engine code. */
export default function Page() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
      <p className="text-label tracking-label text-amber uppercase">{SITE_NAME}</p>
      <h1 className="text-lead tracking-caps text-glow uppercase">Notices</h1>
      <p className={P}><Link href="/" className={LINK}>Back to the console</Link></p>
      <section aria-labelledby="privacy" className="space-y-3">
        <h2 id="privacy" className={H2}>Privacy</h2>
        <p className={P}>
          The console sets no cookies and runs no analytics. Its fonts and scripts come from its own
          address. When you connect a wallet, the console remembers that connection in your
          browser&apos;s storage — which kind of wallet it was, and the WalletConnect session&apos;s
          topic when that is how you connected — so a later page load can reconnect you. It stores
          nothing else — no keys, no addresses, no session secrets — and the stored choice is removed
          when you disconnect in the console, when your wallet app ends the WalletConnect session
          while a console page is open, or when a reconnect does not complete.
        </p>
        <p className={P}>
          When your wallet connects, the console asks it for one signature that authorizes an ephemeral
          key held only in this page&apos;s memory. From then on that key signs your orders and cancels, so
          trading asks for no further wallet prompts; it can never move funds, so deposits, withdrawals
          and claims still ask your wallet each time. Disconnecting revokes the key with one more
          wallet signature; a key left unrevoked — for example when the wallet app ends the connection
          first — expires on its own within the day. It is never written to your browser&apos;s storage: a
          later page load reconnects the wallet silently and asks for that one signature again.
        </p>
        <p className={P}>
          What you do in the console leaves your browser only for the party that needs it. Your account&apos;s
          address, your signed orders, cancels, withdrawals and eligibility declaration, the session
          key&apos;s address with its signed registration and revocation, and the reads of your account go
          to the engine node the console is built for. Deposits, claims and the chain reads around them go
          to the chain through your own wallet.
        </p>
        <p className={P}>
          A development build of the console (one built for a local node) may show a dev faucet that tops your
          wallet&apos;s gas up: that one request goes from the page straight to the build&apos;s pinned local chain
          endpoint, and nothing else does.
        </p>
        <p className={P}>
          If you connect a wallet app with WalletConnect, the pairing and every request between this page and your
          wallet pass through WalletConnect&apos;s relay, run by Reown. The messages are encrypted between the page
          and your wallet, so the relay cannot read them, but it sees your IP address, this page&apos;s address, your
          browser and operating system family, and an identifier for the session. Each pairing and request also loads
          a hidden page from WalletConnect&apos;s Verify service (<code>verify.walletconnect.org</code>), run by Reown,
          which tells your wallet that it comes from this page&apos;s domain; it sees your IP address, this page&apos;s
          address, your browser, and an identifier for the request. A browser wallet uses neither. A remembered
          WalletConnect connection also reconnects on your next page load: no WalletConnect session
          survives a reload, so that load fetches the WalletConnect SDK, contacts the relay, and asks
          the wallet to pair again, until you disconnect.
        </p>
      </section>
      <section aria-labelledby="software" className="space-y-3">
        <h2 id="software" className={H2}>Third-party software</h2>
        <p className={P}>
          The WalletConnect connection uses Reown&apos;s WalletConnect SDK (<code>@walletconnect/universal-provider</code>,{" "}
          <code>sign-client</code>, <code>core</code>, <code>types</code> and <code>utils</code>), under the
          WalletConnect Community License Agreement: <a href="/walletconnect/LICENSE.txt" className={LINK}>read the licence</a>.
        </p>
        <p className={P}>Portions © 2025 Reown, Inc. All Rights Reserved.</p>
        <p className={P}>
          The console itself is licensed under the Apache License, Version 2.0.
        </p>
      </section>
    </main>
  );
}
