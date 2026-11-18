#!/usr/bin/env bash
# Runs a local trading stack for the console, from a fresh chain and a fresh node log each time:
#   1. Anvil (chain 31337) with the mock USDC and the vault at the addresses config/anvil.toml
#      names, the vault signed for by the node's published mock enclave key;
#   2. the operator registry, which deploys the MONKEY staking contract as the launch deployment
#      does, with operator rotation off; the house's capital deposited into the vault; and mock USDC
#      minted to a dev wallet;
#   3. an engine node on EVM custody that prices BTC-USD and ETH-USD from live crypto venues,
#      screens through the local synthetic access source, initialises MONKEY emissions and staking,
#      and posts checkpoints on-chain, so withdrawals are authorized and claimable on the vault;
#   4. the console in live-dev mode against that node.
# It prints what to add to the wallet, then runs until Ctrl-C, which stops everything it started.
#
# SECOND_ENGINE=1 adds what delegation, an election, a handover and distributions need, and
# `scripts/dev-local-stack-ctl.sh` drives it (see docs/local-stack.md): the first engine runs under sealed
# keys with operator rotation on, a second engine is registered as a candidate and starts once an
# election has put its release in the vault's hands, and two wallets hold MONKEY to stake.
# A rotating node posts its log heads on chain, so the nodes' configs name a deployed LogHeads
# contract and a log-head relayer (Anvil account 10).
#
# GOVERNANCE=1, with SECOND_ENGINE=1, sets up parameter votes as the engine's V56 has them: the operator
# schedule and the vote contract, a third candidate, a standby key for each candidate that the vault's
# signer vouches for (a close adopts no member without one), and the first engine's candidate, the second
# engine's (Anvil account 4) and the third (Anvil account 6) staking 40, 25 and 34 thousand MONKEY, the
# second delegating 1 thousand of its 25 to the third. The chain's clock moves past the registry's
# one-day epoch and the set's seven-day notice, so the three are the rotation set in effect, and the
# node mirrors each passed proposal, but the engine applies one only while a drawn turn is in effect, which
# only ROTATION=1 draws; `dev-local-stack-ctl.sh propose` and `vote` act as members. The
# chain's clock then runs eight days ahead of the engine's, so withdrawal authorizations do not pay,
# and with a schedule closes adopt rotation sets, so `elect` and `handover` do not apply.
#
# ROTATION=1 runs the parameter votes' rotation set with an engine for each member, on a node built with
# the engine's development-only `short-turns` feature, whose operator turns last five minutes. Anvil
# starts nine days in the past, so the registry's one-day epoch and the set's seven-day notice pass on the
# chain's clock before any engine starts, and the chain then runs on true time. The first engine seals new
# keys and the timelock installs its enclave, and it holds them until the first turn the stack draws, a turn
# after its log names the set; the second and third start as members, following it. Each member posts through relayers of its own
# (checkpoints: Anvil accounts 9, 11 and 13; log heads: 10, 12 and 14) and runs a liveness caller (15, 16
# and 17), and the stack sends each standby key registration a member's node writes, from its candidate.
# From the first turn the engines accept, a turn after the first engine's log names the set, the stack
# relays each turn's seed from the seed relay's aliased address, as the Arbitrum bridge delivers it,
# choosing seeds that give the turns to the members in order, and draws each turn at its draw deadline.
# At each boundary the turn's member takes the keys by itself; the first engine, which started with new
# keys, exits once it has handed them over, and the stack starts it again as a member.
# `dev-local-stack-ctl.sh status` shows the turns, and `stop-operator` stops the operator in effect so
# the other members promote the next one's standby key.
#
# GENESIS_FILE=config/production-genesis.toml runs the node on the launch genesis instead of the development one:
# every launch market with its margin and spread bands, house cap floors, volume tiers, order and request
# limits and fee discounts, and no house capital, so trades open against the cap floors as at launch. The stack
# takes the `[genesis]` table of any engine config file into the one `node.toml` it assembles (the node loads
# one config file, and its attestation covers that file's hash); the mock TEE, EVM custody, the access source,
# the ports and the venues stay the stack's own. The crypto markets price from the live venues; the markets
# whose production sources need vendor keys have no price here, and the summary names them. It also takes the
# launch deployment's values (the engine's ops/runbooks/production-deployment.toml) where the demo stays
# watchable, and the summary names each it shortens.
#
# TRUSTED CERTIFICATES: each engine serves a self-signed certificate, which a browser must accept by hand, and a
# rotation moves the console to an engine the browser has not accepted yet at each boundary. When mkcert's local
# root exists (`mkcert -CAROOT` holds rootCA.pem and its key; once, `brew install mkcert && mkcert -install`), the
# stack issues a certificate for 127.0.0.1 and localhost and starts `scripts/dev-tls-proxy.mjs`, which serves each
# engine's API again on a port of its own under that certificate, forwarding HTTP and WebSocket traffic to the
# engine's own TLS listener. The proxied origins are the candidates' registered API hostnames and the console's
# origins; the engines, their attestation and their signed answers are unchanged, so the console verifies every
# answer as before. Without mkcert's root the stack runs as above, and its summary says how to enable this.
#
# Needs anvil, forge, cast, cargo, node, npm, curl, jq and python3 (3.11 or later); the engine
# checkout with its contract dependencies (`forge soldeer install` in its contracts/); the
# console's node_modules (`npm ci`); and the internet, for the node's Roughtime servers and venues.
#
# Environment:
#   ENGINE_DIR       the engine checkout (default: `engine` beside the console's main checkout); GOVERNANCE=1 and
#                    ROTATION=1 need one with monkey-trading/engine#850's turn length and `short-turns` feature
#   CARGO_CMD        a prefix for every Cargo command, such as a build-slot wrapper (default: none)
#   ANVIL_PORT, API_PORT, CONSOLE_PORT, METRICS_PORT, ACCESS_SOURCE_PORT
#                    override 8545, 8080, 3000, 9464 and 18846; each must be free
#   DEV_WALLET       an address of your own to fund with mock USDC and ETH, instead of Anvil account 1
#   SECOND_ENGINE    `1` runs the two-engine option described above (default: off, one engine)
#   SECOND_API_PORT, SECOND_METRICS_PORT, HANDOVER_PORT, SECOND_HANDOVER_PORT
#                    with SECOND_ENGINE=1, override 8081, 9465, 9443 and 9444; each must be free
#   DEV_WALLET2      with SECOND_ENGINE=1, the second staking wallet, instead of Anvil account 3
#   GOVERNANCE       `1` adds the parameter votes described above (needs SECOND_ENGINE=1; default off)
#   ROTATION         `1` runs an engine for each rotation-set member, as described above (sets SECOND_ENGINE=1 and
#                    GOVERNANCE=1; default off)
#   THIRD_API_PORT, THIRD_METRICS_PORT, THIRD_HANDOVER_PORT
#                    with ROTATION=1, override 8082, 9466 and 9445; each must be free
#   TRUSTED_CERTS    `auto` (default) serves the engines through locally trusted certificates when mkcert's root exists,
#                    `0` never does, `1` stops the stack when the root is missing
#   TRUSTED_API_PORT, SECOND_TRUSTED_API_PORT, THIRD_TRUSTED_API_PORT
#                    the proxied ports of the first, second and third engines' APIs, with a trusted certificate
#                    (default 8480, 8481 and 8482); each must be free
#   RESTRICTION_TTL  with GOVERNANCE=1, how long a fast-path restriction lasts (default 3m: a development
#                    value; the engine takes up to seven days)
#   GENESIS_FILE     an engine config file whose `[genesis]` table the node takes: a path, or one relative to the engine
#                    checkout (default config/dev.toml; config/production-genesis.toml is the launch genesis). A genesis
#                    that lists [genesis.staking] is refused: the stack initialises staking itself
#   LAUNCH_VALUES    `1` takes the launch deployment's values and an empty house with the genesis, `0` keeps the
#                    development ones (default: `1` for a file named production-genesis.toml, else `0`)
#   STAKING_EPOCH_SECS
#                    the MONKEY distribution epoch and unstake cooldown, in seconds (default 300)
#   CONSOLE_BUILD    `dev` (default) runs next dev; `production` runs npm run build, then next start
#   STACK_INFO_FILE  a path to write the stack's addresses and keys to as JSON while it is up (with
#                    SECOND_ENGINE=1 or LAUNCH_VALUES=1, default `monkey-local-stack.json` in the temporary
#                    directory, which `dev-local-stack-ctl.sh` reads)
#   KEEP_WORK=1      keep the private work directory (configs and logs) on exit
set -euo pipefail
# The config scripts import a module beside them; leave no bytecode in the checkout.
export PYTHONDONTWRITEBYTECODE=1

root="$(cd "$(dirname "$0")/.." && pwd)"
anvil_port="${ANVIL_PORT:-8545}"
api_port="${API_PORT:-8080}"
console_port="${CONSOLE_PORT:-3000}"
metrics_port="${METRICS_PORT:-9464}"
access_port="${ACCESS_SOURCE_PORT:-18846}"
console_build="${CONSOLE_BUILD:-dev}"
second_engine="${SECOND_ENGINE:-0}"
parameter_votes="${GOVERNANCE:-0}"
rotation="${ROTATION:-0}"
# Rotation runs the two-engine option's registry with the parameter votes' schedule and set.
if [[ "$rotation" == 1 ]]; then
  second_engine=1
  parameter_votes=1
fi
restriction_ttl="${RESTRICTION_TTL:-3m}"
second_api_port="${SECOND_API_PORT:-8081}"
second_metrics_port="${SECOND_METRICS_PORT:-9465}"
handover_port="${HANDOVER_PORT:-9443}"
second_handover_port="${SECOND_HANDOVER_PORT:-9444}"
third_api_port="${THIRD_API_PORT:-8082}"
third_metrics_port="${THIRD_METRICS_PORT:-9466}"
third_handover_port="${THIRD_HANDOVER_PORT:-9445}"
trusted_certs="${TRUSTED_CERTS:-auto}"
trusted_api_port="${TRUSTED_API_PORT:-8480}"
second_trusted_api_port="${SECOND_TRUSTED_API_PORT:-8481}"
third_trusted_api_port="${THIRD_TRUSTED_API_PORT:-8482}"
rpc="http://127.0.0.1:$anvil_port"
# The node serves its API over TLS with a key it generates at startup, so curl skips verification.
api="https://127.0.0.1:$api_port"
second_api="https://127.0.0.1:$second_api_port"
third_api="https://127.0.0.1:$third_api_port"
# What the browser and the registry use: the engines' own origins, or with trusted certificates the proxy's.
console_api="$api"
console_second_api="$second_api"
console_third_api="$third_api"
console_api_host="127.0.0.1:$api_port"
console_second_api_host="127.0.0.1:$second_api_port"
console_third_api_host="127.0.0.1:$third_api_port"
trusted=0
mkcert_root=""
proxy_pid=""
# The node allows this browser origin only.
console_url="http://localhost:$console_port"
metrics_url="http://127.0.0.1:$metrics_port/metrics"
# Whole USDC; the token has 6 decimals.
usdc_units=1000000
house_usdc=5000000
dev_usdc=100000
# With a launch genesis, the launch deployment's values (set below, once the engine checkout is found)
# replace the development ones that follow where the demo stays watchable.
launch="${LAUNCH_VALUES:-auto}"
# MONKEY staking, development values and not approved production parameters: a five-minute
# distribution epoch, an unstake cooldown of the same length (the staking contract refuses one
# shorter than its epoch), and a liquidity floor 100000 USDC under the house's capital, so the first
# epoch that closes with a stake pays the stakers that excess. With SECOND_ENGINE=1 the floor is the
# house's capital instead, so only what `dev-local-stack-ctl.sh fund-house` adds, or clients lose,
# is paid, and the candidates' self-bonds do not take the first epoch's excess before a wallet stakes.
staking_epoch_secs="${STAKING_EPOCH_SECS:-300}"
staking_cooldown_secs="$staking_epoch_secs"
staking_floor_usdc=4900000
# The launch genesis's house starts empty, so a launch-size floor (30,500,000 USDC) would never open: the demo's is
# 10,000, which `dev-local-stack-ctl.sh fund-house` or clients' losses pass.
staking_floor_launch_usdc=10000
if [[ "$second_engine" == 1 ]]; then staking_floor_usdc=$house_usdc; fi
# The vault's timings and the MONKEY period budget: development values, replaced by the launch ones in
# launch mode. The exit period, claim window and deposit staleness are thirty days each, past anything this
# waits for, and past the timelock's one-second delay as the vault's constructor requires.
# The MONKEY period budget is 190,258 MONKEY, which caps the supply at about 10 billion (twice 26,280 periods of it).
monkey_period_budget=190258000000000000000000
vault_exit_period=2592000
vault_claim_window=2592000
vault_stale_after=2592000
# The two-engine option's registry, in development values within the bounds given at its deployment: an
# election epoch of a minute, a one-minute finality margin, a 1 MONKEY self-bond (a
# larger one would take a share of every distribution), and the seven-day notice the contract fixes.
registry_epoch_secs=60
# A schedule needs an epoch of at least a day (`OperatorRegistry.MIN_SCHEDULED_EPOCH`).
if [[ "$parameter_votes" == 1 ]]; then registry_epoch_secs=86400; fi
# The vote contract's windows, development values within its 30-day bound: a day for a normal
# proposal and an hour for a fast-path one, on the chain's clock.
vote_normal_window=86400
vote_fast_window=3600
candidate_bond_monkey=1
# Each staking wallet's MONKEY, minted by the vault in place of emission claims; the token's cap,
# which follows the period budget, bounds the total. The election's thresholds are shares of the
# stake, not of the supply, so they need no scaling with the budget.
wallet_monkey=20000
# The releases' launch measurements: the mock TEE's stand-ins, which its sealing derives keys from.
first_digest_byte=5a
second_digest_byte=71
third_digest_byte=7c
# With ROTATION=1, a short-turns build's five-minute turns, which the seed receiver numbers the turns by
# (a day otherwise, as the engine's default build has them); the heartbeat rule and take window are the
# engine's short-turns scenario's, whose take window fits in a turn (see the schedule's deployment below).
turn_secs=86400
# How far in the past Anvil starts: past the registry's one-day epoch and the set's seven-day notice.
rotation_past_secs=$((9 * 86400))
if [[ "$rotation" == 1 ]]; then turn_secs=300; fi

