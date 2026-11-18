# Monkey Trading console

The web app for trading on [Monkey Trading](https://github.com/monkey-trading/engine): a trading
terminal in the browser that verifies the trading server's attestation, and the signature on each
of the server's answers, before it shows them.

Monkey Trading is a platform for trading contracts for difference against a house, whose rules are
the public code of the engine. The console is its client. You can watch markets, place and manage
orders, fund the account and withdraw from it, claim and stake MONKEY, and inspect the house's
solvency. The console has the following pages:

| Page | What it shows |
| --- | --- |
| Trade | The watchlist, a candlestick chart, the deal ticket, and your positions, working orders, history and profit and loss ledger |
| Funding | Deposits, withdrawals and the withdrawal queue |
| MONKEY | The MONKEY you have earned and claimed, and the latest activity |
| Staking | Staking, delegation to operator candidates, USDC distributions, the operators and their rotation, and governance votes |
| Dashboard | Charts of the house's net asset value, exposure and withdrawal queue, MONKEY emissions and supply, and distributions |
| House | The house's net asset value, cash and exposure against its limits, the withdrawal queue, and the signed checkpoints these figures rest on |
| Settings | Trading preferences, and the browsers authorised to trade for your account |

## Status

The console has not been released, and nothing it connects to holds real funds.

| Part | State |
| --- | --- |
| Simulated trading server | The default build, which runs entirely in the browser |
| Live trading server | Runs against a local development server, and against a local chain with wallets |
| Hardware attestation | No engine release is pinned yet, so a `live` build trusts no trading server |
| Hosting | Built to deploy to Vercel at console.monkey.trading |

## How it works

### Two modes

By default, the console runs against a simulated trading server inside the browser. Prices,
executions and funds are all simulated, and the console says so on screen. The console opens on a
demo account with positions, working orders, history and a withdrawal in the queue. The Demo
controls button in the top bar changes the simulated server: the region it sees you in, its
attestation, price shocks that trigger a close-out, market halts, stress levels, the vault's
liquidity, and an operator notice.

A build configured for a live trading server talks to that server instead. The engine's code and
logs call the trading server a node. The console reads the server's REST API, and follows its
WebSocket stream from the live end of the log. When the stream
stops, the console marks the prices as stale and disables order entry until the stream resumes.

### What the console verifies

The trading server runs inside an enclave, a virtual machine whose memory the host machine can
neither read nor alter. The enclave's processor signs an attestation, a report that identifies the
exact code the enclave runs and the key it signs with. Before the console trusts a server, it
checks the attestation:

- The report must show the launch digest, the guest policy and at least the minimum TCB version,
  which is the processor's firmware level, of an engine release that this build of the console
  pins in `src/lib/engine/manifests.ts`.
- With a wallet connected, the attested launch digest and config hash must also hash to the vault's
  `currentRelease()`, and the attested enclave must be the vault's `checkpointSigner()`. Until both
  checks pass, the console reads the server but signs nothing for it.

From then on, the console shows an answer only if the attested enclave signed it for that request,
and shows a stream message only if it carries the enclave's signature. The checks run in the
engine's own verifier, compiled to WebAssembly, which is checked in under `public/engine-verify/`
and pinned by SHA-256 in `src/lib/engine/wasm-pin.json`. `npm run build` refuses a package whose
hashes do not match.

A development server simulates its enclave, and its attestation proves nothing. A `live` build
refuses such an attestation. A `live-dev` build accepts one only from the servers that its build
names, and shows a banner saying that the server cannot be verified and is suitable for testing
only.

### Signing

You connect a browser wallet, or a wallet app through WalletConnect. Deposits, withdrawals and
MONKEY claims are always signed by the wallet. Orders, cancellations, Cancel all and Close all are
signed by a session key: a key held in this browser that places orders without a wallet prompt.
The wallet authorises the session key with one signature. An account that has already declared its
eligibility gives that signature right after it connects, and a new account gives it in the setup
dialog. A session key can trade for at most 24 hours, can never move funds, and is kept in the
browser's storage until it expires or you disconnect.

Orders are sent at the executable price that the server streams for your account, with your
maximum slippage. Every request that acts for your account carries an EIP-712 signature over the
chain id and the vault's address that the build names.

### Following the operator

The operator who runs the trading server can change, either by an election or by the daily
rotation of operators. When a connected wallet's reads name a new operator's registered address,
the console moves to that server without a rebuild. It moves only to an address that the build
lists, and only once that server has passed every check above. A console that does not list the
operator in effect stays where it is, and says that it needs updating. A change of the engine's code needs a new console
release, which pins the new engine release.

### What leaves the browser

The console has no backend of its own. Its Content Security Policy allows connections only to the
trading server the build names and to each listed candidate, over `https:` and `wss:`. A build with
a WalletConnect project id also allows WalletConnect's relay and its verification frame. Chain
reads go through your wallet, never through an RPC endpoint of the console's own. The one exception
is a development build's faucet, which funds a local Anvil wallet through the RPC address that the
build names. The console stores your wallet connection, session key, trading preferences and latest
exit proof in the browser. The `/notices` page lists everything that leaves the browser or is
stored in it.

### Restricted regions

A request from a restricted country is answered with the static `/restricted` page, which says
that the console is not available in the visitor's region. The country comes from the header that
the hosting edge sets from the visitor's IP address, `x-vercel-ip-country` on Vercel. A request
with no country is served normally. The list of countries is `RESTRICTED_COUNTRIES` in
[`src/lib/geo-block.ts`](src/lib/geo-block.ts), which names the United States and its territories.
Because the block follows the IP address, a VPN or proxy bypasses it. The engine requires each
account to sign an eligibility declaration before it credits a deposit or accepts an order.

Search engines are asked not to index the console. Every page carries a `noindex` robots tag and an
`X-Robots-Tag: noindex, nofollow` header, and `robots.txt` disallows every path.

## Getting it

You need Node.js 24, the version in [`.nvmrc`](.nvmrc), and npm. Running against a trading server
also needs the [engine repository](https://github.com/monkey-trading/engine) and what it requires,
which [the local stack](docs/local-stack.md#requirements) lists.

```shell
git clone https://github.com/monkey-trading/console.git
cd console
npm ci
```

## What you get

| Command | Purpose |
| --- | --- |
| `npm run dev` | The console against the simulated trading server |
| `npm run dev:live` | The console against an engine development server at `https://127.0.0.1:8080` |
| `npm run build`, `npm start` | The production build, and a server for it |
| `scripts/dev-local-stack.sh` | A local chain, the vault, one or more trading servers and the console, for trading with a wallet |
| `scripts/dev-local-stack-ctl.sh` | Drives the local stack's elections, handovers, votes and operator rotation |
| `scripts/dev-live-client.sh` | Checks that the console's live client refuses tampered, replayed and missing answers |
| `scripts/dev-trading.sh` | Trades against a private development server through the console's own code |

## Running it

### With the simulated trading server

To try the console without anything else running, run:

```shell
npm run dev
```

The development server prints `✓ Ready` and serves the console at `http://localhost:3000`. To use
another port, run `npm run dev -- --port 3001`. The console opens on the demo account, under a
banner saying that the console is a simulation running in your browser and that its prices, trades
and funds are not real.

### Against an engine development server

To see the console read a real trading server, start the engine's development server. In the
engine repository, run:

```shell
cargo run -p engine-node -- run --config config/dev.toml
```

The server simulates its enclave, custody and price feeds, and serves its API over TLS at
`https://127.0.0.1:8080` with a self-signed certificate. Open `https://127.0.0.1:8080/v1/health` in
your browser once and accept the certificate, so that the console can fetch from the server and open
its stream. Then, in this repository, run:

```shell
npm run dev:live
```

Open the console at `http://localhost:3000`, not at `127.0.0.1`, because the engine's development
config allows browser requests from that origin only. Markets and prices stream in, under a banner
saying that the server cannot be verified and is suitable for testing only. To view an account, add
`?account=<address>` to the page address. The account is then shown read-only, and nothing can be
signed for it.

`npm run dev:live` sets the build variables described under
[Building for a live trading server](#building-for-a-live-trading-server). To use other ports, set
those variables yourself, and change `node.listen`, `metrics.listen` and `api.allowed_origins` in a
copy of the engine's config to match. For a server on port 9080 and the console on port 3001, run:

```shell
NEXT_PUBLIC_ENGINE_MODE=live-dev NEXT_PUBLIC_ENGINE_ORIGIN=https://127.0.0.1:9080 \
  NEXT_PUBLIC_ENGINE_DEV_ORIGINS=https://127.0.0.1:9080 NEXT_PUBLIC_ENGINE_CHAIN_ID=31337 \
  NEXT_PUBLIC_ENGINE_VAULT=0x0000000000000000000000000000000000000000 npx next dev --port 3001
```

### On a local chain with a wallet

To deposit, trade, withdraw, claim and stake with a browser wallet, run the local stack. It needs
the engine repository beside this one, with its contracts' dependencies installed:

```shell
(cd ../engine/contracts && forge soldeer install)
./scripts/dev-local-stack.sh
```

The script starts an Anvil chain on port 8545 with the vault and a mock USDC token, a trading server
at `https://127.0.0.1:8080` that prices BTC-USD and ETH-USD from live crypto venues, and the console
at `http://localhost:3000`. It then prints the settings for adding the chain to a browser wallet and
the key of a funded development wallet. The first run builds the trading server with Cargo, which
takes several minutes. The stack is up when it prints `==> The local stack is up.` Press Ctrl-C to
stop everything it started. `ANVIL_PORT`, `API_PORT`, `CONSOLE_PORT`,
`METRICS_PORT` and `ACCESS_SOURCE_PORT` move its ports.

[The local stack](docs/local-stack.md) describes each step, and the options that run the launch
genesis, an election and handover between two engines, parameter votes, and operator rotation.

## Building for a live trading server

A build that talks to a trading server reads these variables when it is built, and fixes their
values in the bundle:

| Variable | Meaning |
| --- | --- |
| `NEXT_PUBLIC_ENGINE_MODE` | `mock` for the simulated server, which is the default; `live-dev` for a development server; or `live` |
| `NEXT_PUBLIC_ENGINE_ORIGIN` | The trading server's `https://` origin, with no path. The stream is on the same host over `wss:` |
| `NEXT_PUBLIC_ENGINE_CHAIN_ID`, `NEXT_PUBLIC_ENGINE_VAULT` | The chain and vault that every signature names |
| `NEXT_PUBLIC_ENGINE_USDC` | The USDC token the vault accepts. Without it, the build cannot deposit |
| `NEXT_PUBLIC_ENGINE_STAKING` | The staking contract. Without it, the Staking page cannot stake |
| `NEXT_PUBLIC_ENGINE_MONKEY` | The MONKEY token's address, which the MONKEY page shows. Optional |
| `NEXT_PUBLIC_ENGINE_REGISTRY` | The operator registry. Without it, the build does not follow a change of operator, and the Staking page lists no operators |
| `NEXT_PUBLIC_ENGINE_CANDIDATE_ORIGINS` | A comma-separated list of the `https://` origins of every approved operator candidate, which the build may move to |
| `NEXT_PUBLIC_ENGINE_HEARTBEAT_MS` | The server's `[api] heartbeat_interval`, in milliseconds. The default is 5000 |
| `NEXT_PUBLIC_ENGINE_RPC_URL` | An RPC address to offer a wallet that does not know the chain, such as a local Anvil chain. In a `live-dev` build, the faucet also uses it. Optional |
| `NEXT_PUBLIC_ENGINE_DEV_ORIGINS` | In a `live-dev` build, the comma-separated servers whose simulated attestation the build accepts |
| `NEXT_PUBLIC_ENGINE_DEV_LAUNCH_DIGESTS` | In a `live-dev` build, comma-separated 48-byte values that stand in for the launch digest a simulated attestation cannot measure, so that a local stack can run the vault's release check |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | A WalletConnect project id of 32 lowercase hexadecimal characters. Without it, the build does not offer WalletConnect |

## Verifying it

Two scripts check the console's live client against a real development server. Each needs Node.js,
`curl`, and `ENGINE_DIR`, the path of the engine repository. With `ENGINE_BIN` naming a built
`engine` binary, the scripts use it; otherwise they build one with Cargo.

```shell
ENGINE_DIR=../engine scripts/dev-live-client.sh
```

`dev-live-client.sh` starts a development server on port 8080 and its metrics on port 9464, or on
`LIVE_CLIENT_API_PORT` and `LIVE_CLIENT_METRICS_PORT` when set, and runs the live client against it
through a proxy that tampers with answers. It checks that the client's reads equal the server's,
and that the client refuses a changed byte, a replayed response, a dropped stream message, and a
simulated attestation in a production build. It ends with
`PASS: signed reads verify; tamper, replay, gap and mock-in-production are refused`.

```shell
ENGINE_DIR=../engine scripts/dev-trading.sh
```

`dev-trading.sh` also needs Python 3.11 or later and an internet connection, and, with
`ENGINE_BIN`, the engine's `access_source` example built beside the binary. It starts a private
development server on port 18080, and trades against it through the console's own code for about
twenty minutes. A wallet funds itself, declares its eligibility, executes a market order at the
streamed price, places and cancels a limit order, and closes positions. The script checks that the
preview of each partial close is a bound that its execution meets, and that the preview of each
whole close equals its execution. It also trades through a close-out after a restart with moved
prices. It ends with a line that begins `PASS: funded, declared, filled at the streamed
quote`. `TRADING_SCENARIO=tiers` runs the volume tier scenario instead, which takes a few minutes.

Neither script loads the browser build. To check how the page loads the verifier, and its Content
Security Policy, run `npm run dev:live`, or a production build with the same variables, against a
server.

## Deploying it

```shell
npm run build
npm start
```

`npm run build` prerenders every route, and `npm start` serves the build at
`http://localhost:3000`. The build reads two optional variables for the canonical address in the
page metadata:

- `SITE_URL`, a bare origin such as `https://console.monkey.trading`, takes precedence.
- `VERCEL_PROJECT_PRODUCTION_URL` is the bare host that Vercel sets for a connected project.
- With neither, the address is `http://localhost:3000`.

A build for a live trading server also needs the variables under
[Building for a live trading server](#building-for-a-live-trading-server), set in the hosting
provider's settings.

`next.config.ts` builds the rewrite for restricted regions from `RESTRICTED_COUNTRIES`.
`scripts/check-geo-block.sh` serves a production build on port 3217 and checks the rewrite. If a
host stops applying the rewrite, the same effect comes from a firewall rule in the host's
dashboard. The rule matches the request's country against the list and rewrites the path to
`/restricted`, leaving `/_next/`, `/restricted` and `/robots.txt` unmatched.

### Updating the verifier

`public/engine-verify/` holds the package that the engine's `scripts/build-wasm-verifier.sh`
writes: `engine_verify_bg.wasm`, its JavaScript glue and types, and `SHA256SUMS`. The package is
copied in unchanged, and `src/lib/engine/wasm-pin.json` records the engine commit it was built from
and the hashes of the `.wasm` file and its glue. To update it, build the package in the engine
repository, copy the files over the old ones, and update `wasm-pin.json` with the new commit and
hashes.

## Contributing

Pull requests against `main` are welcome. For a large change, please open an issue first.

Before you open a pull request, run the checks that CI runs:

```shell
npm run lint
npm run typecheck
npm test
npm run build
scripts/check-geo-block.sh
node scripts/check-audit.mjs
python3 scripts/check-docs.py
```

- `npm run lint` fails on any warning, and on a source file longer than 300 lines.
- `node scripts/check-audit.mjs` runs `npm audit` and fails on a high or critical advisory, except
  for the unexpired entries in `scripts/audit-exceptions.json`.
- The documentation check confirms that every relative link in `agents/` and in the root Markdown
  files resolves.
- After you change a workflow under `.github/workflows/`, also run `actionlint`.

Text that a trader reads in the console is written as a broker writes help text for its clients,
in complete, formal sentences that use the standard terms of trading.

Commit and pull request titles take the form `[<scopes>] Subject`, where the scopes are `app`,
`workspace` and `agents`, for example `[app] Show the closing spread cap on the deal ticket`. A pull
request merges once CI passes and a maintainer has approved it.

## Security

Please report vulnerabilities privately, by email to william.jevons@proton.me, and never in a
public issue.

## License

The console is licensed under the Apache License 2.0, in [`LICENSE`](LICENSE). Two parts it ships
are under their own licences:

- The Geist Mono font is under the SIL Open Font License, in
  [`src/app/fonts/OFL.txt`](src/app/fonts/OFL.txt).
- The WalletConnect connection uses Reown's WalletConnect SDK, unmodified, under the WalletConnect
  Community License Agreement, which is not an open-source licence. A copy is in
  [`public/walletconnect/LICENSE.txt`](public/walletconnect/LICENSE.txt), and `/notices` shows it.
