# console

The Monkey Trading web app, to be served at console.monkey.trading: the client for the open-source CFD
engine in [monkey-trading/engine](https://github.com/monkey-trading/engine). One full-view trading
terminal with a watchlist, a candlestick chart, a deal ticket that sends the quote you saw with your
slippage bound, positions, orders, history, a P&L ledger of realised results with the MONKEY each loss earned, a Funding page, a Settings page for trading preferences and the browsers signed in to trade, a MONKEY page for the token and claiming its emissions, a Staking page for staking, delegation, the USDC distributions and the operators, a Dashboard page for every time-series chart the node serves (the house's NAV, exposure and withdrawal queue, MONKEY emissions and supply, and the USDC distributions, under one range), and a House page that shows the
house's solvency from the node's signed answers: its net asset value, cash and exposure against its
caps, the withdrawal queue's size, and the signed checkpoint roots the figures stand on.

By default this build runs against a simulated node inside the browser. Prices, fills and funds are
simulated, and the app says so on screen. It opens on a demo account with positions, resting orders,
history and a withdrawal in the queue; Mock controls can reset it to an empty account.

A build can instead talk to a real engine node: it checks the node's attestation, shows only answers the
attested enclave signed for the request, and follows the node's signed stream, which starts at the live end of the log and reconnects there, marking the feed stale
(and disabling order entry) when it stops. With a browser wallet, or a wallet app over WalletConnect, it
deposits USDC to the vault, signs the engine's typed requests (orders, cancels, cancel all and close all, withdrawals, the eligibility
declaration) for a node whose attestation it accepts. Orders, cancels and the two batches sign with an in-browser
session key the wallet authorizes with one signature, straight after a connect for a wallet that has declared and in the setup popup for one that has not, kept in the browser's storage until it expires; deposits, withdrawals and claims always use
the wallet. It trades at the executable quote the node streams for the account, and claims approved
withdrawals on the vault. The checks run
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
and a mock USDC, the operator registry that deploys the MONKEY staking contract (rotation off), the house's
capital in the vault, mock USDC in a dev wallet, an engine node on that chain's custody that prices BTC-USD and
ETH-USD from live crypto venues (the other markets need market-data vendor keys and stay unpriced), runs MONKEY
emissions and staking, and posts checkpoints so withdrawals and MONKEY claims can be made, and the console in
development mode against it, with the MONKEY token and staking contract named for its MONKEY and Staking pages. It needs Anvil, Forge and Cast, Cargo, Node.js and npm, curl, `jq`, Python 3.11 or later, and the engine's
repository beside this one (or at `ENGINE_DIR`) with its contract dependencies installed (`forge soldeer
install` in its `contracts/`):

```sh
npm ci
./scripts/dev-local-stack.sh
```

It prints how to add the Anvil network and import the dev wallet's key (a public test key) into a browser
wallet, the mock USDC's address, and the console's address, `http://localhost:3000`; Ctrl-C stops everything
it started. In the console, connect the wallet and follow the setup popup (fund with Anvil, sign the eligibility
declaration, authorize the browser, deposit), then trade; Funding is where later deposits go. A realised loss earns MONKEY once its ten-minute period closes:
claim it on the MONKEY page and stake it on the Staking page, and the epoch that closes next, every five minutes, pays stakers the
house's USDC above its floor. The staking epoch, unstake cooldown and floor are development values that the
script prints. Its header lists the variables that move its ports, fund
another address, or serve a production build.

## Try delegation, an election and a handover

The same stack can run two engines, so a staker's vote moves the operator and the console follows it:

```sh
SECOND_ENGINE=1 ./scripts/dev-local-stack.sh
```

The first engine runs under sealed keys with operator rotation on, as the operator in effect. A second engine
is registered as a candidate with an approved release; the stack starts it once an election has made the
vault name that release, and it then takes the first engine's keys and log. The registry's election epoch is a
minute. Two wallets (Anvil accounts 1 and 3, whose public test keys the script prints) each hold 20,000 MONKEY
and 100,000 mock USDC. In a second terminal, `scripts/dev-local-stack-ctl.sh` drives the rest:

1. On the Staking page, connect the first wallet, stake its MONKEY and delegate an amount of it to
   `127.0.0.1:8081`, the second engine. Do the same from the second wallet. The operators table, which the node
   reads from the chain at a final block every five seconds here, lists both candidates with their delegated
   stake and whether each is eligible. A delegation can be moved to another candidate or taken back in part, and
   an unstake takes the undelegated stake first, then each delegation in proportion.
2. `./scripts/dev-local-stack-ctl.sh elect` closes the election epoch. The candidate with the most delegated
   stake wins when it is eligible (5% of all stake), at least 20% of all stake is delegated, and its votes lead
   the operator in effect by 10%. The Staking page's operators then show the pending election.
3. Claim any withdrawal you want paid (see below), then run `./scripts/dev-local-stack-ctl.sh handover`. It
   moves the chain's clock past the election's seven-day notice, so the vault names the second engine's
   release; the stack starts that engine, which takes the keys and the log, and the first engine exits. The
   console follows to the second engine by itself, with balances and positions intact, and trading works. A
   browser keeps a self-signed certificate per origin: if the console does not move, open
   `https://127.0.0.1:8081/v1/health` once and accept it. A page loaded after the handover moves as soon as a
   wallet is connected.
4. `./scripts/dev-local-stack-ctl.sh fund-house 50000` adds mock USDC to the house's capital. This stack's
   staking floor is that capital, so the next epoch that closes with a stake (every five minutes; set
   `STAKING_EPOCH_SECS` to shorten it) distributes the added amount: while operator rotation is on, a fifth to
   the operator in effect, and the rest to stakers in proportion to their stake. Each wallet sees its share on
   the Staking page's Rewards tab and claims it there, and the House page shows the same total as "USDC
   distributed" and "Distributed".

`./scripts/dev-local-stack-ctl.sh status` prints the election, the vault's release, both engines and the
chain's clock. The stack writes its addresses to `monkey-local-stack.json` in the temporary directory (or
`STACK_INFO_FILE`), which the control script reads, and its probe of Anvil stops it with a message if Anvil
stops answering, since the chain is lost with it.

