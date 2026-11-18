# The local stack

`scripts/dev-local-stack.sh` runs everything a browser wallet needs to trade through the console on
one machine: a local chain with the custody vault, one or more trading servers built from the
engine repository, and the console itself. This page describes the stack, what it prints, and the
options that add an operator election, parameter votes and operator rotation. Each option starts
from a fresh chain and a fresh log every time.

The local stack is for development only. Every key it uses is a public test key, and nothing it
runs holds real funds.

## Requirements

- Anvil, Forge and Cast, from Foundry 1.8.3.
- Rust 1.96 or later, with Cargo, as the engine requires.
- Node.js 24 and npm, with this repository's dependencies installed by `npm ci`.
- `curl`, `jq` and Python 3.11 or later.
- The engine repository, cloned beside this one or named by `ENGINE_DIR`, with its contracts'
  dependencies installed by `forge soldeer install` in its `contracts/` directory.
- An internet connection. The trading server checks the time against public Roughtime servers, and
  prices its crypto markets from the public feeds of Coinbase and Kraken.

## Starting the stack

```shell
npm ci
./scripts/dev-local-stack.sh
```

The script builds the trading server, then starts:

- an Anvil chain, chain id 31337, on port 8545, with a mock USDC token and the vault;
- the operator registry, which deploys the MONKEY staking contract as the launch deployment does,
  with operator rotation off;
- 5,000,000 mock USDC of house capital in the vault, and 100,000 mock USDC in a development wallet;
- a synthetic screening source on port 18846, which clears every account;
- a trading server on the chain's custody, with its API at `https://127.0.0.1:8080` and its metrics
  at `http://127.0.0.1:9464/metrics`, and, when mkcert's root exists, its API again at
  `https://127.0.0.1:8480` under a locally trusted certificate;
- the console's development server at `http://localhost:3000`, built against that trading server
  and the stack's MONKEY token and staking contract.

The trading server prices BTC-USD and ETH-USD from the live crypto venues. The other markets of the
development genesis have no price, because their sources are market-data vendors that need keys. The
server initialises MONKEY emissions and staking, and posts a checkpoint to the vault every 1,000
instructions, so that withdrawals and MONKEY claims can be paid on the chain.

The stack is up when the script prints `==> The local stack is up. Ctrl-C stops everything it
started.` followed by a summary. The summary gives the console's address, the settings that add the
Anvil network to a browser wallet, the development wallet's key, the mock USDC token's address, and
the markets that are priced. Press Ctrl-C to stop everything the script started.

Open the console at `http://localhost:3000`, not at `127.0.0.1`, because the trading server accepts
browser requests from that origin only.

### Ports and settings

Each port can be moved with the variable beside it, and each must be free.

| Variable | Default | What it sets |
| --- | --- | --- |
| `ANVIL_PORT` | 8545 | The Anvil chain's RPC port |
| `API_PORT` | 8080 | The trading server's API |
| `METRICS_PORT` | 9464 | The trading server's metrics |
| `CONSOLE_PORT` | 3000 | The console |
| `ACCESS_SOURCE_PORT` | 18846 | The synthetic screening source |
| `TRUSTED_API_PORT` | 8480 | The trading server's API behind a locally trusted certificate |

Other variables change what the stack runs:

- `ENGINE_DIR` names the engine repository. By default it is `engine` beside this repository.
- `CARGO_CMD` is a prefix for every Cargo command, such as a wrapper that limits concurrent builds.
- `DEV_WALLET` funds an address of your own with mock USDC and ether, in place of Anvil account 1.
- `CONSOLE_BUILD=production` serves a production build of the console with `next start`, in place
  of the development server.
- `KEEP_WORK=1` keeps the stack's private work directory, with its configs and logs, after it stops.

The script's header lists every variable, including the ports of the second and third engines that
the options below start.

### Trading on the stack

1. Add the Anvil network to your browser wallet, and import the development wallet's key, using the
   settings the summary prints. Add the mock USDC token as a custom token with 6 decimals.
2. Connect the wallet in the console. The setup dialog offers the Anvil faucet, which tops up the
   wallet's ether and mock USDC. It then asks you to sign the eligibility declaration, asks the
   wallet to authorise this browser to place orders, and offers a first deposit.
3. Trade. Later deposits are made on the Funding page. The trading server credits a deposit a few
   seconds after the chain mines it.

MONKEY is distributed every ten minutes among the traders who realised a loss in that period. Once
a losing trade has closed and its period has ended, you can claim the MONKEY on the MONKEY page and
stake it on the Staking page. The staking period closes every five minutes. When it closes with
stake while the house's net asset value is above the liquidity floor, the stakers are paid the
excess in USDC. The staking period, the unstake cooldown and the floor are development values, and
the summary prints them.

