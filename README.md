# console

The Monkey Trading web app, to be served at console.monkey.trading: the client for the open-source CFD
engine in [monkey-trading/engine](https://github.com/monkey-trading/engine). One full-view trading
terminal with a watchlist, a candlestick chart, a deal ticket that sends the quote you saw with your
slippage bound, positions, orders, history, and a funding drawer.

By default this build runs against a simulated node inside the browser. Prices, fills and funds are
simulated, and the app says so on screen. It opens on a demo account with positions, resting orders,
history and a withdrawal in the queue; Mock controls can reset it to an empty account.

A build can instead read a real engine node: it checks the node's attestation, shows only answers the
attested enclave signed for the request, and follows the node's signed stream, which starts at the live end of the log and reconnects there, marking the feed stale
(and disabling order entry) when it stops. Signing orders and funds is not wired yet. The checks run
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

## Run it against a local engine node

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
| `NEXT_PUBLIC_ENGINE_USDC` | Optional USDC address |
| `NEXT_PUBLIC_ENGINE_HEARTBEAT_MS` | The node's `[api] heartbeat_interval`, in milliseconds (default 5000) |
| `NEXT_PUBLIC_ENGINE_DEV_ORIGINS` | Comma-separated node origins a `live-dev` build may accept a mock attestation from |

The node's origin is added to the Content Security Policy's `connect-src` (with its `wss:` form), and
`'wasm-unsafe-eval'` to `script-src`. A `live` build refuses a mock attestation, and the console's wrapper of the verifier does
not expose the mock entry point there (the served package still exports it); with no release manifests pinned yet
(`src/lib/engine/manifests.ts`), it trusts no hardware node either.

`scripts/dev-live-client.sh` (Node, `curl`, and `ENGINE_DIR`, the engine checkout, with `ENGINE_BIN`
or Cargo) starts a dev node and runs the live client in Node against it through a tampering proxy,
checking that a flipped byte, a replayed response, a dropped stream frame and a mock attestation in
a production build are each refused. It does not exercise the browser build: how the page loads the
verifier, and its Content Security Policy, are checked by running `npm run dev:live`, or a
production build with the same variables, against a node.

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
`NEXT_PUBLIC_ENGINE_*` variables in the table under "Run it against a local engine node", which the
owner sets in the hosting settings.

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