work=""
step_log=""
anvil_pid=""
access_pid=""
node_pid=""
console_pid=""
info_written=""
second_pid=""
third_pid=""
driver_pid=""

step() { echo "==> $*"; }
die() {
  echo "FAIL: $*" >&2
  exit 1
}
alive() { kill -0 "$1" 2>/dev/null; }
# Whether anything accepts a connection on loopback port `$1`.
port_answers() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null || (exec 3<>"/dev/tcp/::1/$1") 2>/dev/null
}
# Runs `$2...` every half second until it succeeds, for up to `$1` seconds.
poll() {
  local deadline=$((SECONDS + $1))
  shift
  until "$@"; do
    ((SECONDS < deadline)) || return 1
    sleep 0.5
  done
}
cargo_run() {
  # shellcheck disable=SC2086 # CARGO_CMD is a command prefix, split into words on purpose.
  ${CARGO_CMD:-} cargo "$@"
}

# Sends TERM to process `$1`, then KILL if it is still running after `$2` seconds.
stop_pid() {
  local pid="$1" i
  kill -TERM "$pid" 2>/dev/null || return 0
  for ((i = 0; i < $2 * 5; i++)); do
    alive "$pid" || break
    sleep 0.2
  done
  kill -KILL "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
}

# The same for every process in group `$1`.
stop_group() {
  local pgid="$1" i
  # Before the child has made its group, it is a lone process.
  if ! kill -TERM -- "-$pgid" 2>/dev/null; then
    stop_pid "$pgid" 10
    return 0
  fi
  for ((i = 0; i < 50; i++)); do
    kill -0 -- "-$pgid" 2>/dev/null || break
    sleep 0.2
  done
  kill -KILL -- "-$pgid" 2>/dev/null || true
  wait "$pgid" 2>/dev/null || true
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ $status -ne 0 && $status -ne 130 && $status -ne 143 && -n "$step_log" && -f "$step_log" ]]; then
    echo "--- the last lines of $step_log ---" >&2
    tail -n 40 "$step_log" >&2
  fi
  echo "==> Stopping the local stack" >&2
  # Quietly: bash reports each child a signal stops.
  if [[ -n "$console_pid" ]]; then stop_group "$console_pid" 2>/dev/null; fi
  if [[ -n "$driver_pid" ]]; then stop_pid "$driver_pid" 5 2>/dev/null; fi
  if [[ -n "$proxy_pid" ]]; then stop_pid "$proxy_pid" 5 2>/dev/null; fi
  # The node drains on TERM; give it time to finish its log.
  if [[ -n "$third_pid" ]]; then stop_pid "$third_pid" 30 2>/dev/null; fi
  if [[ -n "$second_pid" ]]; then stop_pid "$second_pid" 30 2>/dev/null; fi
  if [[ -n "$node_pid" ]]; then stop_pid "$node_pid" 30 2>/dev/null; fi
  if [[ -n "$access_pid" ]]; then stop_pid "$access_pid" 5 2>/dev/null; fi
  if [[ -n "$anvil_pid" ]]; then stop_pid "$anvil_pid" 5 2>/dev/null; fi
  if [[ -n "$info_written" ]]; then rm -f "$STACK_INFO_FILE"; fi
  if [[ -n "$work" && "${KEEP_WORK:-0}" == 1 ]]; then
    echo "Kept the work directory: $work" >&2
  elif [[ -n "$work" ]]; then
    rm -rf "$work"
  fi
  exit "$status"
}

step "Check the tools, the checkouts and the ports"
missing=""
for tool in anvil forge cast cargo node npm curl jq python3; do
  command -v "$tool" >/dev/null 2>&1 || missing="$missing $tool"
done
[[ -z "$missing" ]] || die "missing tools:$missing (Foundry gives anvil, forge and cast; rustup gives cargo)"
python3 -c 'import sys; sys.exit(sys.version_info < (3, 11))' || die "python3 must be 3.11 or later (it reads TOML with tomllib)"
if [[ -n "${ENGINE_DIR:-}" ]]; then
  engine_dir="$ENGINE_DIR"
else
  # A worktree shares its main checkout's git directory, so this finds the engine beside that checkout.
  common="$(git -C "$root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" ||
    die "cannot find the console's main checkout; set ENGINE_DIR to the engine checkout"
  engine_dir="$(dirname "$(dirname "$common")")/engine"
fi
[[ -f "$engine_dir/config/anvil.toml" ]] || die "$engine_dir is not the engine checkout; set ENGINE_DIR to it"
engine_dir="$(cd "$engine_dir" && pwd)"
# The genesis: a path as given, or relative to the engine checkout. The launch genesis also takes the
# launch deployment's values.
genesis_file="${GENESIS_FILE:-$engine_dir/config/dev.toml}"
[[ -f "$genesis_file" ]] || genesis_file="$engine_dir/$genesis_file"
[[ -f "$genesis_file" ]] || die "GENESIS_FILE is not a file, here or under $engine_dir: ${GENESIS_FILE:-}"
genesis_file="$(cd "$(dirname "$genesis_file")" && pwd)/$(basename "$genesis_file")"
[[ "$launch" == auto || "$launch" == 0 || "$launch" == 1 ]] || die "LAUNCH_VALUES must be 0 or 1: $launch"
if [[ "$launch" == auto ]]; then
  launch=0
  if [[ "$(basename "$genesis_file")" == production-genesis.toml ]]; then launch=1; fi
fi
if [[ "$launch" == 1 ]]; then
  deployment="$engine_dir/ops/runbooks/production-deployment.toml"
  [[ -f "$deployment" ]] || die "$deployment is missing: the launch values need an engine checkout with the deployment inputs"
  # The launch genesis starts the house with nothing. The stack's own floor and the funding below follow.
  house_usdc=0
  staking_floor_usdc=$staking_floor_launch_usdc
fi
[[ -d "$engine_dir/contracts/dependencies" ]] ||
  die "the vault's dependencies are not installed: run \`forge soldeer install\` in $engine_dir/contracts, then run this again"
[[ -x "$root/node_modules/.bin/next" ]] || die "the console's dependencies are not installed: run \`npm ci\` in $root"
[[ "$console_build" == dev || "$console_build" == production ]] || die "CONSOLE_BUILD must be dev or production: $console_build"
[[ "$second_engine" == 0 || "$second_engine" == 1 ]] || die "SECOND_ENGINE must be 0 or 1: $second_engine"
[[ "$rotation" == 0 || "$rotation" == 1 ]] || die "ROTATION must be 0 or 1: $rotation"
[[ "$parameter_votes" == 0 || "$second_engine" == 1 ]] || die "GOVERNANCE=1 needs SECOND_ENGINE=1, whose rotation it votes under"
[[ "$parameter_votes" == 0 || "$parameter_votes" == 1 ]] || die "GOVERNANCE must be 0 or 1: $parameter_votes"
[[ "$trusted_certs" == auto || "$trusted_certs" == 0 || "$trusted_certs" == 1 ]] || die "TRUSTED_CERTS must be auto, 0 or 1: $trusted_certs"
# Trusted certificates need mkcert's root and its key, which only `mkcert -install` and a first run make: the stack never
# creates a root, and never installs one.
if [[ "$trusted_certs" != 0 ]]; then
  if command -v mkcert >/dev/null 2>&1 && mkcert_root="$(mkcert -CAROOT 2>/dev/null)" &&
    [[ -f "$mkcert_root/rootCA.pem" && -f "$mkcert_root/rootCA-key.pem" ]]; then
    trusted=1
    console_api="https://127.0.0.1:$trusted_api_port"
    console_second_api="https://127.0.0.1:$second_trusted_api_port"
    console_third_api="https://127.0.0.1:$third_trusted_api_port"
    console_api_host="127.0.0.1:$trusted_api_port"
    console_second_api_host="127.0.0.1:$second_trusted_api_port"
    console_third_api_host="127.0.0.1:$third_trusted_api_port"
  elif [[ "$trusted_certs" == 1 ]]; then
    die "TRUSTED_CERTS=1 needs mkcert and its root: run \`brew install mkcert && mkcert -install\` once"
  fi
fi
[[ "$restriction_ttl" =~ ^[1-9][0-9]*(s|m|h)$ ]] || die "RESTRICTION_TTL must be a whole number of seconds, minutes or hours, such as 3m: $restriction_ttl"
ports=("$anvil_port" "$api_port" "$console_port" "$metrics_port" "$access_port")
[[ "$second_engine" == 0 ]] || ports+=("$second_api_port" "$second_metrics_port" "$handover_port" "$second_handover_port")
[[ "$rotation" == 0 ]] || ports+=("$third_api_port" "$third_metrics_port" "$third_handover_port")
if [[ "$trusted" == 1 ]]; then
  ports+=("$trusted_api_port")
  [[ "$second_engine" == 0 ]] || ports+=("$second_trusted_api_port")
  [[ "$rotation" == 0 ]] || ports+=("$third_trusted_api_port")
fi
for port in "${ports[@]}"; do
  if ! [[ "$port" =~ ^[0-9]+$ ]] || ((port < 1 || port > 65535)); then die "not a port: $port"; fi
  if port_answers "$port"; then
    die "something already answers on port $port; stop it or choose another port (see the header)"
  fi
done
[[ "$(printf '%s\n' "${ports[@]}" | sort -u | wc -l | tr -d ' ')" == "${#ports[@]}" ]] ||
  die "ANVIL_PORT, API_PORT, CONSOLE_PORT, METRICS_PORT, ACCESS_SOURCE_PORT and, with SECOND_ENGINE=1 or ROTATION=1, the other engines' ports must differ"
[[ "$staking_epoch_secs" =~ ^[1-9][0-9]*$ ]] || die "STAKING_EPOCH_SECS must be a positive whole number of seconds: $staking_epoch_secs"
if [[ -n "${DEV_WALLET:-}" ]]; then
  [[ "$DEV_WALLET" =~ ^0x[0-9a-fA-F]{40}$ ]] || die "DEV_WALLET must be a 0x address: $DEV_WALLET"
fi
if [[ ( "$second_engine" == 1 || "$launch" == 1 ) && -z "${STACK_INFO_FILE:-}" ]]; then STACK_INFO_FILE="${TMPDIR:-/tmp}/monkey-local-stack.json"; fi
if [[ -n "${STACK_INFO_FILE:-}" ]]; then rm -f "$STACK_INFO_FILE"; fi

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
work="$(mktemp -d "${TMPDIR:-/tmp}/local-stack.XXXXXX")"

