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
          This app sets no cookies and runs no analytics, and its fonts and scripts are served from its own
          address. When you connect a wallet, the app saves that choice in your browser&apos;s storage so that a
          later page load can reconnect you: the type of wallet and, if you connected through WalletConnect, the
          WalletConnect session&apos;s topic. The saved choice contains no keys, addresses or session secrets. It
          is removed when you disconnect in the app, when your wallet app ends the WalletConnect session while a
          page of this app is open, or when a reconnection does not complete.
        </p>
        <p className={P}>
          When you authorize this browser with a single wallet signature, the app also saves a session key there:
          a key held in this browser that places orders without a wallet prompt. The app saves the session
          key&apos;s private key and address, your account&apos;s address, the chain, the vault and the key&apos;s
          expiry, so that a reload or a new tab can trade without asking again. Anyone who can read this
          browser&apos;s storage can use the session key to place and cancel orders on your account until it
          expires, which is within a day. The session key can never move funds, so your wallet still asks you to
          approve each deposit, withdrawal and claim. The session key is removed when you disconnect, when it
          expires or is revoked, when your wallet app ends the WalletConnect session, or when the server stops
          accepting it, and your wallet is then disconnected in every tab. Disconnecting in the app also asks your
          wallet to revoke the session key, and a key that is not revoked expires on its own. A key for an account
          that no open tab is using remains stored until a wallet next connects in this browser and finds that the
          key has expired. The app never stores your wallet&apos;s own keys.
        </p>
        <p className={P}>
          The app also saves your trading preferences in your browser&apos;s storage: your default order type,
          maximum slippage and order size setting, whether Cancel all and Close all require confirmation, whether
          the chart displays entry and order lines, and the last size you placed in each market, which is saved
          each time you place an order. The preferences never leave your browser. Unlike the wallet choice and the
          session key, they remain after you disconnect, until you clear this site&apos;s data. The Settings page
          lists your active sessions from the server&apos;s public record of session keys. That record holds each
          key&apos;s address, start time and expiry, and nothing about the browser or the network from which the
          key was authorized.
        </p>
        <p className={P}>
          While your account holds anything in the vault, or the vault&apos;s latest snapshot omits a deposit that
          may be yours, the app keeps a copy of your latest exit proof in your browser&apos;s storage, one for
          each account, chain and vault. The exit proof records your balance, positions, withdrawals, staking
          distribution and pending deposits at the vault&apos;s latest snapshot, together with the time at which
          that snapshot was posted. The app obtains the proof from the server, and a proof for the vault&apos;s
          last snapshot allows you to claim from the vault if the server is no longer available. To check the
          proof, the app sends it through your wallet to your wallet&apos;s chain provider, as a query of the
          vault&apos;s verifier, and a claim that you register publishes it on chain. The proof is sent nowhere
          else unless you export it to a file. It remains after you disconnect, until a later proof replaces it,
          the server shows that your account holds nothing, the vault rejects it, or you clear this site&apos;s
          data. Anyone who can read this browser&apos;s storage or the exported file can see the figures in the
          proof, but cannot use them to move your funds.
        </p>
        <p className={P}>
          Your activity in the app leaves your browser only for the party that needs it. Your account&apos;s
          address, your signed orders, cancellations, withdrawals and eligibility declaration, the session
          key&apos;s address with its signed registration and revocation, and the requests that load your account
          are sent to the server for which this app is built. Once the chain data that your wallet reads names
          another operator, those requests go to that operator&apos;s server instead, which this version of the
          app must list. Deposits, delegation, claims and the chain queries made around them, including queries of
          the operator registry and the vault, and the query of the USDC your wallet holds, go to the chain
          through your own wallet.
        </p>
        <p className={P}>
          A test version of the app, built for a local server, may show a test faucet that tops up your
          wallet&apos;s gas and creates test USDC for it. Those requests go from the page directly to the local
          chain address for which that version is built, and no other requests do.
        </p>
        <p className={P}>
          If you connect a wallet app with WalletConnect, the pairing and every request between this page and your
          wallet pass through WalletConnect&apos;s relay, which is run by Reown. The messages are encrypted
          between the page and your wallet, so the relay cannot read them, but it sees your IP address, this
          page&apos;s address, your browser and operating system family, and an identifier for the session. Each
          pairing and request also loads a hidden page from WalletConnect&apos;s Verify service
          (<code>verify.walletconnect.org</code>), also run by Reown, which confirms to your wallet that the
          request comes from this page&apos;s domain. The Verify service sees your IP address, this page&apos;s
          address, your browser, and an identifier for the request. A browser wallet uses neither service. A
          remembered WalletConnect connection also reconnects on your next page load: because no WalletConnect
          session survives a reload, that page load fetches the WalletConnect SDK, contacts the relay and asks the
          wallet to pair again, until you disconnect.
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