If any part of the stack exits, the script stops the rest and says which part exited.

## Locally trusted certificates

Each trading server serves a self-signed certificate, which a browser accepts only after you
confirm it by hand. With several engines, the console moves to an engine whose certificate the
browser has not yet accepted at each change of operator.

To avoid this, install mkcert's local certificate authority once. The installation asks once for
your keychain password.

```shell
brew install mkcert && mkcert -install
```

When mkcert's root exists, the stack issues a certificate for `127.0.0.1` and `localhost`. It then
serves each engine's API again through a local proxy, `scripts/dev-tls-proxy.mjs`, under that
certificate, on ports 8480, 8481 and 8482. The proxy forwards HTTP and WebSocket traffic unchanged
to the engine's own TLS listener, so the console still verifies the signature on every answer. The
candidates register the proxied addresses as their API hostnames, and the console's build names
them, so no certificate needs to be accepted by hand.

- `TRUSTED_CERTS=0` never uses the proxy.
- `TRUSTED_CERTS=1` stops the stack when mkcert's root is missing.
- Without either setting, the stack uses the proxy when the root exists. When the root is missing,
  the summary says how to install it.

The proxy is for development only. `scripts/check-tls-proxy.sh` checks it against a stand-in engine
with a throwaway root.

## The launch genesis

The genesis is the set of markets and trading rules that a trading server starts with. By default
the stack uses the development genesis in the engine's `config/dev.toml`, which lists a handful of
markets. To trade on the values the engine launches with instead, run:

```shell
GENESIS_FILE=config/production-genesis.toml ./scripts/dev-local-stack.sh
```

`GENESIS_FILE` takes any engine config file with a `[genesis]` table, as a path or relative to the
engine repository. The stack copies that table into the single config file it assembles, so the
server still loads one file and its attestation still covers that file's hash.

With the launch genesis, the trading server lists all 34 launch markets with their margin and
spread bands, the house's exposure limits per market and in total, the closing spread caps, and the
volume tiers with their limits and fee discounts. The house starts with no capital, so an opening
order meets the exposure limits as it would at launch. BTC-USD, ETH-USD and SOL-USD are priced from
the live crypto venues. The foreign exchange, index, commodity and share markets have no price,
because their sources are market-data vendors that need keys, and the summary lists them as
unpriced.

The stack refuses a genesis that lists `[genesis.staking]`, because it initialises staking itself.
A genesis with no crypto market starts, but none of its markets has a price.

### Launch deployment values

A file named `production-genesis.toml` also takes the launch deployment's values from the engine's
`ops/runbooks/production-deployment.toml`. `LAUNCH_VALUES=1` takes them with any genesis, and
`LAUNCH_VALUES=0` keeps the development values. With the launch values, the MONKEY period budget,
the vault's exit period, its claim window and its deposit staleness limit are as they will be at
launch.

The stack shortens the following values so that the stack can be watched, and the summary names
each one:

- the staking period and the unstake cooldown, to five minutes each;
- the liquidity floor, to 10,000 USDC, because the house starts empty;
- the timelock's delay, to one second;
- the start of emissions and staking, to the next minute.

`./scripts/dev-local-stack-ctl.sh status` names the genesis that the stack runs, and
`./scripts/dev-local-stack-ctl.sh fund-house` adds capital to the empty house, 100,000 mock USDC
unless you name another amount.
`./scripts/check-local-stack-genesis.sh` starts the stack on the launch genesis and checks that the
trading server lists the 34 markets with their launch exposure limits.

## Delegation, an election and a handover

The stack can run two engines, so that a staker's vote changes the operator and the console follows
the change:

```shell
SECOND_ENGINE=1 ./scripts/dev-local-stack.sh
```

The first engine runs under sealed keys with operator rotation on, as the operator in effect. The
second engine is registered as a candidate with an approved release. The stack starts the second
engine once an election has made the vault name its release, and the second engine then takes the
first engine's keys and log. The registry's election period is one minute.

A trading server with operator rotation on must post its log heads on the chain. The stack therefore deploys the
`LogHeads` contract from Anvil account 8 and funds a log-head relayer, Anvil account 10, apart from
the checkpoint relayer. Each engine posts its log head every ten seconds. Two wallets, Anvil
accounts 1 and 3, each hold 20,000 MONKEY and 100,000 mock USDC, and the summary prints their
public test keys.

In a second terminal, `scripts/dev-local-stack-ctl.sh` drives the rest:

1. On the Staking page, connect the first wallet, stake its MONKEY, and delegate an amount to
   `127.0.0.1:8081`, the second engine, with that row's Delegate button. Do the same from the
   second wallet. The operators table lists both candidates with their delegated stake and whether
   each is eligible. The trading server reads the table from the chain at a final block every five
   seconds. A delegation can be moved to another candidate, or partly withdrawn, from its row.
   Unstaking takes the undelegated stake first, and then each delegation in proportion.
2. Run `./scripts/dev-local-stack-ctl.sh elect` to close the election period. The candidate with
   the most delegated stake wins, provided that it is eligible, that at least 20% of all stake is
   delegated, and that it is not already the operator in effect. A candidate is eligible with 5% of
   all stake. The Staking page then shows the pending election.
3. Claim any withdrawal that you want paid, and then run
   `./scripts/dev-local-stack-ctl.sh handover`. The command moves the chain's clock past the
   election's seven-day notice, so the vault names the second engine's release. The stack starts the
   second engine, which takes the keys and the log, and the first engine exits. The console moves to
   the second engine by itself, with balances and positions intact, and trading continues there.
   Without mkcert's root, open `https://127.0.0.1:8081/v1/health` once and accept its certificate
   if the console does not move. A page loaded after the handover moves as soon as a wallet is
   connected.
4. Run `./scripts/dev-local-stack-ctl.sh fund-house 50000` to add 50,000 mock USDC to the house's
   capital. In this option the liquidity floor equals the house's starting capital, so the next
   staking period that closes with stake distributes the added amount. While operator rotation is
   on, a fifth goes to the operator in effect and the rest to stakers in proportion to their stake.
   Each wallet sees its share on the Staking page's Rewards tab and claims it there. The House page
   shows the same total as "USDC distributed" and "Distributed". `STAKING_EPOCH_SECS` shortens the
   five-minute staking period.

`./scripts/dev-local-stack-ctl.sh status` prints the election, the vault's release, both engines and
the chain's clock. The stack writes its addresses to `monkey-local-stack.json` in the temporary
directory, or to the path in `STACK_INFO_FILE`, and the control script reads them from there. With
two engines, the stack also checks that Anvil still answers, and stops with a message when it does
not, because the chain cannot be recovered.

### What a handover leaves behind

The election's notice can pass only on the chain's clock. Each engine's clock is signed time from
the internet, which a local stack cannot move. After `handover`, the chain is a week ahead of the
engines, with these consequences:

- Trading, quotes, session keys, positions, balances, deposits, staking, delegation, staking
  periods, distributions and their claims, checkpoints and exit proofs all work.
- Withdrawals do not pay until real time has caught up, a week later. The vault accepts a
  withdrawal authorisation for 24 hours of the chain's clock from the time the engine signed it,
  which the engine states on its own clock. Every authorisation has therefore expired by the time it
  reaches the vault, and the vault refuses the claim. Claim what you want paid before you run
  `handover`.
- The engine still shows the previous administrative key as the operator's, with the elected key
  pending. The engine applies a new key only after seven days of its own time, so it does not accept
  administrative instructions signed by the elected key.
- A stack performs one handover. To run another, stop the stack and start it again on a fresh
  chain.

## Parameter votes

While operator rotation is on, the engine's trading settings change only by a vote of the members
of the rotation set, weighted by the stake that the set adopted. The two-engine stack can run
these votes:

```shell
GOVERNANCE=1 SECOND_ENGINE=1 ./scripts/dev-local-stack.sh
```

The stack deploys the operator schedule and the vote contract, which the trading server follows. It
registers a third candidate, and registers a standby key for each candidate, vouched for by the
vault's signer, as the schedule requires of every member. The three candidates hold 40,000, 24,000
and 35,000 MONKEY of delegated stake. The stack then moves the chain's clock past the registry's
one-day period, which adopts the three candidates as the rotation set, and past the set's seven-day
notice, so the set is in effect.

To vote as a member, import the second engine's candidate, Anvil account 4, into a wallet. The
summary prints its public test key. That account delegates to itself and to the third candidate.

1. Propose a change as the first engine's candidate, which votes yes with its 40% of the stake:

   ```shell
   ./scripts/dev-local-stack-ctl.sh propose operator fast '{"action":"set_stress_floor","market":null,"level":1}'
   ```

   The command's last argument is the administrative instruction as JSON, in the form the engine
   serialises it. `fast` proposes a restriction that takes effect at once, and `normal` proposes a
   change that takes effect seven days after it passes.
2. The Governance tab of the Staking page lists the proposal, its tally against the two-thirds
   threshold, how the members that the account delegates to have voted, and a Vote yes button. A
   vote moves the tally once the trading server reads the next final block.