if [[ "$trusted" == 1 ]]; then
  step "Serve the engines' APIs under a certificate mkcert's root issues, from port $trusted_api_port"
  step_log="$work/proxy.log"
  # For 127.0.0.1 and localhost only, kept in the work directory with its key; the root itself is read, never changed.
  mkcert -cert-file "$work/proxy-cert.pem" -key-file "$work/proxy-key.pem" 127.0.0.1 localhost >"$step_log" 2>&1 ||
    die "mkcert did not issue a certificate"
  proxy_routes=("$trusted_api_port=$api_port")
  [[ "$second_engine" == 0 ]] || proxy_routes+=("$second_trusted_api_port=$second_api_port")
  [[ "$rotation" == 0 ]] || proxy_routes+=("$third_trusted_api_port=$third_api_port")
  node "$root/scripts/dev-tls-proxy.mjs" --cert "$work/proxy-cert.pem" --key "$work/proxy-key.pem" "${proxy_routes[@]}" \
    </dev/null >>"$step_log" 2>&1 &
  proxy_pid=$!
  for route in "${proxy_routes[@]}"; do
    poll 20 port_answers "${route%%=*}" || die "the TLS proxy did not start on port ${route%%=*}"
  done
fi

# Built first, so a slow build cannot leave the chain's head stale by the time the node starts.
step "Build the node and the local access source"
build_features=()
# Five-minute turns: a development-only feature, which a production build refuses.
if [[ "$rotation" == 1 ]]; then build_features=(--features short-turns); fi
cargo_run build --locked -p engine-node --bin engine --example access_source ${build_features[@]+"${build_features[@]}"} \
  --manifest-path "$engine_dir/Cargo.toml"
# Wherever Cargo put it: `CARGO_TARGET_DIR` or `build.target-dir` may move the target directory.
target="$(cargo_run metadata --format-version 1 --no-deps --manifest-path "$engine_dir/Cargo.toml" | jq -r .target_directory)"
engine="$target/debug/engine"
access_source="$target/debug/examples/access_source"
step_log="$work/forge-build.log"
(cd "$engine_dir/contracts" && nice -n 10 forge build) >"$step_log" 2>&1 || die "the contracts did not build"

# Anvil's default test mnemonic: account 0 deploys and signs the synthetic access source's
# screenings, 1 is the dev wallet, 2 funds the house, 8 deploys the registry lens (and, with SECOND_ENGINE=1,
# LogHeads), 9 relays checkpoints and, with SECOND_ENGINE=1, account 10 relays log heads. With ROTATION=1, 11
# and 12 relay the second engine's checkpoints and log heads, 13 and 14 the third's, and 15, 16 and 17 are
# the three engines' liveness callers.
mnemonic="test test test test test test test test test test test junk"
key() { cast wallet private-key --mnemonic "$mnemonic" --mnemonic-index "$1"; }
address() { cast wallet address --private-key "$1"; }
lower() { tr '[:upper:]' '[:lower:]' <<<"$1"; }
# `$2` bytes of the byte `$1`, as 0x-prefixed hex.
hex_bytes() { printf '0x%s' "$(printf "%0$(($2 * 2))d" 0 | sed "s/00/$1/g")"; }
deployer_key="$(key 0)"
house_key="$(key 2)"
deployer="$(address "$deployer_key")"
house="$(address "$house_key")"
relayer="$(address "$(key 9)")"
if [[ -n "${DEV_WALLET:-}" ]]; then
  dev_wallet="$DEV_WALLET"
  dev_wallet_key=""
else
  dev_wallet_key="$(key 1)"
  dev_wallet="$(address "$dev_wallet_key")"
fi
# The two-engine option's actors. The first engine's operator key is the dev config's published
# test key (32 bytes of 0x42), and the key the election names is another (0x63...), both public.
# Account 3 is the second staking wallet, 4 the second engine's candidate, and 7 sends the calls
# anyone may send (closing an election epoch, folding a release change into the vault).
if [[ "$second_engine" == 1 ]]; then
  operator_key="$(hex_bytes 42 32)"
  second_admin_key="$(hex_bytes 63 32)"
  operator="$(address "$operator_key")"
  second_candidate_key="$(key 4)"
  second_candidate="$(address "$second_candidate_key")"
  payer_key="$(key 7)"
  if [[ -n "${DEV_WALLET2:-}" ]]; then
    [[ "$DEV_WALLET2" =~ ^0x[0-9a-fA-F]{40}$ ]] || die "DEV_WALLET2 must be a 0x address: $DEV_WALLET2"
    dev_wallet2="$DEV_WALLET2"
    dev_wallet2_key=""
  else
    dev_wallet2_key="$(key 3)"
    dev_wallet2="$(address "$dev_wallet2_key")"
  fi
  first_digest="$(hex_bytes "$first_digest_byte" 48)"
  second_digest="$(hex_bytes "$second_digest_byte" 48)"
  third_digest="$(hex_bytes "$third_digest_byte" 48)"
fi
# The node's published mock enclave key (tee.use_published_mock_key): 32 bytes of 0x43. The vault
# checks checkpoints and withdrawal authorizations against it.
enclave="$(address 0x4343434343434343434343434343434343434343434343434343434343434343)"

# The deployer's third transaction deploys the operator registry, and the registry's first creation
# is the staking contract it owns, so the node's config can name both before they exist; the deploy
# step checks them.
registry="$(cast compute-address "$deployer" --nonce 2 | awk '{print $NF}')"
staking="$(cast compute-address "$registry" --nonce 1 | awk '{print $NF}')"
# The registry lens the node reads GET /v1/operators through: account 8's first transaction.
lens_key="$(key 8)"
lens="$(cast compute-address "$(address "$lens_key")" --nonce 0 | awk '{print $NF}')"
# With SECOND_ENGINE=1 the nodes rotate, and a rotating node posts its log heads on chain through
# its own relayer, apart from the checkpoint relayer: LogHeads is account 8's second transaction, and
# the relayer is Anvil's eleventh account (`--accounts 11`).
logheads=""
heads_relayer=""
anvil_accounts=10
if [[ "$second_engine" == 1 ]]; then
  logheads="$(cast compute-address "$(address "$lens_key")" --nonce 1 | awk '{print $NF}')"
  heads_relayer="$(address "$(key 10)")"
  anvil_accounts=11
fi
if [[ "$rotation" == 1 ]]; then anvil_accounts=18; fi
# With GOVERNANCE=1, Anvil account 5 deploys the seed receiver the schedule is built over (no turn is
# drawn without ROTATION=1, so no seed is relayed), the schedule and the vote contract, at its first three
# nonces, and account 6 is the third candidate.
seed_receiver=""
schedule=""
vote=""
if [[ "$parameter_votes" == 1 ]]; then
  vote_deployer_key="$(key 5)"
  vote_deployer="$(address "$vote_deployer_key")"
  seed_receiver="$(cast compute-address "$vote_deployer" --nonce 0 | awk '{print $NF}')"
  schedule="$(cast compute-address "$vote_deployer" --nonce 1 | awk '{print $NF}')"
  vote="$(cast compute-address "$vote_deployer" --nonce 2 | awk '{print $NF}')"
  third_candidate_key="$(key 6)"
  third_candidate="$(address "$third_candidate_key")"
fi

step "Write the node config"
step_log="$work/config.log"
# dev.toml with EVM custody, as config/anvil.toml has it, against Anvil itself: the three
# providers must have distinct URLs, and Anvil ignores the query that sets them apart.
STACK_SCRIPTS="$root/scripts" python3 - "$engine_dir/config" "$work" "$rpc" "$api_port" "$metrics_port" "$console_port" "$access_port" \
  "$relayer" "$deployer" "$registry" "$staking" "$lens" "$schedule" "$vote" "$restriction_ttl" "$logheads" "$heads_relayer" \
  "$genesis_file" "$launch" "${deployment:-}" >"$work/config-values" 2>"$step_log" <<'PY' || die "could not write the node config"
import json
import os
import re
import sys
import tomllib
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, os.environ["STACK_SCRIPTS"])
from stack_toml import dumps  # noqa: E402

config, work, rpc, api, metrics, console, access, relayer, source, registry, staking, lens, schedule, vote, ttl, logheads, heads_relayer, genesis_file, launch, deployment = sys.argv[1:]
cfg = tomllib.loads(Path(config, "dev.toml").read_text())
anvil = tomllib.loads(Path(config, "anvil.toml").read_text())

# Live venues sequence between 30 and 100 price commands a second, and one checkpoint lands on the
# chain about every second: a checkpoint every 100 commands outruns that, the vault falls minutes
# behind the log, and neither a withdrawal's authorization nor a MONKEY claim's proof is ever
# covered. Every 1000 commands keeps the vault within seconds of the log.
cfg["node"].update(listen=f"127.0.0.1:{api}", log_dir=f"{work}/log", auth="eip712", checkpoint_every=1000)
cfg["api"]["allowed_origins"] = [f"http://localhost:{console}"]
# One operator's browser with the first-party console is the whole user base here:
# raise the per-IP and per-account buckets far above the production defaults so a
# connected wallet's read loop is never throttled on localhost.
cfg["api"]["per_ip"] = {"per_second": 500, "burst": 1000}
cfg["api"]["per_account"] = {"per_second": 120, "burst": 240}
cfg["history"]["dir"] = f"{work}/history"
cfg["metrics"]["listen"] = f"127.0.0.1:{metrics}"
cfg["alerts"]["outbox"]["dir"] = f"{work}/alerts"
cfg["alerts"]["critical"] = {"url_env": "ENGINE_ALERTS_CRITICAL_URL"}
cfg["custody"] = anvil["custody"]
evm = cfg["custody"]["evm"]
evm["providers"] = [{"name": f"local-{name}", "rpc_url": f"{rpc}/?provider={name}"} for name in "abc"]
evm["cursor_path"] = f"{work}/custody-cursor.json"
# The staking contract the operator registry deployed, which the node mirrors into the engine once
# staking is initialised, with the registry that deployed it.
evm["staking"] = {"contract": staking, "cursor_path": f"{work}/staking-cursor.json", "registry": {"contract": registry, "lens": lens}}
# With GOVERNANCE=1, the schedule whose rotation sets vote and the vote contract whose passed
# proposals the node mirrors, with the fast-path restriction lifetime the log records once.
if vote:
    evm["staking"]["registry"].update(schedule=schedule, vote={"contract": vote, "restriction_ttl": ttl})
# The Staking page's operator table follows the chain within seconds of a block becoming final.
cfg["api"]["operators_interval"] = "5s"
# The genesis is the chosen file's `[genesis]` table, whole: the node loads this one file, and its
# attestation covers the file's hash. With EVM custody, house capital comes from vault deposits to the
# house, so the config credits none.
genesis = tomllib.loads(Path(genesis_file).read_text()).get("genesis")
assert genesis and genesis.get("markets"), f"{genesis_file} has no [genesis] table with markets"
# The stack initialises staking itself, against the contracts it deploys: a second initialisation is refused.
if genesis.get("staking") is not None:
    sys.exit(f"{genesis_file} lists [genesis.staking]: remove it, as the stack initialises staking itself")
cfg["genesis"] = genesis
cfg["genesis"]["house_capital"] = "0"
# Live crypto venues price every crypto market the genesis lists, Coinbase and Kraken quoting each
# against USD; markets with no venue here stay unpriced (the others' vendors need keys the stack lacks).
cfg["feeds"]["mock_mids"] = []
crypto = [(m["id"], m["symbol"]) for m in genesis["markets"] if m.get("asset_class") == "crypto"]
if crypto:
    cfg["feeds"]["provider"] = "venues"
    for conn in cfg["feeds"]["venues"]["connections"]:
        slash = conn["venue"] == "kraken"
        conn["symbols"] = [{"market": i, "symbol": sym.replace("-", "/") if slash else sym} for i, sym in crypto]
else:
    # No venue quotes a market here: the mock feed with no mids quotes nothing, and the engine refuses a venue with no symbols.
    cfg["feeds"]["provider"] = "mock"
    del cfg["feeds"]["venues"]
cfg["checkpoints"] = {"rpc_url": rpc, "relayer": relayer, "retry_interval": "500ms", "rpc_timeout": "5s"}
# A rotating node's handovers check the log against the head posted on chain: the poster sends the
# newest released head every few seconds through its own relayer.
if logheads:
    cfg["log_heads"] = {"contract": logheads, "relayer": heads_relayer, "interval": "10s"}
