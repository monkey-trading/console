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
          topic when that is how you connected — so a later page load can reconnect you. That choice
          holds no keys, no addresses and no session secrets, and it is removed
          when you disconnect in the console, when your wallet app ends the WalletConnect session
          while a console page is open, or when a reconnect does not complete.
        </p>
        <p className={P}>
          Once you authorize this browser, with one wallet signature, the console also keeps the private
          key of a session key there, with its address, your account&apos;s address, the chain, the vault
          and the key&apos;s expiry, so a reload or a new tab trades without asking again. Anyone who can
          read this browser&apos;s storage can use that key to place and cancel orders on your account until
          it expires, within a day. It can never move funds, so deposits, withdrawals and claims still ask
          your wallet each time. It is removed when you disconnect, when it expires or is revoked, when
          your wallet app ends the WalletConnect session, or when the node stops accepting it, and the
          console then disconnects your wallet in every tab. Disconnecting in the console also asks your
          wallet to revoke it; a key left unrevoked expires on its own. A key for an account no console tab
          has open stays until a wallet next connects in this browser and finds it expired. The console
          never stores your wallet&apos;s own keys.
        </p>
        <p className={P}>
          The console also stores your trading preferences in your browser&apos;s storage: your default
          order type, slippage bound and size choice, whether Cancel all and Close all ask first,
          whether the chart shows entry and order lines, and the last size you placed in each market,
          which it writes each time you place an order. They never leave your browser, and unlike the
          wallet choice and the session key they stay after you disconnect, until you clear this site&apos;s data. The
          Settings page lists your active sessions from the node&apos;s public record of session
          keys, which holds each key&apos;s address, start and expiry and nothing about the browser
          or the network it signed in from.
        </p>
        <p className={P}>
          While your account holds something in the vault, the console keeps a copy of its latest exit
          proof in your browser&apos;s storage, one per account, chain and vault: the proof of your
          balance, positions, withdrawals, staking distribution and pending deposits at the vault&apos;s
          latest checkpoint, with when that checkpoint was posted. The console reads it from the engine
          node, and at the vault&apos;s last checkpoint it lets you claim from the vault if the node is
          gone. To check it, the console
          sends it through your wallet to your wallet&apos;s chain provider, as a read of the vault&apos;s
          verifier; a claim you register publishes it on chain. It goes nowhere else unless you export
          it to a file. It stays after you disconnect, until a later proof replaces it, the node shows your
          account holds nothing, the vault refuses it, or you clear this site&apos;s data. Anyone who can read this
          browser&apos;s storage or that file can see those figures; they cannot move your funds with them.
        </p>
        <p className={P}>
          What you do in the console leaves your browser only for the party that needs it. Your account&apos;s
          address, your signed orders, cancels, withdrawals and eligibility declaration, the session
          key&apos;s address with its signed registration and revocation, and the reads of your account go
          to the engine node the console is built for or, once your wallet&apos;s chain reads name another
          operator, to that operator&apos;s node, which this build must list. Deposits, delegation, claims and the chain
          reads around them, the operator registry&apos;s and the vault&apos;s included, and the read of the USDC your wallet holds, go to the chain through your own wallet.
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
          The Trade page&apos;s price chart and the House page&apos;s close-out map draw their candles with{" "}
          <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer" className={LINK}>TradingView Lightweight Charts™</a>,
          copyright © TradingView, Inc., under the Apache License, Version 2.0.
        </p>
        <p className={P}>
          The console itself is licensed under the Apache License, Version 2.0.
        </p>
      </section>
    </main>
  );
}
