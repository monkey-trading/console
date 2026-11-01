# console

The Monkey Trading web app, to be served at console.monkey.trading: the client for the open-source CFD
engine in [monkey-trading/engine](https://github.com/monkey-trading/engine). One full-view trading
terminal with a watchlist, a candlestick chart, a deal ticket that sends the quote you saw with your
slippage bound, positions, orders, history, and a funding drawer — and a House page that shows the
house's solvency from the node's signed answers: its net asset value, cash and exposure against its
caps, the withdrawal queue's size, and the signed checkpoint roots the figures stand on.

By default this build runs against a simulated node inside the browser. Prices, fills and funds are
simulated, and the app says so on screen. It opens on a demo account with positions, resting orders,
history and a withdrawal in the queue; Mock controls can reset it to an empty account.

A build can instead talk to a real engine node: it checks the node's attestation, shows only answers the
attested enclave signed for the request, and follows the node's signed stream, which starts at the live end of the log and reconnects there, marking the feed stale
(and disabling order entry) when it stops. With a browser wallet, or a wallet app over WalletConnect, it
deposits USDC to the vault, signs the engine's typed requests (orders, cancels, withdrawals, the eligibility
declaration) for a node whose attestation it accepts — orders and cancels with an ephemeral in-browser
session key the wallet authorizes with one signature at connect, never the key itself —, trades at the
executable quote the node streams for the account, and claims approved withdrawals on the vault. The checks run
in the engine's own verifier, built for the browser (`public/engine-verify/`, pinned by SHA-256 in
`src/lib/engine/wasm-pin.json`, which `npm run build` checks).

## Run it

Requires Node.js 24 (see `.nvmrc`).

```sh
npm ci
npm run dev
```

The app is served at `http://localhost:3000`. The Mock controls button in the top strip changes the
simulated node: the region it sees you in (to show the geo-block), its attestation, price shocks that
trigger a close-out, market halts, stress levels, and vault liquidity for the withdrawal queue. Before sending a change, run `npm run lint`,
`npm run typecheck`, `npm test`, `npm run build`, and `npm audit --audit-level=high`; CI runs these,
the geo-block check (`scripts/check-geo-block.sh`, after the build), and the docs and workflow checks.

## Trade against a local engine node

`scripts/dev-local-stack.sh` starts everything a wallet needs on one machine: an Anvil chain with the vault
and a mock USDC, the house's capital in the vault, mock USDC in a dev wallet, an engine node on that chain's
custody that prices BTC-USD and ETH-USD from live crypto venues (the other markets need market-data vendor
keys and stay unpriced) and posts checkpoints so withdrawals can be claimed, and the console in development
mode against it. It needs Anvil, Forge and Cast, Cargo, Node.js and npm, curl, `jq`, Python 3.11 or later, and the engine's
repository beside this one (or at `ENGINE_DIR`) with its contract dependencies installed (`forge soldeer
install` in its `contracts/`):

```sh
npm ci
./scripts/dev-local-stack.sh
```

It prints how to add the Anvil network and import the dev wallet's key (a public test key) into a browser
wallet, the mock USDC's address, and the console's address, `http://localhost:3000`; Ctrl-C stops everything
it started. In the console, connect the wallet, deposit from Funding, sign the eligibility declaration once
the node sees the deposit pending, and trade. Its header lists the variables that move its ports, fund
another address, or serve a production build.

## Read a local engine development node

Needs the engine's repository, Cargo, and a development node (`config/dev.toml` lists
`http://localhost:3000` as an allowed origin). In the engine checkout:

```sh
cargo run -p engine-node -- run --config config/dev.toml
```

The node serves TLS on `https://127.0.0.1:8080` with a self-signed certificate: open
`https://127.0.0.1:8080/v1/health` in the browser once and accept it, so the page may fetch and open
the stream. Then, here:

```sh
npm run dev:live
```

Open `http://localhost:3000` (not `127.0.0.1`: the node allows that origin only). Markets and prices
stream in under a banner saying the mock attestation was accepted, which only a development build
for a listed dev origin does. To
read an account, add `?account=<address>` to the page address; it is read-only.

A live build is configured by environment variables at build time, all pinned into the bundle:

| Variable | Meaning |
| --- | --- |
| `NEXT_PUBLIC_ENGINE_MODE` | `mock` (default), `live-dev`, or `live` |
| `NEXT_PUBLIC_ENGINE_ORIGIN` | The node's bare `https://` origin; the stream is the same host over `wss` |
| `NEXT_PUBLIC_ENGINE_CHAIN_ID`, `NEXT_PUBLIC_ENGINE_VAULT` | The deployment every signature must name |
| `NEXT_PUBLIC_ENGINE_USDC` | The USDC the vault takes; without it the build cannot deposit |
| `NEXT_PUBLIC_ENGINE_RPC_URL` | Optional RPC URL a wallet that does not know the chain is offered, such as a local Anvil chain's; in a `live-dev` build the Funding drawer's faucet also tops gas up through it |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Optional WalletConnect project id (32 lowercase hex characters); without it the build offers no WalletConnect |
| `NEXT_PUBLIC_ENGINE_HEARTBEAT_MS` | The node's `[api] heartbeat_interval`, in milliseconds (default 5000) |
| `NEXT_PUBLIC_ENGINE_DEV_ORIGINS` | Comma-separated node origins a `live-dev` build may accept a mock attestation from |