cfg["access"] = {"source": source, "endpoint": f"http://127.0.0.1:{access}", "timeout": "2s", "max_age": "30s",
                 "max_response_bytes": 4096, "max_in_flight": 8}

Path(work, "node.toml").write_text(dumps(cfg))
# What the summary says of the genesis: its markets and the caps its floors give a house of nothing.
markets = genesis["markets"]
cap_floor = sum(Decimal(m.get("house_cap_floor", "0")) for m in markets)
Path(work, "genesis-summary").write_text(
    f"{len(markets)} markets, house cap floors summing to {cap_floor:,.0f} USD "
    f"(total floor {Decimal(genesis['params'].get('house_total_cap_floor', '0')):,.0f} USD), "
    f"{len(genesis.get('close_spread_ceilings', []))} close-spread ceilings, {len(crypto)} crypto markets on live venues\n")
# The launch deployment's values, for a launch genesis: the vault's constructor values (the node refuses
# an emissions budget or staking epoch other than the contracts hold) and the ones the stack shortens.
if launch == "1":
    d = tomllib.loads(Path(deployment).read_text())
    Path(work, "launch-values").write_text(" ".join(str(v) for v in (
        d["vault"]["period_budget"], d["vault"]["exit_period"], d["vault"]["claim_window"], d["vault"]["stale_after"],
        d["timelock"]["min_delay"], d["staking"]["epoch"], d["staking"]["cooldown"], d["init_staking"]["liquidity_floor"],
        d["start"])) + "\n")
heartbeat = re.fullmatch(r"(\d+)(ms|s)", cfg["api"]["heartbeat_interval"])
assert heartbeat, "api.heartbeat_interval is not whole seconds or milliseconds"
ms = int(heartbeat[1]) * (1 if heartbeat[2] == "ms" else 1000)
venues = sorted({s["market"] for c in cfg["feeds"].get("venues", {}).get("connections", []) for s in c["symbols"]})
print(cfg["custody"]["vault"].lower(), evm["usdc"].lower(), ms, json.dumps(venues, separators=(",", ":")))
PY
read -r vault usdc heartbeat_ms venue_markets <"$work/config-values"
genesis_summary="$(<"$work/genesis-summary")"
if [[ "$launch" == 1 ]]; then
  read -r monkey_period_budget vault_exit_period vault_claim_window vault_stale_after launch_timelock_delay launch_epoch \
    launch_cooldown launch_floor launch_start <"$work/launch-values"
fi

if [[ "$second_engine" == 1 ]]; then
  step "Write the engines' configs"
  step_log="$work/engines.log"
  # The registry names each engine's release by its config's hash, so the configs are final here.
  admin_of() { printf '0x04%s' "$(cast wallet public-key --private-key "$1" | sed 's/^0x//')"; }
  # The engines as stack_engines.py takes them (see its usage).
  spec="$(jq -n --argjson h1 "$handover_port" --argjson api2 "$second_api_port" --argjson metrics2 "$second_metrics_port" \
    --argjson h2 "$second_handover_port" --arg admin2 "$(admin_of "$second_admin_key")" \
    '{first: {handover: $h1}, others: [{name: "second", api: $api2, metrics: $metrics2, handover: $h2, admin: $admin2}]}')"
  if [[ "$rotation" == 1 ]]; then
    # The third candidate's engine, and every member posting through relayers of its own and running a
    # liveness caller from its own account.
    account() { address "$(key "$1")"; }
    spec="$(jq --argjson api3 "$third_api_port" --argjson metrics3 "$third_metrics_port" --argjson h3 "$third_handover_port" \
      --arg admin3 "$(admin_of "$third_candidate_key")" \
      --arg c1 "$(account 9)" --arg l1 "$(account 10)" --arg v1 "$(account 15)" \
      --arg c2 "$(account 11)" --arg l2 "$(account 12)" --arg v2 "$(account 16)" \
      --arg c3 "$(account 13)" --arg l3 "$(account 14)" --arg v3 "$(account 17)" \
      '.others += [{name: "third", api: $api3, metrics: $metrics3, handover: $h3, admin: $admin3}]
        | .first += {checkpoints: $c1, heads: $l1, caller: $v1}
        | .others[0] += {checkpoints: $c2, heads: $l2, caller: $v2}
        | .others[1] += {checkpoints: $c3, heads: $l3, caller: $v3}' <<<"$spec")"
  fi
  hashes="$(python3 "$root/scripts/stack_engines.py" "$work" "$spec" 2>"$step_log")" || die "could not write the engines' configs"
  read -r first_config_hash second_config_hash third_config_hash <<<"$hashes"
fi

step "Start Anvil on $rpc"
step_log="$work/anvil.log"
# A block every second and one for each transaction, so wallet transactions and checkpoints land at
# once while deposits keep confirming; with one slot per epoch, the safe and finalized blocks trail
# the head by one and two. With ROTATION=1 the chain starts in the past, so the registry's epoch and the
# set's notice can pass on its clock before the engines start; it then catches up with true time.
anvil_start=()
if [[ "$rotation" == 1 ]]; then anvil_start=(--timestamp "$(($(date +%s) - rotation_past_secs))"); fi
nice -n 10 anvil --host 127.0.0.1 --port "$anvil_port" --chain-id 31337 --block-time 1 --mixed-mining \
  --slots-in-an-epoch 1 --accounts "$anvil_accounts" ${anvil_start[@]+"${anvil_start[@]}"} --silent >"$step_log" 2>&1 &
anvil_pid=$!
rpc_up() {
  alive "$anvil_pid" || die "Anvil exited"
  cast chain-id --rpc-url "$rpc" >/dev/null 2>&1
}
poll 30 rpc_up || die "Anvil did not answer on $rpc"

step "Deploy the mock USDC, a governance timelock and the vault"
step_log="$work/deploy.log"
# `--constructor-args` takes every argument after it, so the contract and its arguments go last.
create() {
  (cd "$engine_dir/contracts" && nice -n 10 forge create --rpc-url "$rpc" --broadcast --json "$@" 2>>"$step_log") |
    jq -r '.deployedTo'
}
deployed_usdc="$(create --private-key "$deployer_key" test/mocks/MockUSDC.sol:MockUSDC)"
# Another account deploys the timelock, so the token and vault land at account 0's nonces 0 and 1.
governance="$(create --private-key "$house_key" \
  dependencies/@openzeppelin-contracts-5.7.0/governance/TimelockController.sol:TimelockController \
  --constructor-args 1 "[$deployer]" '[0x0000000000000000000000000000000000000000]' \
  0x0000000000000000000000000000000000000000)"
deployed_vault="$(create --private-key "$deployer_key" src/Vault.sol:Vault \
  --constructor-args "$deployed_usdc" "$enclave" "$governance" "$governance" "$monkey_period_budget" \
  "$vault_exit_period" "$vault_claim_window" "$vault_stale_after")"
[[ "$(lower "$deployed_usdc")" == "$usdc" ]] || die "the mock USDC deployed at $deployed_usdc, not at $usdc as config/anvil.toml names"
[[ "$(lower "$deployed_vault")" == "$vault" ]] || die "the vault deployed at $deployed_vault, not at $vault as config/anvil.toml names"
usdc="$deployed_usdc"
vault="$deployed_vault"
signer="$(cast call "$vault" 'checkpointSigner()(address)' --rpc-url "$rpc")"
[[ "$(lower "$signer")" == "$(lower "$enclave")" ]] || die "the vault's signer is $signer, not the mock enclave $enclave"
monkey="$(cast call "$vault" 'monkey()(address)' --rpc-url "$rpc")"

step "Deploy the operator registry, which deploys the MONKEY staking contract, and its lens"
# The deployer is the initial operator, and rotation is off at deployment: no election moves the
# operator key, which stays the dev config's (with SECOND_ENGINE=1, rotation goes on below). The election parameters are development values, as
# in the engine's election scenario, within the bounds given after them.
initial_operator="($deployer,$(hex_bytes d0 48),$(hex_bytes c0 32))"
mon=000000000000000000
# `OperatorRegistry.Parameters`: epoch, finality margin, eligibility and quorum shares, most candidates,
# least self-bond, liveness timeout.
parameters="(3600,600,500,2000,10,1000$mon,604800)"
minimums="(60,0,0,0,1,0,60)"
maximums="(2592000,86400,10000,10000,100,1000000$mon,2592000)"
if [[ "$second_engine" == 1 ]]; then
  # The first engine's own operator key and release are the operator in effect, so the vault's
  # release, which follows the registry once rotation is on, names what the first engine runs.
  initial_operator="($operator,$first_digest,$first_config_hash)"
  parameters="($registry_epoch_secs,60,500,2000,10,${candidate_bond_monkey}$mon,604800)"
fi
deployed_registry="$(create --private-key "$deployer_key" src/OperatorRegistry.sol:OperatorRegistry \
  --constructor-args "$monkey" "$staking_cooldown_secs" "$staking_epoch_secs" "$governance" \
  "$initial_operator" "$parameters" "$minimums" "$maximums")"
[[ "$(lower "$deployed_registry")" == "$(lower "$registry")" ]] || die "the registry deployed at $deployed_registry, not at $registry"
deployed_staking="$(cast call "$registry" 'staking()(address)' --rpc-url "$rpc")"
[[ "$(lower "$deployed_staking")" == "$(lower "$staking")" ]] || die "the registry deployed staking at $deployed_staking, not at $staking"
registry="$deployed_registry"
staking="$deployed_staking"
deployed_lens="$(create --private-key "$lens_key" src/RegistryLens.sol:RegistryLens --constructor-args "$registry")"
[[ "$(lower "$deployed_lens")" == "$(lower "$lens")" ]] || die "the registry lens deployed at $deployed_lens, not at $lens"
if [[ -n "$logheads" ]]; then
  deployed_logheads="$(create --private-key "$lens_key" src/LogHeads.sol:LogHeads --constructor-args "$vault")"
  [[ "$(lower "$deployed_logheads")" == "$(lower "$logheads")" ]] || die "LogHeads deployed at $deployed_logheads, not at $logheads"
fi

if ((house_usdc > 0)); then
  step "Fund the house with $house_usdc USDC in the vault, and the dev wallet with $dev_usdc USDC"
else
  step "Leave the house empty, and fund the dev wallet with $dev_usdc USDC"
fi
send() { nice -n 10 cast send "$@" --rpc-url "$rpc" >>"$step_log" 2>&1; }
if ((house_usdc > 0)); then
  send "$usdc" 'mint(address,uint256)' "$house" $((house_usdc * usdc_units)) --private-key "$deployer_key"
  send "$usdc" 'approve(address,uint256)' "$vault" $((house_usdc * usdc_units)) --private-key "$house_key"
  send "$vault" 'depositToHouse(uint256)' $((house_usdc * usdc_units)) --private-key "$house_key"
fi
send "$usdc" 'mint(address,uint256)' "$dev_wallet" $((dev_usdc * usdc_units)) --private-key "$deployer_key"
if [[ -n "${DEV_WALLET:-}" ]]; then
  # 100 ETH for gas.
  cast rpc anvil_setBalance "$dev_wallet" 0x56bc75e2d63100000 --rpc-url "$rpc" >>"$step_log" 2>&1
fi
# The node's custody startup reads the vault at the withdrawal finality tag, which trails the head.
vault_finalized() {
  local code
  code="$(cast code "$vault" --block finalized --rpc-url "$rpc" 2>/dev/null)" && [[ -n "$code" && "$code" != 0x ]]
}
poll 30 vault_finalized || die "the vault's deployment did not reach a finalized block"