3. Run `./scripts/dev-local-stack-ctl.sh vote third 1` to add the third candidate's vote, which
   passes the proposal.

The engine applies a passed change only while a drawn turn is in effect, and this stack draws turns
only with `ROTATION=1`, described below. With `GOVERNANCE=1` alone, a passed proposal therefore
changes nothing. With `ROTATION=1`, a passed fast-path change takes effect at once as a restriction,
which lapses after three minutes, or after `RESTRICTION_TTL`. A normal change waits seven days of
the engine's clock, which a local stack cannot move.

As after a handover, the chain's clock is ahead of the engines' clocks, by eight days in this
option, so withdrawals do not pay. Once a schedule exists, closing a registry period adopts a
rotation set rather than electing an operator, so `elect` and `handover` do not apply. A proposal's
voting window runs on the chain's clock, while the Governance tab counts it down on the engine's
clock. The tab therefore shows about eight days more than remain, and the contract closes voting
while the tab is still counting.

## Operator rotation

While operator rotation is on, each turn of the operator schedule names one member of the rotation
set as the operator. At the turn's boundary, that member's engine takes the keys and the log from
the engine that held the previous turn. The stack can run an engine for every member, on a
development build of the engine whose turns last five minutes instead of a day, so that you can
watch the turns hand over:

```shell
ROTATION=1 ./scripts/dev-local-stack.sh
```

This option includes the two-engine option and the parameter votes, with the same three
candidates, wallets and vote contract. It builds the trading server with the engine's
`short-turns` feature, which a production build refuses, so the engine repository must include
that feature. The third engine's API, metrics and handover ports default to 8082, 9466 and 9445,
and `THIRD_API_PORT`, `THIRD_METRICS_PORT` and `THIRD_HANDOVER_PORT` move them.

Anvil starts nine days in the past. The registry's one-day period adopts the three candidates as
the rotation set, and the set's seven-day notice passes on the chain's clock, before any engine
starts. The stack then draws the turn in effect for the first engine, at `https://127.0.0.1:8080`,
and moves the chain to the present. From then on the chain runs on true time, so the chain and the
engines share one clock.

The first engine seals new keys, and the timelock installs its enclave as the vault's signer. The
second engine, at `https://127.0.0.1:8081`, and the third, at `https://127.0.0.1:8082`, start as
members and follow it. Each engine posts its checkpoints and log heads through relayers of its own,
and runs a liveness caller. Each engine also seals a standby key, which the stack registers for its
candidate once the vault's signer has vouched for it.

An engine accepts a turn only once its log has recorded the rotation set one turn earlier, so the
first handover comes within ten minutes of the stack coming up. The summary names the first turn
the stack draws and when it begins. From then on, the stack draws each turn at its draw deadline,
one turn before it begins. The stack relays each turn's random seed itself, in place of the seed
relay, and chooses seeds that give the turns to the second, third and first engines in order. At
each boundary:

1. The turn's member takes the keys and the end of the log from the engine that held the previous
   turn, and that engine goes back to following. The first engine, which started with new keys,
   exits once it has handed them over, and the stack starts it again as a member.
2. Within a minute, the console moves to the engine that holds the turn, with balances and
   positions intact, and trading continues there. Without mkcert's root, open that engine's
   `/v1/health` address and accept its certificate if the console does not move.
3. `./scripts/dev-local-stack-ctl.sh status` shows the turns around the present one and the engine
   each names, the operator in effect, the vault's signer, and whether each engine is serving,
   following or stopped.

### Stopping the operator

`./scripts/dev-local-stack-ctl.sh stop-operator` stops the engine of the operator in effect. The
other members record each heartbeat that it misses. After five missed heartbeats in a row, which
takes about three and a half minutes, they promote the next member's standby key to the vault's
signer. That member's engine serves the rest of the turn from its own copy of the log, and the
console moves to it. The command then has the stack start the stopped engine again as a member. At
the next boundary, the turn's member takes the keys from the promoted engine as from any other.

A promotion needs those 200 seconds and two more heartbeat slots. When less time than that remains
in the turn, and another member holds the next turn, the command says so and waits for the next
turn to begin, which takes at most five minutes. It then stops that turn's operator once its engine
is serving, so that a stop never lands on an engine that has not yet taken the keys. The command can
therefore be run at any point in a turn, and it always ends in a promotion.

Because the chain runs on true time in this option, withdrawals pay. While the turns rotate, the
engine authorises a withdrawal only once the next turn's member has checked the log up to the
withdrawal's approval. A withdrawal can therefore be claimed from the next boundary, which is at
most five minutes away.