The notice can only pass on the chain's clock: the engine's clock is signed time from the internet, which a
local stack cannot move. After `handover` the chain is a week ahead of the engine, which leaves:

- Working: trading, quotes, session keys, positions and balances, deposits, staking and delegation, epochs,
  distributions and their claims, checkpoints and the exit proof.
- Not working until real time has caught up a week later: withdrawals. The vault accepts an authorization for
  24 hours of the chain's clock from when the engine signed it, on the engine's clock, so every authorization
  is expired when it arrives and the vault refuses the claim. Claim what you want paid before `handover`.
- Different from a real election: the engine still shows the previous admin key as the operator's, with the
  elected key pending, because it applies a new key only after seven days of its own time, so admin commands
  signed by the elected key are not accepted either.
- One handover per stack. Stop the stack and start it again for a fresh chain.

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
| `NEXT_PUBLIC_ENGINE_STAKING` | Optional staking contract the Staking page stakes into; without it staking is refused |
| `NEXT_PUBLIC_ENGINE_MONKEY` | Optional MONKEY token address the MONKEY page shows with a copy button |
| `NEXT_PUBLIC_ENGINE_RPC_URL` | Optional RPC URL a wallet that does not know the chain is offered, such as a local Anvil chain's; in a `live-dev` build the faucet also tops gas up and mints the mock USDC through it |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Optional WalletConnect project id (32 lowercase hex characters); without it the build offers no WalletConnect |
| `NEXT_PUBLIC_ENGINE_HEARTBEAT_MS` | The node's `[api] heartbeat_interval`, in milliseconds (default 5000) |
| `NEXT_PUBLIC_ENGINE_DEV_ORIGINS` | Comma-separated node origins a `live-dev` build may accept a mock attestation from |
| `NEXT_PUBLIC_ENGINE_REGISTRY` | Optional operator registry; without it the build does not follow the operator, and the Staking page lists no operators |
| `NEXT_PUBLIC_ENGINE_CANDIDATE_ORIGINS` | Comma-separated bare `https://` origins of every timelock-approved candidate's registered hostname: the nodes the build can follow beside its own, named one by one |
| `NEXT_PUBLIC_ENGINE_DEV_LAUNCH_DIGESTS` | Comma-separated 48-byte stand-ins, in a `live-dev` build only, for the launch digest a mock quote cannot measure, so a local stack runs the vault's release check |

The node's origin and each candidate's are added to the Content Security Policy's `connect-src` (each with its `wss:` form), with no wildcard or scheme source, and
`'wasm-unsafe-eval'` to `script-src`; a build with a WalletConnect project id also adds WalletConnect's relay,
`wss://relay.walletconnect.org`, to `connect-src`, and its Verify service, `https://verify.walletconnect.org`, to
`frame-src`. Chain reads go through the user's wallet, never to an RPC of the console's
own; the one exception is the `live-dev` build's dev faucet, which tops the wallet's gas up with
`anvil_setBalance` and mints the mock USDC from one of Anvil's unlocked accounts, both on the build's pinned
`NEXT_PUBLIC_ENGINE_RPC_URL` (its `connect-src` only in that build), so the wallet signs nothing. `/notices` says what leaves the browser. A `live` build refuses a mock attestation, and the console's wrapper of the verifier does
not expose the mock entry point there (the served package still exports it); with no releases pinned yet
(`src/lib/engine/manifests.ts`), it trusts no hardware node either.

A hardware quote must show a pinned release's launch digest, guest policy and minimum TCB. With a wallet connected, the
attested launch digest and config hash must also hash to the vault's `currentRelease()`, and the attested enclave must be the
vault's `checkpointSigner()`; until then the node may be read and nothing is signed for it. A connected wallet's reads name the
operator's registered hostname, and the console moves to it, when the build lists it, once that node passes the whole check and
answers a signed read, without a rebuild. Rotation among listed candidates needs no release; a newly approved candidate needs one,
and while rotation is on a console that does not list the elected operator stays out and says it needs updating. A code upgrade
needs a console release first, which pins the new release.

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