if [[ "$second_engine" == 1 ]]; then
  step "Register the engines as candidates, turn rotation on and fund the staking wallets"
  step_log="$work/election-setup.log"
  mkdir -p "$work/second"
  if [[ "$rotation" == 1 ]]; then mkdir -p "$work/third"; fi
  # Sends from an account the node does not hold a key for, such as the operator's or a contract.
  send_as() {
    local from="$1" status=0
    shift
    cast rpc anvil_impersonateAccount "$from" --rpc-url "$rpc" >>"$step_log" 2>&1
    cast rpc anvil_setBalance "$from" 0x56bc75e2d63100000 --rpc-url "$rpc" >>"$step_log" 2>&1
    send "$@" --unlocked --from "$from" || status=$?
    cast rpc anvil_stopImpersonatingAccount "$from" --rpc-url "$rpc" >>"$step_log" 2>&1
    return "$status"
  }
  # Has the timelock call `$1` with `$2`: scheduled by the deployer, executed by anyone once its
  # one-second delay has passed in a mined block.
  govern_salt=0
  govern() {
    local target="$1" data="$2" none salt
    none="$(hex_bytes 00 32)"
    salt="$(printf '0x%064x' $((++govern_salt)))"
    send "$governance" 'schedule(address,uint256,bytes,bytes32,bytes32,uint256)' "$target" 0 "$data" "$none" "$salt" 1 \
      --private-key "$deployer_key"
    try_execute() { send "$governance" 'execute(address,uint256,bytes,bytes32,bytes32)' "$target" 0 "$data" "$none" "$salt" --private-key "$payer_key"; }
    poll 30 try_execute || die "the timelock did not execute a call to $target"
  }
  # Mints `$2` MONKEY base units to `$1` as the vault, the token's only minter, in place of a proven emission claim.
  mint_monkey() { send_as "$vault" "$monkey" 'mint(address,uint256)' "$1" "$2"; }
  # Registers `$1` as a candidate with admin key `$2` (which authorizes it), the release `$3` and `$4`
  # (launch measurement and config hash), and the API hostname `$5` and handover endpoint `$6`;
  # the timelock approves the release. The enclave address starts as the admin address, which the
  # candidate replaces once its enclave exists.
  register_candidate() {
    local candidate="$1" admin_key="$2" admin bond authorization signature
    admin="$(address "$admin_key")"
    bond="${candidate_bond_monkey}$mon"
    mint_monkey "$candidate" "$bond"
    send_as "$candidate" "$monkey" 'approve(address,uint256)' "$staking" "$bond"
    send_as "$candidate" "$staking" 'stake(uint256)' "$bond"
    authorization="$(cast call "$registry" 'registrationDigest(address,address)(bytes32)' "$candidate" "$admin" --rpc-url "$rpc")"
    signature="$(cast wallet sign --no-hash --private-key "$admin_key" "$authorization")"
    send_as "$candidate" "$registry" 'register((address,address,uint256,bytes,bytes32,string,string),bytes)' \
      "($admin,$admin,$bond,$3,$4,\"$5\",\"$6\")" "$signature"
    govern "$registry" "$(cast calldata 'setReleaseApproval(address,bytes,bytes32,bool)' "$candidate" "$3" "$4" true)"
  }
  govern "$registry" "$(cast calldata 'setVault(address)' "$vault")"
  govern "$vault" "$(cast calldata 'setRegistry(address)' "$registry")"
  register_candidate "$operator" "$operator_key" "$first_digest" "$first_config_hash" \
    "$console_api_host" "127.0.0.1:$handover_port"
  register_candidate "$second_candidate" "$second_admin_key" "$second_digest" "$second_config_hash" \
    "$console_second_api_host" "127.0.0.1:$second_handover_port"
  mint_monkey "$dev_wallet" "${wallet_monkey}$mon"
  mint_monkey "$dev_wallet2" "${wallet_monkey}$mon"
  if [[ -n "${DEV_WALLET2:-}" ]]; then
    cast rpc anvil_setBalance "$dev_wallet2" 0x56bc75e2d63100000 --rpc-url "$rpc" >>"$step_log" 2>&1
  fi
  send "$usdc" 'mint(address,uint256)' "$dev_wallet2" $((dev_usdc * usdc_units)) --private-key "$deployer_key"
  if [[ "$parameter_votes" == 1 ]]; then
    # The registry takes a schedule only while rotation is off, and the vote contract is built over it.
    # Without ROTATION=1 the third candidate's release is a stand-in no engine runs: it only ever votes.
    step_log="$work/votes-setup.log"
    # The receiver numbers turns by the build's turn length, which a node checks the schedule against.
    deployed_receiver="$(create --private-key "$vote_deployer_key" src/SeedReceiver.sol:SeedReceiver --constructor-args "$relayer" 1606824023 "$turn_secs")"
    # The schedule reads the rotating nodes' LogHeads for its heartbeat rule, which takes the engine's scenario values: 60 s slots,
    # 30 s tolerance, five misses and 200 blocks, within bounds of (30, 5, 2, 10) and (120, 60, 9, 256), and a take window of
    # 4 slots within (4, 8): its minimum must exceed the switch budget plus one interval plus a head's inclusion, which the
    # tolerance bounds, at the rule's shortest interval and longest tolerance. The switch budget is 5 s and Arbitrum's block
    # time 250 ms. The misses must exceed the take window's slots, and by enough that (misses - slots) intervals outlast the
    # switch budget plus the longer of the tolerance and a 15 s stop margin, so a skip's member has a take before the
    # untaken-turn promotion (the schedule's `_skipsFirst`, engine#848). Without ROTATION=1 no node runs a liveness caller, and
    # no turn is drawn, so neither the promotion nor the skip fires.
    liveness_rule="(60,30,5,200)"
    take_window="(4,4,8)"
    switch_budget=5
    if [[ "$rotation" == 1 ]]; then
      # With ROTATION=1, the engine's short-turns scenario's: 30 s slots, 20 s tolerance, five misses and 10 blocks, and a take
      # window of 4 slots within (4, 8) under a 5 s switch budget, since its maximum must also fit in a turn (8 x 30 s within
      # 300 s). Five misses against four slots leave (5 - 4) x 30 s = 30 s, past the budget plus the 20 s tolerance, as the
      # same rule requires; more misses would put `stop-operator`'s promotion window past a turn. Each engine runs a liveness
      # caller, so a turn whose member takes nothing is skipped to the next member, and an operator that stops is replaced
      # by a promotion.
      liveness_rule="(30,20,5,10)"
      take_window="(4,4,8)"
      switch_budget=5
    fi
    deployed_schedule="$(create --private-key "$vote_deployer_key" src/OperatorSchedule.sol:OperatorSchedule --constructor-args "$registry" "$seed_receiver" \
      "$logheads" "$liveness_rule" "(30,5,2,10)" "(120,60,9,256)" "$take_window" "$switch_budget" 250)"
    deployed_vote="$(create --private-key "$vote_deployer_key" src/ParameterVote.sol:ParameterVote \
      --constructor-args "$schedule" "$vote_normal_window" "$vote_fast_window")"
    [[ "$(lower "$deployed_receiver")" == "$(lower "$seed_receiver")" && "$(lower "$deployed_schedule")" == "$(lower "$schedule")" &&
      "$(lower "$deployed_vote")" == "$(lower "$vote")" ]] || die "the vote's contracts did not deploy where the node config names them"
    third_release=("$third_digest" "$(hex_bytes 7c 32)" localhost:9 localhost:9)
    if [[ "$rotation" == 1 ]]; then
      third_release=("$third_digest" "$third_config_hash" "$console_third_api_host" "127.0.0.1:$third_handover_port")
      # The schedule's witnesses and heads read Arbitrum's block number from ArbSys, which Anvil lacks: the engine's stand-in,
      # which answers the chain's own, takes its address.
      arb_sys="$(create --private-key "$vote_deployer_key" test/mocks/ChainArbSys.sol:ChainArbSys)"
      cast rpc anvil_setCode 0x0000000000000000000000000000000000000064 "$(cast code "$arb_sys" --rpc-url "$rpc")" --rpc-url "$rpc" >>"$step_log" 2>&1
    fi
    register_candidate "$third_candidate" "$third_candidate_key" "${third_release[@]}"
    govern "$registry" "$(cast calldata 'setSchedule(address)' "$schedule")"
    # A close adopts only candidates holding a standby key the vault's signer vouched for. The published mock key signs each
    # vouch while the vault still names it, before the first engine's sealed key takes its place. Each is the address of a
    # stand-in key, 32 bytes of `$4`, which nothing ever uses: no promotion runs without ROTATION=1, and with it each engine
    # registers a standby key of its own once it runs, which the stack sends before it reports the stack up.
    register_standby() {
      local candidate="$1" release standby expiry digest vouch
      release="$(cast keccak "${2}${3#0x}")"
      standby="$(address "$(hex_bytes "$4" 32)")"
      expiry=$(($(cast block latest --field timestamp --rpc-url "$rpc") + 3600))
      digest="$(cast call "$schedule" 'vouchDigest(address,address,bytes32,uint64,uint64)(bytes32)' "$candidate" "$standby" "$release" 1 "$expiry" --rpc-url "$rpc")"
      vouch="$(cast wallet sign --no-hash --private-key "$(hex_bytes 43 32)" "$digest")"
      send_as "$candidate" "$schedule" 'registerStandby(address,uint64,uint64,bytes)' "$standby" 1 "$expiry" "$vouch"
    }
    register_standby "$operator" "$first_digest" "$first_config_hash" 61
    register_standby "$second_candidate" "$second_digest" "$second_config_hash" 62
    register_standby "$third_candidate" "${third_release[0]}" "${third_release[1]}" 63
    # Moves the chain's clock, not the engine's: the next block is mined at `$1`.
    mine_at() {
      cast rpc evm_setNextBlockTimestamp "$1" --rpc-url "$rpc" >>"$step_log" 2>&1
      cast rpc evm_mine --rpc-url "$rpc" >>"$step_log" 2>&1
    }
    # Stakes for the three candidates, closes the registry's epoch, which adopts them as the rotation set,
    # and passes the set's notice, by the chain's clock.
    adopt_rotation_set() {
      step "Make the three candidates the rotation set: stake, delegate, close the registry's epoch, pass the set's notice"
      step_log="$work/votes-set.log"
      # Stakes `$2` whole MONKEY for candidate `$1`, then delegates each following candidate and whole amount.
      member_stake() {
        local member="$1" amount="$2$mon"
        shift 2
        mint_monkey "$member" "$amount"
        send_as "$member" "$monkey" 'approve(address,uint256)' "$staking" "$amount"
        send_as "$member" "$staking" 'stake(uint256)' "$amount"
        while (($# > 0)); do
          send_as "$member" "$staking" 'delegate(address,uint256)' "$1" "$2$mon"
          shift 2
        done
      }
      member_stake "$operator" 40000 "$operator" 40000
      member_stake "$second_candidate" 25000 "$second_candidate" 24000 "$third_candidate" 1000
      member_stake "$third_candidate" 34000 "$third_candidate" 34000
      mine_at $(($(cast call "$registry" 'openEpochStart()(uint64)' --rpc-url "$rpc" | awk 'NR == 1 {print $1}') + registry_epoch_secs + 1))
      send "$registry" 'closeEpoch()' --private-key "$payer_key"
      [[ "$(cast call "$schedule" 'setCount()(uint32)' --rpc-url "$rpc")" == 1 ]] || die "the close adopted no rotation set (see $step_log)"
      mine_at $(($(cast call "$schedule" 'setOf(uint32)(uint64,uint64,address[],uint256[])' 1 --rpc-url "$rpc" | sed -n 2p | awk '{print $1}') + 1))
      set_in_effect() { [[ "$(cast call "$schedule" 'currentSetId()(uint32)' --block finalized --rpc-url "$rpc" 2>/dev/null)" == 1 ]]; }
      poll 60 set_in_effect || die "the rotation set is not in effect at a finalized block"
    }
  fi
  govern "$registry" "$(cast calldata 'setRotation(bool)' true)"
  first_release="$(cast keccak "${first_digest}${first_config_hash#0x}")"
  second_release="$(cast keccak "${second_digest}${second_config_hash#0x}")"
  # With rotation on, the vault names the operator in effect's release; it must be folded into the
  # vault's generation before the first engine seals its keys.
  release_is() { [[ "$(lower "$(cast call "$vault" "$1()(bytes32)" --block finalized --rpc-url "$rpc" 2>/dev/null)")" == "$(lower "$2")" ]]; }
  send "$vault" 'syncRelease()' --private-key "$payer_key"
  folded() { release_is currentRelease "$first_release" && release_is syncedRelease "$first_release"; }
  poll 30 folded || die "the vault does not name the first engine's release at a finalized block"
fi

if [[ "$rotation" == 1 ]]; then
  adopt_rotation_set
  step "Run the chain on true time"
  step_log="$work/turns.log"
  first_of() { awk 'NR == 1 {print $1}'; }
  turn_offset="$(cast call "$schedule" 'boundary(uint64)(uint64)' 0 --rpc-url "$rpc" | first_of)"
  # When turn `$1` starts; its draw deadline, from which it may be drawn until it starts, is a turn earlier.
  boundary_of() { echo $(($1 * turn_secs + turn_offset)); }
  relay_alias="$(cast call "$seed_receiver" 'relayAlias()(address)' --rpc-url "$rpc")"
  # A seed whose draw of turn `$1` gives its first position to candidate `$2`, from the set in effect.
  seed_for() {
    local turn="$1" candidate="$2" set_id byte seed
    set_id="$(cast call "$schedule" 'currentSetId()(uint32)' --rpc-url "$rpc")"
    for byte in $(seq 1 100); do
      seed="$(hex_bytes "$(printf '%02x' "$byte")" 32)"
      if [[ "$(lower "$(cast call "$schedule" 'memberAt(uint32,bytes32,uint64,uint16)(address)' "$set_id" "$seed" "$turn" 0 --rpc-url "$rpc")")" == "$(lower "$candidate")" ]]; then
        echo "$seed"
        return 0
      fi
    done
    return 1
  }
  # Records seed `$2` as turn `$1`'s, sent from the relay's aliased address as the Arbitrum bridge delivers a relay.
  relay_seed() {
    send_as "$relay_alias" "$seed_receiver" 'receiveSeed(uint64,uint64,bytes32)' "$1" \
      "$(cast call "$seed_receiver" 'seedEpoch(uint64)(uint64)' "$1" --rpc-url "$rpc" | first_of)" "$2"
  }
  drawn_candidate() { cast call "$schedule" 'turnOf(uint64)((address,uint16,uint8,uint32,uint64,uint64,bytes32,address))' "$1" --rpc-url "$rpc" | tr -d '(' | cut -d, -f1; }
  # No turn is drawn yet: the first engine's log names the set only once it runs, and it accepts a turn only a turn
  # after that. The first engine holds the key the timelock installed until the first turn the stack draws below.
  mine_at "$(date +%s)"
  poll 30 folded || die "the vault does not name the first engine's release at a finalized block on true time"

  # The members' engines, by index: the first engine, which holds the installed key until the first turn, then the second and the third.
  member_names=(first second third)
  member_candidates=("$operator" "$second_candidate" "$third_candidate")
  member_dirs=("$work" "$work/second" "$work/third")
  member_configs=("$work/node.toml" "$work/second.toml" "$work/third.toml")
  member_digests=("$first_digest" "$second_digest" "$third_digest")
  member_logs=("$work/node.log" "$work/second.log" "$work/third.log")
  member_pid() { case "$1" in 0) echo "$node_pid" ;; 1) echo "$second_pid" ;; *) echo "$third_pid" ;; esac; }
  set_member_pid() { case "$1" in 0) node_pid="$2" ;; 1) second_pid="$2" ;; *) third_pid="$2" ;; esac; }
  # The member whose candidate is `$1`, by index.
  member_of() {
    local i
    for i in 0 1 2; do
      if [[ "$(lower "${member_candidates[$i]}")" == "$(lower "$1")" ]]; then
        echo "$i"
        return 0
      fi
    done
    return 1
  }
  # Stops the stack if any member's engine has exited.
  members_alive() {
    local i pid
    for i in 0 1 2; do
      pid="$(member_pid "$i")"
      alive "$pid" || { step_log="${member_logs[$i]}" && die "the ${member_names[$i]} engine exited"; }
    done
  }
  # Starts member `$1`'s engine as a member, which follows the operator in effect until its turn.
  start_member() {
    (cd "${member_dirs[$1]}" && exec "$engine" run --config "${member_configs[$1]}" --mock-launch-digest "${member_digests[$1]}") \
      >>"${member_logs[$1]}" 2>&1 &
    set_member_pid "$1" "$!"
  }
  # The registration each member's node last wrote that the schedule took, as its calldata, and when the stack may send
  # one the schedule refused again.
  registered_calls=("" "" "")
  registration_retry_at=(0 0 0)
  # Sends each standby key registration a member's node has written, from its candidate, until the schedule takes it, and
  # records the key registered in `standby-<name>` in the work directory.
  send_standby_registrations() {
    local i file calldata key now
    now="$(date +%s)"
    for i in 0 1 2; do
      file="${member_dirs[$i]}/keys/standby-registration.json"
      calldata="$(jq -r '.calldata // empty' "$file" 2>/dev/null)" || continue
      if [[ -z "$calldata" || "$calldata" == "${registered_calls[$i]}" ]] || ((now < registration_retry_at[i])); then continue; fi
      key="$(jq -r '.key' "$file")"
      # A send whose answer was lost may still have landed: the schedule then lists the key, and refuses it a second time.
      if send_as "${member_candidates[$i]}" "$schedule" "$calldata" || [[ "$(lower "$(cast call "$schedule" 'promotable(address)(address)' \
        "${member_candidates[$i]}" --rpc-url "$rpc" 2>/dev/null)")" == "$(lower "$key")" ]]; then
        registered_calls[i]="$calldata"
        echo "$key" >"$work/standby-${member_names[$i]}"
        step "Registered the ${member_names[$i]} engine's standby key $key, which a promotion can make the vault's signer"
      else
        registration_retry_at[i]=$((now + 15))
        echo "    The schedule refused the ${member_names[$i]} engine's standby key registration; the stack sends it again in 15 s (see $step_log)" >&2
      fi
    done
  }
  stamp() { date -u -r "$1" '+%H:%M:%S UTC'; }
  # Draws the turns from `next_turn`: relays each one's seed, for the member after the last one drawn, before its draw
  # deadline, and draws it from the deadline until it begins. A failed relay or draw is tried again 10 s later while its
  # window is open; a turn whose window passes undrawn stays undrawn, and the turn drawn last keeps naming its member.
  seeded=""
  turn_retry_at=0
  turn_tick() {
    local now boundary seed drawn i
    now="$(date +%s)"
    boundary="$(boundary_of "$next_turn")"
    if ((now >= boundary - 2)); then
      echo "    Turn $next_turn was not drawn before it began; the turn drawn last keeps naming its member" >&2
      next_turn=$((next_turn + 1))
      seeded=""
      turn_retry_at=0
      return 0
    fi
    ((now >= turn_retry_at)) || return 0
    if [[ -z "$seeded" ]] && ((now < boundary - turn_secs - 5)); then
      if seed="$(seed_for "$next_turn" "${member_candidates[$next_member]}")" && relay_seed "$next_turn" "$seed"; then
        seeded=yes
      else
        turn_retry_at=$((now + 10))
        echo "    The seed for turn $next_turn could not be relayed (see $step_log); trying again in 10 s" >&2
        return 0
      fi
    fi
    ((now >= boundary - turn_secs + 1)) || return 0
    send "$schedule" 'draw(uint64)' "$next_turn" --private-key "$payer_key" || true
    # A draw whose answer was lost may still have landed: the chain says whom the turn names.
    drawn="$(drawn_candidate "$next_turn")" || drawn=""
    if i="$(member_of "$drawn")"; then
      step "Drew turn $next_turn for the ${member_names[$i]} engine, from $(stamp "$boundary"); it takes the keys then"
      next_member=$(((i + 1) % 3))
      next_turn=$((next_turn + 1))
      seeded=""
      turn_retry_at=0
    else
      turn_retry_at=$((now + 10))
      echo "    Turn $next_turn could not be drawn (see $step_log); trying again in 10 s" >&2
    fi
  }
  # The standby key registrations, and the turns once the stack writes the first turn to draw and its member to
  # `turns-from` in the work directory, beside the stack's own steps and loop, so neither waits on them. A step that
  # fails is reported and tried again at the next tick.
  next_turn=""
  drive_turns() {
    while :; do
      send_standby_registrations || true
      if [[ -z "$next_turn" && -f "$work/turns-from" ]]; then read -r next_turn next_member <"$work/turns-from"; fi
      if [[ -n "$next_turn" ]]; then turn_tick || true; fi
      sleep 2
    done
  }
