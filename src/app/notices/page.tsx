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
      <p className={P}><Link href="/" className={LINK}>Back to the app</Link></p>
      <section aria-labelledby="privacy" className="space-y-3">
        <h2 id="privacy" className={H2}>Privacy</h2>
        <p className={P}>
          This app sets no cookies and runs no analytics. Its fonts and scripts come from its own
          address. When you connect a wallet, the app saves that choice in your browser&apos;s storage so a
          later page load can reconnect you: the kind of wallet, and the WalletConnect session&apos;s topic if
          you connected that way. It holds no keys, addresses or session secrets. It&apos;s removed when you
          disconnect in the app, when your wallet app ends the WalletConnect session while a page of this app
          is open, or when a reconnect doesn&apos;t complete.
        </p>
        <p className={P}>
          When you authorize this browser with one wallet signature, the app also saves a session key there:
          a key in this browser that places orders without a wallet prompt. It saves the key&apos;s private key
          and address, your account&apos;s address, the chain, the vault and the key&apos;s expiry, so a reload or
          a new tab can trade without asking again. Anyone who can read this browser&apos;s storage can use that
          key to place and cancel orders on your account until it expires, within a day. It can never move
          funds, so deposits, withdrawals and claims still ask your wallet each time. It&apos;s removed when you
          disconnect, when it expires or is revoked, when your wallet app ends the WalletConnect session, or
          when the server stops accepting it, and your wallet is then disconnected in every tab. Disconnecting
          in the app also asks your wallet to revoke the key; a key left unrevoked expires on its own. A key for
          an account that no open tab is using stays until a wallet next connects in this browser and finds it
          expired. The app never stores your wallet&apos;s own keys.
        </p>
        <p className={P}>
          The app also saves your trading preferences in your browser&apos;s storage: your default order type,
          max slippage and size choice, whether Cancel all and Close all ask first, whether the chart shows
          entry and order lines, and the last size you placed in each market, saved each time you place an
          order. They never leave your browser. Unlike the wallet choice and the session key, they stay after
          you disconnect, until you clear this site&apos;s data. The Settings page lists your active sessions
          from the server&apos;s public record of session keys. That record holds each key&apos;s address, start
          and expiry, and nothing about the browser or the network it signed in from.
        </p>
        <p className={P}>
          While your account holds something in the vault, or the vault&apos;s latest snapshot leaves out a
          deposit that may be yours, the app keeps a copy of your latest exit proof in your browser&apos;s
          storage, one per account, chain and vault. It&apos;s the proof of your balance, positions,
          withdrawals, staking distribution and pending deposits at the vault&apos;s latest snapshot, with when
          that snapshot was posted. The app gets it from the server, and a proof for the vault&apos;s last
          snapshot lets you claim from the vault if the server is gone. To check it, the app sends it through
          your wallet to your wallet&apos;s chain provider, as a read of the vault&apos;s verifier, and a claim you
          register publishes it on chain. It goes nowhere else unless you export it to a file. It stays after
          you disconnect, until a later proof replaces it, the server shows your account holds nothing, the
          vault refuses it, or you clear this site&apos;s data. Anyone who can read this browser&apos;s storage or
          that file can see those figures, but they can&apos;t move your funds with them.
        </p>
        <p className={P}>
          What you do in the app leaves your browser only for the party that needs it. Your account&apos;s
          address, your signed orders, cancels, withdrawals and eligibility declaration, the session key&apos;s
          address with its signed registration and revocation, and the reads of your account go to the server
          this app is built for. Once your wallet&apos;s chain reads name another operator, they go to that
          operator&apos;s server instead, which this version of the app must list. Deposits, delegation, claims
          and the chain reads around them, including reads of the operator registry and the vault, and the
          read of the USDC your wallet holds, go to the chain through your own wallet.
        </p>
        <p className={P}>
          A test version of the app, built for a local server, may show a test faucet that tops up your
          wallet&apos;s gas and creates test USDC for it. Those requests go from the page straight to the local
          chain address that version is built for, and nothing else does.
        </p>
        <p className={P}>
          If you connect a wallet app with WalletConnect, the pairing and every request between this page and your
          wallet pass through WalletConnect&apos;s relay, run by Reown. The messages are encrypted between the page
          and your wallet, so the relay can&apos;t read them, but it sees your IP address, this page&apos;s address, your
          browser and operating system family, and an identifier for the session. Each pairing and request also loads
          a hidden page from WalletConnect&apos;s Verify service (<code>verify.walletconnect.org</code>), run by Reown,
          which tells your wallet that it comes from this page&apos;s domain. It sees your IP address, this page&apos;s
          address, your browser, and an identifier for the request. A browser wallet uses neither. A remembered
          WalletConnect connection also reconnects on your next page load: no WalletConnect session survives a
          reload, so that load fetches the WalletConnect SDK, contacts the relay and asks the wallet to pair again,
          until you disconnect.
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