The node's origin is added to the Content Security Policy's `connect-src` (with its `wss:` form), and
`'wasm-unsafe-eval'` to `script-src`; a build with a WalletConnect project id also adds WalletConnect's relay,
`wss://relay.walletconnect.org`, to `connect-src`, and its Verify service, `https://verify.walletconnect.org`, to
`frame-src`. Chain reads go through the user's wallet, never to an RPC of the console's
own; the one exception is the `live-dev` build's dev faucet, which tops the wallet's gas up with
`anvil_setBalance` on the build's pinned `NEXT_PUBLIC_ENGINE_RPC_URL` (its `connect-src` only in that
build) while the USDC mint still goes through the wallet. `/notices` says what leaves the browser. A `live` build refuses a mock attestation, and the console's wrapper of the verifier does
not expose the mock entry point there (the served package still exports it); with no release manifests pinned yet
(`src/lib/engine/manifests.ts`), it trusts no hardware node either.

`scripts/dev-live-client.sh` (Node, `curl`, and `ENGINE_DIR`, the engine checkout, with `ENGINE_BIN`
or Cargo) starts a dev node and runs the live client in Node against it through a tampering proxy,
checking that a flipped byte, a replayed response, a dropped stream frame and a mock attestation in
a production build are each refused. `scripts/dev-trading.sh` (the same needs, plus python3 3.11 or
later and the internet for the node's Roughtime servers; with `ENGINE_BIN`, the `access_source`
example built beside it) starts a private dev node on mock custody with EIP-712 client auth
and trades against it through the console's store and actions: it funds a fixed-key wallet through
the mock-custody dev endpoint, declares eligibility, fills a market order at the streamed
executable quote sent as the quoted price with a slippage bound, rests and cancels a limit order,
closes a position reduce only at the streamed closing price, and is closed out when the operator's
upsert-market raises the margin tier past its equity. It does not exercise the browser build: how
the page loads the verifier, and its Content Security Policy, are checked by running `npm run
dev:live`, or a production build with the same variables, against a node.

### Updating the verifier

`public/engine-verify/` is the package `scripts/build-wasm-verifier.sh` writes in the engine
repository (`engine_verify_bg.wasm`, its glue and types, and `SHA256SUMS`), copied unchanged; the
`.wasm` and glue hashes are in `src/lib/engine/wasm-pin.json`. A `file:` dependency would break the
exact-version rule, and no release publishes the package yet, so the copy is checked in. A release's
package replaces it, with its hashes, before the console is promoted.

## Deploy

`npm run build` prerenders every route; `npm start` serves the build. The build reads two optional
environment variables for the canonical origin in the document metadata: `SITE_URL`, a bare
http(s) origin such as `https://console.monkey.trading` that takes precedence, and
`VERCEL_PROJECT_PRODUCTION_URL`, a bare host that Vercel sets once the repository is connected to
it. With neither, the origin is `http://localhost:3000`. A build that talks to a live node also reads the
`NEXT_PUBLIC_ENGINE_*` variables and the WalletConnect project id in the table under "Read a local engine
development node", which the owner sets in the hosting settings.

The WalletConnect connection uses Reown's WalletConnect SDK under the WalletConnect Community License
Agreement, not an open-source licence. The console uses it unmodified, ships the notice and a copy of the
licence (`public/walletconnect/LICENSE.txt`, both shown on `/notices`), and shows WalletConnect's logo where
it offers WalletConnect; above 500 monthly active users the licence requires a paid licence from Reown.

## Restricted regions

A request from a restricted country is rewritten to the static `/restricted` page, which says the
app is not available in the visitor's region. Every path is rewritten except the build's `/_next/`
assets, `/restricted` itself, and `/robots.txt`. The edge decides from the country header its IP
lookup sets (`x-vercel-ip-country` on Vercel); a request with no country is served normally. The
countries are `RESTRICTED_COUNTRIES` in `src/lib/geo-block.ts`: the US and its territories, a
placeholder until counsel supplies the final list. `next.config.ts` builds the rewrite from that
list, and `scripts/check-geo-block.sh` checks it against a production build.

The block follows the visitor's IP address, so a VPN or proxy evades it, and it is not a compliance
control on its own: enforcement belongs to the engine node, not to this block.

Search engines are asked to stay away from the whole console: every page carries a `noindex` robots
meta tag and an `X-Robots-Tag: noindex, nofollow` header, and `robots.txt` disallows every path.

If the host stops matching the header in a rewrite, the fallback is a firewall rule in the host's
dashboard that serves `/restricted` for the same countries: match the request's country against the
list, rewrite the path to `/restricted`, and leave `/_next/`, `/restricted`, and `/robots.txt`
unmatched.

## License

Licensed under the Apache License, Version 2.0; see [LICENSE](LICENSE).