fi

step "Start the local access source, which clears every screening with Anvil account 0's key"
step_log="$work/access-source.log"
printf '%s\n' '{"mode":"clear","jurisdictions":{},"sanctioned":[]}' >"$work/access-fixture.json"
"$access_source" "127.0.0.1:$access_port" 31337 "$vault" "$work/access-fixture.json" >"$step_log" 2>&1 &
access_pid=$!
access_up() {
  alive "$access_pid" || die "the access source exited"
  curl --max-time 2 -sf "http://127.0.0.1:$access_port" -H 'content-type: application/json' \
    -d '{"request_hash":"0x0000000000000000000000000000000000000000000000000000000000000000","account":null,"payer":null,"peer":null}' \
    >/dev/null 2>&1
}
poll 30 access_up || die "the access source did not start"

step "Start the node on $api"
step_log="$work/node.log"
# A closed local port stands in for the Critical alert route EVM custody requires; alerts show in
# the node log.
export ENGINE_ALERTS_CRITICAL_URL="http://127.0.0.1:9/alerts"
node_args=(run --config "$work/node.toml")
# The first engine seals new keys for its release, as an operator's first deployment does; the vault
# serves them nothing until its timelock installs the enclave the engine attests.
if [[ "$second_engine" == 1 ]]; then node_args+=(--new-key --mock-launch-digest "$first_digest"); fi
(cd "$work" && exec "$engine" "${node_args[@]}") >"$step_log" 2>&1 &
node_pid=$!
# The first engine sequences nothing, genesis included, until another member of the turn's set has answered its start
# check under the standby key the schedule lists for it: the second and third engines start with it, as members, and
# follow it once it serves, while the stack registers each member's standby key once the first engine vouches for it.
if [[ "$rotation" == 1 ]]; then
  step "Start the second and third engines as members, which follow the first engine until their turns"
  start_member 1
  start_member 2
  step_log="$work/turns.log"
  drive_turns &
  driver_pid=$!
  step_log="$work/node.log"
fi
node_up() {
  alive "$node_pid" || die "the node exited"
  [[ "$rotation" == 0 ]] || members_alive
  [[ "$(curl -sk --max-time 2 "$api/v1/health" 2>/dev/null)" == ok ]]
}
if [[ "$second_engine" == 1 ]]; then
  attestation_up() {
    alive "$node_pid" || die "the node exited"
    [[ "$rotation" == 0 ]] || members_alive
    [[ -n "$(curl -sk --max-time 2 "$api/v1/attestation" 2>/dev/null | jq -r '.enclave_address // empty' 2>/dev/null)" ]]
  }
  poll 120 attestation_up || die "the node did not serve its attestation on $api/v1/attestation"
  enclave="$(curl -sk --max-time 5 "$api/v1/attestation" | jq -r '.enclave_address')"
  step "Register the first engine's enclave $enclave as its signer"
  step_log="$work/signer.log"
  send_as "$operator" "$registry" 'setEnclave(address)' "$enclave"
  govern "$vault" "$(cast calldata 'setSigner(address)' "$enclave")"
  step_log="$work/node.log"
fi
poll 120 node_up || die "the node did not report healthy on $api/v1/health"
attested="$(curl -sk --max-time 5 "$api/v1/attestation" | jq -r '.enclave_address // empty')"
[[ "$(lower "$attested")" == "$(lower "$enclave")" ]] || die "the node attests enclave ${attested:-none}, not the vault's signer $enclave"

step "Initialise MONKEY emissions and staking"
step_log="$work/init-emissions.log"
# The engine queues genesis until its first trusted time sample and refuses every command until
# then, so wait for the sequenced markets before sending the operator's schedule.
genesis_applied() {
  alive "$node_pid" || die "the node exited"
  [[ "$rotation" == 0 ]] || members_alive
  [[ "$(curl -sk --max-time 2 "$api/v1/markets" 2>/dev/null)" != "[]" ]]
}
genesis_wait=120
# With ROTATION=1 the first engine sequences genesis only once a member has answered its start check, under the standby
# key the stack registers once the first engine has vouched for it.
if [[ "$rotation" == 1 ]]; then genesis_wait=300; fi
poll "$genesis_wait" genesis_applied || die "genesis did not apply within $((genesis_wait / 60)) minutes"
# The operator's signed schedule, taken once by a fresh log: period 0 at the next whole minute
# with the period budget the vault deployed with, which the node reconciles against the MONKEY
# cap before it sequences this (a budget the cap was not derived from is refused). The operator
# key is the published local test key 0x4242...42 (config/test-keys.toml).
tls_pin="$(curl -sk --max-time 5 "$api/v1/attestation" | jq -r '.tls_public_key_sha256')"
printf '%s\n' "4242424242424242424242424242424242424242424242424242424242424242" >"$work/operator.key"
# The engine refuses a start before its sequenced time, so a local clock behind the node's
# trusted one can need a later start: retry a bounded few times, each with the next minute.
emissions_applied=""
for _attempt in 1 2 3; do
  emissions_start="$(python3 -c 'import time; print(time.strftime("%Y-%m-%dT%H:%M:00Z", time.gmtime((int(time.time()) // 60 + 1) * 60)))')"
  if "$engine" admin --config "$work/node.toml" --node "$api" --pin "$tls_pin" --key-file "$work/operator.key" \
    init-emissions --start "$emissions_start" --period-budget "$monkey_period_budget" >>"$step_log" 2>&1; then
    emissions_applied=yes
    break
  fi
  sleep 2
done
[[ -n "$emissions_applied" ]] || die "the node did not sequence init-emissions (see $step_log)"

# Staking is initialised once, the same way: epoch 0 starts at the next whole minute, with the
# cooldown the staking contract was deployed with. The node mirrors the contract's events only
# from then on.
step_log="$work/init-staking.log"
staking_applied=""
for _attempt in 1 2 3; do
  staking_start="$(python3 -c 'import time; print(time.strftime("%Y-%m-%dT%H:%M:00Z", time.gmtime((int(time.time()) // 60 + 1) * 60)))')"
  if "$engine" admin --config "$work/node.toml" --node "$api" --pin "$tls_pin" --key-file "$work/operator.key" \
    init-staking --start "$staking_start" --liquidity-floor "$staking_floor_usdc" \
    --epoch-ms $((staking_epoch_secs * 1000)) --cooldown-ms $((staking_cooldown_secs * 1000)) >>"$step_log" 2>&1; then
    staking_applied=yes
    break
  fi
  sleep 2
done
[[ -n "$staking_applied" ]] || die "the node did not sequence init-staking (see $step_log)"

# With ROTATION=1 the set was adopted before the engines started, on the chain's past.
if [[ "$parameter_votes" == 1 && "$rotation" == 0 ]]; then adopt_rotation_set; fi

if [[ "$rotation" == 1 ]]; then
  # An engine accepts a turn's key only once its log has named the turn's set a turn earlier.
  step "Wait for the first engine's log to name the rotation set"
  logged_ms=""
  set_logged() {
    members_alive
    logged_ms="$(curl -sk --max-time 5 "$api/v1/operator" 2>/dev/null | jq -er '.rotation_set.logged_at' 2>/dev/null)"
  }
  poll 120 set_logged || die "the first engine's log did not name the rotation set within two minutes"
  # The first turn to draw: a turn after the log named the set, with time to relay its seed before its draw deadline.
  earliest=$((logged_ms / 1000 + turn_secs))
  if ((earliest < $(date +%s) + turn_secs + 60)); then earliest=$(($(date +%s) + turn_secs + 60)); fi
  next_turn=$(((earliest - turn_offset + turn_secs - 1) / turn_secs))
  # The turns go to the members in order, from the second engine; the driver reads the file whole once it exists.
  echo "$next_turn 1" >"$work/turns-from.tmp"
  mv "$work/turns-from.tmp" "$work/turns-from"
  step_log="$work/turns.log"
  step "Register each engine's standby key, which its node writes once the vault's signer vouches for it"
  standbys_registered() {
    members_alive
    alive "$driver_pid" || { step_log="$work/turns.log" && die "the turn driver stopped"; }
    [[ -f "$work/standby-first" && -f "$work/standby-second" && -f "$work/standby-third" ]]
  }
  poll 300 standbys_registered || die "not every engine registered a standby key within five minutes (see each engine's log)"
fi

# Every market a configured venue quotes, BTC-USD among them.
venues_priced() {
  alive "$node_pid" || die "the node exited"
  curl -sk --max-time 2 "$api/v1/markets" 2>/dev/null |
    jq -e --argjson venue "$venue_markets" '[.[] | select(.id as $id | $venue | index($id)) | .mark] | length > 0 and all(. != null)' \
      >/dev/null 2>&1
}
if [[ "$venue_markets" != "[]" ]] && ! poll 60 venues_priced; then
  echo "    The venue feeds have not priced every crypto market yet; each gets a mark once two venues quote it." >&2
fi
markets="$(curl -sk --max-time 5 "$api/v1/markets")"
priced="$(jq -r '[.[] | select(.mark != null) | "\(.symbol) \(.mark)"] | join(", ")' <<<"$markets")"
waiting="$(jq -r --argjson venue "$venue_markets" \
  '[.[] | select(.mark == null and (.id as $id | $venue | index($id))) | .symbol] | join(", ")' <<<"$markets")"
unfed="$(jq -r --argjson venue "$venue_markets" \
  '[.[] | select(.mark == null and (.id as $id | $venue | index($id) | not)) | .symbol] | join(", ")' <<<"$markets")"

step "Start the console ($console_build) on $console_url"
export NEXT_PUBLIC_ENGINE_MODE=live-dev
export NEXT_PUBLIC_ENGINE_ORIGIN="$console_api"
export NEXT_PUBLIC_ENGINE_DEV_ORIGINS="$console_api"
export NEXT_PUBLIC_ENGINE_CHAIN_ID=31337
export NEXT_PUBLIC_ENGINE_VAULT="$vault"
export NEXT_PUBLIC_ENGINE_USDC="$usdc"
export NEXT_PUBLIC_ENGINE_STAKING="$staking"
export NEXT_PUBLIC_ENGINE_REGISTRY="$registry"
export NEXT_PUBLIC_ENGINE_MONKEY="$monkey"
export NEXT_PUBLIC_ENGINE_HEARTBEAT_MS="$heartbeat_ms"
export NEXT_PUBLIC_ENGINE_RPC_URL="$rpc"
if [[ "$second_engine" == 1 ]]; then
  # The console may follow an election to the second engine: its CSP names the origin, and as a
  # dev origin it may present the mock attestation the mock TEE gives.
  export NEXT_PUBLIC_ENGINE_CANDIDATE_ORIGINS="$console_second_api"
  export NEXT_PUBLIC_ENGINE_DEV_ORIGINS="$console_api,$console_second_api"
  if [[ "$rotation" == 1 ]]; then
    export NEXT_PUBLIC_ENGINE_CANDIDATE_ORIGINS="$console_second_api,$console_third_api"
    export NEXT_PUBLIC_ENGINE_DEV_ORIGINS="$console_api,$console_second_api,$console_third_api"
  fi
fi
if [[ "$console_build" == production ]]; then
  step_log="$work/console-build.log"
  (cd "$root" && nice -n 10 npm run build) >"$step_log" 2>&1 || die "the console build failed"
  next_command=start
else
  next_command=dev
fi
step_log="$work/console.log"
# In its own process group, so stopping the group also stops the workers Next.js spawns.
(cd "$root" && exec python3 -c 'import os, sys; os.setpgid(0, 0); os.execvp(sys.argv[1], sys.argv[1:])' \
  nice -n 10 node_modules/.bin/next "$next_command" --port "$console_port") </dev/null >"$step_log" 2>&1 &
console_pid=$!
console_up() {
  alive "$console_pid" || die "the console exited"
  [[ "$(curl -s -o /dev/null --max-time 120 -w '%{http_code}' "$console_url/" 2>/dev/null)" == 200 ]]
}
poll 300 console_up || die "the console did not answer on $console_url"

if [[ -n "${STACK_INFO_FILE:-}" ]]; then
  jq -n --arg consoleUrl "$console_url" --arg apiOrigin "$console_api" --arg rpcUrl "$rpc" --arg vault "$vault" \
    --arg usdc "$usdc" --arg monkey "$monkey" --arg staking "$staking" --arg registry "$registry" \
    --arg devWallet "$dev_wallet" --arg devWalletKey "$dev_wallet_key" --arg houseKey "$house_key" \
    --arg deployerKey "$deployer_key" --arg workDir "$work" --arg nodeLog "$work/node.log" --arg metricsUrl "$metrics_url" \
    --arg genesisFile "$genesis_file" --arg genesisSummary "$genesis_summary" --argjson houseUsdc "$house_usdc" \
    --arg secondEngine "$second_engine" --arg secondApiOrigin "$console_second_api" --arg secondNodeLog "$work/second.log" \
    --arg dev2Wallet "${dev_wallet2:-}" --arg dev2WalletKey "${dev_wallet2_key:-}" --arg payerKey "${payer_key:-}" \
    --arg secondRelease "${second_release:-}" --arg firstRelease "${first_release:-}" \
    --arg operator "${operator:-}" --arg secondCandidate "${second_candidate:-}" \
    --arg vote "$vote" --arg schedule "$schedule" --arg thirdCandidate "${third_candidate:-}" \
    --arg secondCandidateKey "${second_candidate_key:-}" --arg thirdCandidateKey "${third_candidate_key:-}" \
    --arg rotation "$rotation" --arg thirdApiOrigin "$console_third_api" --arg thirdNodeLog "$work/third.log" \
    --arg secondMetricsUrl "http://127.0.0.1:$second_metrics_port/metrics" --arg thirdMetricsUrl "http://127.0.0.1:$third_metrics_port/metrics" \
    '{consoleUrl: $consoleUrl, apiOrigin: $apiOrigin, rpcUrl: $rpcUrl, chainId: 31337, vault: $vault, usdc: $usdc,
      monkey: $monkey, staking: $staking, registry: $registry,
      devWallet: $devWallet, devWalletKey: (if $devWalletKey == "" then null else $devWalletKey end),
      houseKey: $houseKey, deployerKey: $deployerKey, genesisFile: $genesisFile, genesisSummary: $genesisSummary, houseUsdc: $houseUsdc, workDir: $workDir, nodeLog: $nodeLog, metricsUrl: $metricsUrl}
      + (if $secondEngine == "1" then {secondApiOrigin: $secondApiOrigin, secondNodeLog: $secondNodeLog,
          secondDevWallet: $dev2Wallet, secondDevWalletKey: (if $dev2WalletKey == "" then null else $dev2WalletKey end),
          payerKey: $payerKey, firstRelease: $firstRelease, secondRelease: $secondRelease,
          operator: $operator, secondCandidate: $secondCandidate} else {} end)
      + (if $vote != "" then {vote: $vote, schedule: $schedule, thirdCandidate: $thirdCandidate,
          secondCandidateKey: $secondCandidateKey, thirdCandidateKey: $thirdCandidateKey} else {} end)
      + (if $rotation == "1" then {thirdApiOrigin: $thirdApiOrigin, thirdNodeLog: $thirdNodeLog,
          secondMetricsUrl: $secondMetricsUrl, thirdMetricsUrl: $thirdMetricsUrl} else {} end)' \
    >"$STACK_INFO_FILE.tmp"
  mv "$STACK_INFO_FILE.tmp" "$STACK_INFO_FILE"
  info_written=yes
fi

if [[ "$trusted" == 1 ]]; then
  api_lines="$console_api, under a certificate mkcert's root issued, so a browser that trusts the root accepts it
                   with nothing to click (the engine's own listener, $api, stays self-signed)."
  rotation_cert_note="
                   The console moves between engines through certificates the browser trusts, so no
                   engine's certificate needs accepting."
  election_cert_note=""
  second_cert_hint=""
  if [[ "$(uname)" == Darwin ]] && ! security verify-cert -c "$mkcert_root/rootCA.pem" -p ssl >/dev/null 2>&1; then
    api_lines="$api_lines
                   This system does not trust mkcert's root ($mkcert_root/rootCA.pem): run
                   \`mkcert -install\` once, or the browser still warns."
  fi
else
  api_lines="$api
                   Open $api/v1/health once in the same browser and accept its
                   self-signed certificate, or the console cannot reach the node.
                   To serve the engines under a certificate the browser trusts, so none needs accepting (the rotation
                   demo moves the console to a new engine at each boundary), run \`brew install mkcert && mkcert -install\`
                   once (one keychain prompt), then start the stack again."
  rotation_cert_note=" If the console does
                   not move to the engine that holds the turn, open that engine's /v1/health and accept its
                   certificate."
  election_cert_note="
                   Then open $second_api/v1/health once and accept its certificate."
  second_cert_hint=" (open $second_api/v1/health once and accept its certificate)"
fi
if [[ -n "$dev_wallet_key" ]]; then
  wallet_line="$dev_wallet (Anvil account 1)
  Private key      $dev_wallet_key
                   A public test key: import it into a dev wallet profile, never use it on a real chain."
else
  wallet_line="$dev_wallet (DEV_WALLET, given 100 ETH for gas)"
fi
if [[ "$genesis_file" == "$engine_dir/config/dev.toml" ]]; then
  genesis_label="$genesis_file (the development genesis)"
else
  genesis_label="$genesis_file (development values for the vault, staking and house)"
fi
staking_values="Development values, not production parameters: epochs of $((staking_epoch_secs / 60)) minutes from
                   $staking_start, an unstake cooldown of $((staking_cooldown_secs / 60)) minutes, and a liquidity floor of
                   $staking_floor_usdc USDC."
if [[ "$launch" == 1 ]]; then
  genesis_label="$genesis_file (with the launch deployment's values from $deployment)"
  staking_values="From $deployment, unchanged: the MONKEY period budget (${monkey_period_budget%000000000000000000} MONKEY), the
                   vault's exit period ($((vault_exit_period / 86400)) days), claim window ($((vault_claim_window / 86400)) days) and
                   deposit staleness ($((vault_stale_after / 86400)) day).
                   Shortened to be watchable: the staking epoch ($((staking_epoch_secs / 60)) minutes from $staking_start, not $((launch_epoch / 86400)) day
                   from $launch_start), the unstake cooldown ($((staking_cooldown_secs / 60)) minutes, not $((launch_cooldown / 86400)) days), the
                   liquidity floor ($staking_floor_usdc USDC, not $launch_floor), the timelock's delay (1 second, not
                   $((launch_timelock_delay / 86400)) days), and the start of emissions and staking (the next minute). The house starts with no
                   capital, as at launch: \`dev-local-stack-ctl.sh fund-house\` or clients' losses fill it."
fi
withdrawals_line="The engine approves a withdrawal; the next checkpoint (every 1000 commands, within
                   seconds) is posted to the vault, and the console then claims it on the vault."
logs_line="Node log           $work/node.log
Metrics            $metrics_url"
if [[ "$rotation" == 1 ]]; then
  withdrawals_line="The engine approves a withdrawal and the next checkpoint (every 1000 commands, within
                   seconds) is posted to the vault. While the turns rotate, the withdrawal can be claimed
                   only once the next turn's member has checked the log up to its approval, from the
                   next boundary; the console then claims it on the vault."
  logs_line="Engine logs        $work/node.log, $work/second.log and $work/third.log
Metrics            $metrics_url, http://127.0.0.1:$second_metrics_port/metrics and
                   http://127.0.0.1:$third_metrics_port/metrics"
fi
if [[ "$second_engine" == 1 ]]; then
  rotation_state="rotation on"
  signer_line="$enclave (the first engine's sealed key, installed through the timelock)"
  if [[ -n "$dev_wallet2_key" ]]; then
    wallet2_line="$dev_wallet2 (Anvil account 3)
  Private key      $dev_wallet2_key
                   A public test key, like the first wallet's."
  else
    wallet2_line="$dev_wallet2 (DEV_WALLET2, given 100 ETH for gas)"
  fi
  if [[ "$rotation" == 1 ]]; then
    two_engines="
Rotation           Each member of the rotation set runs an engine built with five-minute turns, a development
                   option. The first engine ($console_api) holds the key the timelock installed until the first turn,
                   and the second ($console_second_api) and the third ($console_third_api) follow it.
                   The stack draws each turn from turn $next_turn, which begins at $(stamp "$(boundary_of "$next_turn")"), for the
                   next member in that order, and at each boundary that member's engine takes the keys from
                   the previous one. An engine serves its API only while it holds a turn.$rotation_cert_note
Relayers           Each engine posts its checkpoints and its log heads (to the LogHeads contract $logheads)
                   through relayers of its own, Anvil accounts 9 and 10, 11 and 12, and 13 and 14, and runs a
                   liveness caller from account 15, 16 or 17.
Second wallet      $wallet2_line
MONKEY to stake    Both wallets hold $wallet_monkey MONKEY to stake and delegate on the Staking page; the stack also gave the
                   second wallet $dev_usdc mock USDC.
Watch it           ./scripts/dev-local-stack-ctl.sh status shows the turns, the operator in effect and each engine.
                   ./scripts/dev-local-stack-ctl.sh stop-operator stops the operator in effect's engine: the
                   other members promote the next member's standby key, and the stopped engine then starts
                   again and follows. Both read $STACK_INFO_FILE.
"
  else
    two_engines="
Two engines        The first engine ($console_api) is the operator in effect, under sealed keys.
                   The second ($console_second_api) is registered with an approved release, and
                   the stack starts it once an election has made the vault name its release.$election_cert_note
Log heads          Each engine posts its newest log head every 10 seconds to the LogHeads contract $logheads,
                   through its own relayer $heads_relayer (Anvil account 10), apart from the checkpoint
                   relayer $relayer.
Second wallet      $wallet2_line
MONKEY to stake    Both wallets hold $wallet_monkey MONKEY to stake and delegate on the Staking page; the stack also gave the
                   second wallet $dev_usdc mock USDC.
Drive it           ./scripts/dev-local-stack-ctl.sh status | elect | handover | fund-house <USDC>
                   (reads $STACK_INFO_FILE)
"
  fi
  if [[ "$parameter_votes" == 1 ]]; then
    clock_note="No turn is drawn, so a passed change applies nothing (ROTATION=1 draws one). The chain's clock is
                   eight days ahead of the engine's, so withdrawal authorizations do not pay, \`elect\` and \`handover\` do not apply,
                   and the Governance tab counts a voting window, which runs on the chain's clock, eight days long."
    if [[ "$rotation" == 1 ]]; then clock_note="A fast-path restriction lasts $restriction_ttl."; fi
    two_engines="$two_engines
Parameter votes    The rotation set in effect is the first engine's candidate $operator (40,000
                   MONKEY), the second engine's $second_candidate (24,000) and the third
                   candidate $third_candidate (35,000), on the vote contract $vote.
Member wallet      To vote on the Staking page's Governance tab, import the second engine's candidate
                   (Anvil account 4), $second_candidate_key, a public test key. It delegates
                   to itself and the third candidate.
Propose and vote   ./scripts/dev-local-stack-ctl.sh propose operator|second|third normal|fast '<admin command JSON>'
                   ./scripts/dev-local-stack-ctl.sh vote operator|second|third <proposal>
                   $clock_note
"
  fi
else
  rotation_state="rotation off"
  signer_line="$enclave (the node's published mock key)"
  two_engines=""
fi
cat <<EOF

==> The local stack is up. Ctrl-C stops everything it started.

Console            $console_url
                   Open it at localhost, not 127.0.0.1: the node accepts that browser origin only.
Engine API         $api_lines

Add the network to MetaMask or Rabby
  Network name     Anvil (local)
  RPC URL          $rpc
  Chain ID         31337
  Currency symbol  ETH

Dev wallet         $wallet_line
Mock USDC          $usdc
                   Add it to the wallet as a custom token (6 decimals); the dev wallet holds $dev_usdc.
Genesis            $genesis_label
                   $genesis_summary
Vault              $vault (house capital $house_usdc USDC)
MONKEY token       $monkey (the vault mints it against emissions claims)
Staking contract   $staking (deployed by the operator registry $registry, $rotation_state)
Staking values     $staking_values
Enclave signer     $signer_line

Priced markets     ${priced:-none yet}
Awaiting quotes    ${waiting:-none} (live crypto venues)
Unpriced markets   ${unfed:-none} (no market-data vendor keys: a node's feed is live venues or the mock, never both, and
                   its vendor sources accept their own domains only, so no local stand-in can quote them)

Setup              Connecting a wallet opens the console's setup popup: the Anvil faucet, the
                   eligibility declaration, then authorizing the browser.
Deposits           Approve the vault and deposit from the console. The node sees a deposit a few
                   blocks (seconds) after it is mined and credits it; a deposit sent straight to the
                   vault before a declaration stays pending until the wallet signs one.
Withdrawals        $withdrawals_line
MONKEY             Emissions run from $emissions_start: ten-minute budgets accrue to each period's
                   gross realised losses and show in the console once a losing trade closes; claim
                   them on the MONKEY page, then stake. An epoch that closes with a stake while the
                   house's NAV is above the floor pays the excess to the stakers in USDC.

$two_engines
$logs_line
EOF
[[ "${KEEP_WORK:-0}" == 1 ]] || echo "The work directory is removed on exit; set KEEP_WORK=1 to keep it."

# What the two-engine option does between the owner's commands. `dev-local-stack-ctl.sh handover`
# makes the vault name the second engine's release at a finalized block, where a node reads it, and
# says so by creating a file; the second engine starts then. The first engine exits once the second
# holds its keys and its log. The stack reads no chain state here: Anvil can deadlock under polling.
second_engine_tick() {
  if [[ -z "$second_pid" && -f "$work/start-second-engine" ]]; then
    step "The vault names the second engine's release: starting it on $console_second_api$second_cert_hint"
    (cd "$work/second" && exec "$engine" run --config "$work/second.toml" --mock-launch-digest "$second_digest") \
      >"$work/second.log" 2>&1 &
    second_pid=$!
  fi
  if [[ -n "$second_pid" && -n "$node_pid" ]] && ! alive "$node_pid"; then
    wait "$node_pid" || die "the first engine exited with an error while handing over"
    node_pid=""
    step "The first engine handed its keys and log over and exited; the second engine serves"
  fi
}

# What the rotation option does between turns. The first engine, started with new keys, exits once it has handed them
# over, and starts again as a member, which follows the operator in effect until its next turn. `dev-local-stack-ctl.sh
# stop-operator` stops the operator in effect's engine, and starts it again, by creating a file for each.
rotation_tick() {
  local i pid name
  for i in 0 1 2; do
    pid="$(member_pid "$i")"
    name="${member_names[$i]}"
    if [[ -f "$work/stop-$name" ]]; then
      rm -f "$work/stop-$name"
      if [[ -n "$pid" ]]; then
        step "Stopping the $name engine, the operator in effect"
        stop_pid "$pid" 30
        set_member_pid "$i" ""
        pid=""
      fi
    fi
    if [[ -f "$work/start-$name" ]]; then
      rm -f "$work/start-$name"
      if [[ -z "$pid" ]]; then
        step "Starting the $name engine again: it follows the operator in effect until its next turn"
        start_member "$i"
      fi
    elif [[ -n "$pid" ]] && ! alive "$pid"; then
      if wait "$pid"; then
        step "The $name engine handed its keys over and exited: starting it again, to follow the operator in effect"
        start_member "$i"
      else
        step_log="${member_logs[$i]}"
        die "the $name engine exited"
      fi
    fi
  done
  alive "$driver_pid" || { step_log="$work/turns.log" && die "the turn driver stopped"; }
}

# Anvil can deadlock under load, still running but answering nothing, and the chain is lost with it. A
# long election test would otherwise sit on a dead chain, so the two-engine option probes it.
probe_ticks=0
probe_misses=0
anvil_probe() {
  ((++probe_ticks % 8 == 0)) || return 0
  if curl -s --max-time 8 -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$rpc" >/dev/null; then
    probe_misses=0
  elif ((++probe_misses >= 3)); then
    step_log="$work/anvil.log"
    die "Anvil stopped answering on $rpc (it deadlocks under load); its chain is lost, so start the stack again"
  fi
}

# Stops the stack when any part of it exits.
while :; do
  alive "$anvil_pid" || { step_log="$work/anvil.log" && die "Anvil exited"; }
  alive "$access_pid" || { step_log="$work/access-source.log" && die "the access source exited"; }
  if [[ -n "$proxy_pid" ]]; then alive "$proxy_pid" || { step_log="$work/proxy.log" && die "the TLS proxy exited"; }; fi
  if [[ "$rotation" == 1 ]]; then
    rotation_tick
  else
    if [[ -n "$node_pid" ]] && ! alive "$node_pid" && [[ -z "$second_pid" ]]; then step_log="$work/node.log" && die "the node exited"; fi
    if [[ -n "$second_pid" ]]; then alive "$second_pid" || { step_log="$work/second.log" && die "the second engine exited"; }; fi
    if [[ "$second_engine" == 1 ]]; then second_engine_tick; fi
  fi
  if [[ "$second_engine" == 1 ]]; then anvil_probe; fi
  alive "$console_pid" || { step_log="$work/console.log" && die "the console exited"; }
  # In the background, so a signal's trap runs at once.
  sleep 2 &
  wait "$!" || true
done
