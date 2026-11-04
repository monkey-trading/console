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
# `scripts/dev-local-stack-ctl.sh` drives it (see the README): the first engine runs under sealed
# keys with operator rotation on, a second engine is registered as a candidate and starts once an
# election has put its release in the vault's hands, and two wallets hold MONKEY to stake.
#
# Needs anvil, forge, cast, cargo, node, npm, curl, jq and python3 (3.11 or later); the engine
# checkout with its contract dependencies (`forge soldeer install` in its contracts/); the
# console's node_modules (`npm ci`); and the internet, for the node's Roughtime servers and venues.
#
# Environment:
#   ENGINE_DIR       the engine checkout (default: `engine` beside the console's main checkout)
#   CARGO_CMD        a prefix for every Cargo command, such as a build-slot wrapper (default: none)
#   ANVIL_PORT, API_PORT, CONSOLE_PORT, METRICS_PORT, ACCESS_SOURCE_PORT
#                    override 8545, 8080, 3000, 9464 and 18846; each must be free
#   DEV_WALLET       an address of your own to fund with mock USDC and ETH, instead of Anvil account 1
#   SECOND_ENGINE    `1` runs the two-engine option described above (default: off, one engine)
#   SECOND_API_PORT, SECOND_METRICS_PORT, HANDOVER_PORT, SECOND_HANDOVER_PORT
#                    with SECOND_ENGINE=1, override 8081, 9465, 9443 and 9444; each must be free
#   DEV_WALLET2      with SECOND_ENGINE=1, the second staking wallet, instead of Anvil account 3
#   STAKING_EPOCH_SECS
#                    the MONKEY distribution epoch and unstake cooldown, in seconds (default 300)
#   CONSOLE_BUILD    `dev` (default) runs next dev; `production` runs npm run build, then next start
#   STACK_INFO_FILE  a path to write the stack's addresses and keys to as JSON while it is up (with
#                    SECOND_ENGINE=1, default `monkey-local-stack.json` in the temporary directory,
#                    which `dev-local-stack-ctl.sh` reads)
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
second_api_port="${SECOND_API_PORT:-8081}"
second_metrics_port="${SECOND_METRICS_PORT:-9465}"
handover_port="${HANDOVER_PORT:-9443}"
second_handover_port="${SECOND_HANDOVER_PORT:-9444}"
rpc="http://127.0.0.1:$anvil_port"
# The node serves its API over TLS with a key it generates at startup, so curl skips verification.
api="https://127.0.0.1:$api_port"
second_api="https://127.0.0.1:$second_api_port"
# The node allows this browser origin only.
console_url="http://localhost:$console_port"
metrics_url="http://127.0.0.1:$metrics_port/metrics"
# Whole USDC; the token has 6 decimals.
usdc_units=1000000
house_usdc=5000000
dev_usdc=100000
# MONKEY staking, development values and not approved production parameters: a five-minute
# distribution epoch, an unstake cooldown of the same length (the staking contract refuses one
# shorter than its epoch), and a liquidity floor 100000 USDC under the house's capital, so the first
# epoch that closes with a stake pays the stakers that excess. With SECOND_ENGINE=1 the floor is the
# house's capital instead, so only what `dev-local-stack-ctl.sh fund-house` adds, or clients lose,
# is paid, and the candidates' self-bonds do not take the first epoch's excess before a wallet stakes.
staking_epoch_secs="${STAKING_EPOCH_SECS:-300}"
staking_cooldown_secs="$staking_epoch_secs"
staking_floor_usdc=4900000
if [[ "$second_engine" == 1 ]]; then staking_floor_usdc=$house_usdc; fi
# The two-engine option's registry, in development values within the bounds given at its deployment: an
# election epoch of a minute, no minimum term, a one-minute finality margin, a 1 MONKEY self-bond (a
# larger one would take a share of every distribution), and the seven-day notice the contract fixes.
registry_epoch_secs=60
candidate_bond_monkey=1
# Each staking wallet's MONKEY, minted by the vault in place of emission claims; the token's cap,
# which follows the period budget, bounds the total. The election's thresholds are shares of the
# stake, not of the supply, so they need no scaling with the budget.
wallet_monkey=20000
# The two releases' launch measurements: the mock TEE's stand-ins, which its sealing derives keys from.
first_digest_byte=5a
second_digest_byte=71

work=""
step_log=""
anvil_pid=""
access_pid=""
node_pid=""
console_pid=""
info_written=""
second_pid=""

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
  # The node drains on TERM; give it time to finish its log.
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
[[ -d "$engine_dir/contracts/dependencies" ]] ||
  die "the vault's dependencies are not installed: run \`forge soldeer install\` in $engine_dir/contracts, then run this again"
[[ -x "$root/node_modules/.bin/next" ]] || die "the console's dependencies are not installed: run \`npm ci\` in $root"
[[ "$console_build" == dev || "$console_build" == production ]] || die "CONSOLE_BUILD must be dev or production: $console_build"
[[ "$second_engine" == 0 || "$second_engine" == 1 ]] || die "SECOND_ENGINE must be 0 or 1: $second_engine"
ports=("$anvil_port" "$api_port" "$console_port" "$metrics_port" "$access_port")
[[ "$second_engine" == 0 ]] || ports+=("$second_api_port" "$second_metrics_port" "$handover_port" "$second_handover_port")
for port in "${ports[@]}"; do
  if ! [[ "$port" =~ ^[0-9]+$ ]] || ((port < 1 || port > 65535)); then die "not a port: $port"; fi
  if port_answers "$port"; then
    die "something already answers on port $port; stop it or choose another port (see the header)"
  fi
done
[[ "$(printf '%s\n' "${ports[@]}" | sort -u | wc -l | tr -d ' ')" == "${#ports[@]}" ]] ||
  die "ANVIL_PORT, API_PORT, CONSOLE_PORT, METRICS_PORT, ACCESS_SOURCE_PORT and, with SECOND_ENGINE=1, the second engine's ports must differ"
[[ "$staking_epoch_secs" =~ ^[1-9][0-9]*$ ]] || die "STAKING_EPOCH_SECS must be a positive whole number of seconds: $staking_epoch_secs"
if [[ -n "${DEV_WALLET:-}" ]]; then
  [[ "$DEV_WALLET" =~ ^0x[0-9a-fA-F]{40}$ ]] || die "DEV_WALLET must be a 0x address: $DEV_WALLET"
fi
if [[ "$second_engine" == 1 && -z "${STACK_INFO_FILE:-}" ]]; then STACK_INFO_FILE="${TMPDIR:-/tmp}/monkey-local-stack.json"; fi
if [[ -n "${STACK_INFO_FILE:-}" ]]; then rm -f "$STACK_INFO_FILE"; fi

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
work="$(mktemp -d "${TMPDIR:-/tmp}/local-stack.XXXXXX")"

# Built first, so a slow build cannot leave the chain's head stale by the time the node starts.
step "Build the node and the local access source"
cargo_run build --locked -p engine-node --bin engine --example access_source --manifest-path "$engine_dir/Cargo.toml"
# Wherever Cargo put it: `CARGO_TARGET_DIR` or `build.target-dir` may move the target directory.
target="$(cargo_run metadata --format-version 1 --no-deps --manifest-path "$engine_dir/Cargo.toml" | jq -r .target_directory)"
engine="$target/debug/engine"
access_source="$target/debug/examples/access_source"
step_log="$work/forge-build.log"
(cd "$engine_dir/contracts" && nice -n 10 forge build) >"$step_log" 2>&1 || die "the contracts did not build"

# Anvil's default test mnemonic: account 0 deploys and signs the synthetic access source's
# screenings, 1 is the dev wallet, 2 funds the house, and 9 relays checkpoints.
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
fi
# The node's published mock enclave key (tee.use_published_mock_key): 32 bytes of 0x43. The vault
# checks checkpoints and withdrawal authorizations against it.
enclave="$(address 0x4343434343434343434343434343434343434343434343434343434343434343)"

# The deployer's third transaction deploys the operator registry, and the registry's first creation
# is the staking contract it owns, so the node's config can name both before they exist; the deploy
# step checks them.
registry="$(cast compute-address "$deployer" --nonce 2 | awk '{print $NF}')"
staking="$(cast compute-address "$registry" --nonce 1 | awk '{print $NF}')"

step "Write the node config"
step_log="$work/config.log"
# dev.toml with EVM custody, as config/anvil.toml has it, against Anvil itself: the three
# providers must have distinct URLs, and Anvil ignores the query that sets them apart.
STACK_SCRIPTS="$root/scripts" python3 - "$engine_dir/config" "$work" "$rpc" "$api_port" "$metrics_port" "$console_port" "$access_port" \
  "$relayer" "$deployer" "$registry" "$staking" >"$work/config-values" 2>"$step_log" <<'PY' || die "could not write the node config"
import json
import os
import re
import sys
import tomllib
from pathlib import Path

sys.path.insert(0, os.environ["STACK_SCRIPTS"])
from stack_toml import dumps  # noqa: E402

config, work, rpc, api, metrics, console, access, relayer, source, registry, staking = sys.argv[1:]
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
evm["staking"] = {"contract": staking, "cursor_path": f"{work}/staking-cursor.json", "registry": {"contract": registry}}
# Live crypto venues price BTC-USD and ETH-USD; markets with no venue stay unpriced.
cfg["feeds"]["provider"] = "venues"
# With EVM custody, house capital comes from vault deposits to the house.
cfg["genesis"]["house_capital"] = "0"
cfg["checkpoints"] = {"rpc_url": rpc, "relayer": relayer, "retry_interval": "500ms", "rpc_timeout": "5s"}
cfg["access"] = {"source": source, "endpoint": f"http://127.0.0.1:{access}", "timeout": "2s", "max_age": "30s",
                 "max_response_bytes": 4096, "max_in_flight": 8}

Path(work, "node.toml").write_text(dumps(cfg))
heartbeat = re.fullmatch(r"(\d+)(ms|s)", cfg["api"]["heartbeat_interval"])
assert heartbeat, "api.heartbeat_interval is not whole seconds or milliseconds"
ms = int(heartbeat[1]) * (1 if heartbeat[2] == "ms" else 1000)
venues = sorted({s["market"] for c in cfg["feeds"]["venues"]["connections"] for s in c["symbols"]})
print(cfg["custody"]["vault"].lower(), evm["usdc"].lower(), ms, json.dumps(venues, separators=(",", ":")))
PY
read -r vault usdc heartbeat_ms venue_markets <"$work/config-values"

if [[ "$second_engine" == 1 ]]; then
  step "Write the two engines' configs"
  step_log="$work/engines.log"
  # The registry names each engine's release by its config's hash, so the configs are final here.
  second_admin_public="0x04$(cast wallet public-key --private-key "$second_admin_key" | sed 's/^0x//')"
  hashes="$(python3 "$root/scripts/stack_engines.py" "$work" "$handover_port" "$second_api_port" "$second_metrics_port" \
    "$second_handover_port" "$second_admin_public" 2>"$step_log")" || die "could not write the two engines' configs"
  read -r first_config_hash second_config_hash <<<"$hashes"
fi

step "Start Anvil on $rpc"
step_log="$work/anvil.log"
# A block every second and one for each transaction, so wallet transactions and checkpoints land at
# once while deposits keep confirming; with one slot per epoch, the safe and finalized blocks trail
# the head by one and two.
nice -n 10 anvil --host 127.0.0.1 --port "$anvil_port" --chain-id 31337 --block-time 1 --mixed-mining \
  --slots-in-an-epoch 1 --silent >"$step_log" 2>&1 &
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
# The MONKEY period budget, a development value and not an approved production parameter: 190,258
# MONKEY, which caps the supply at about 10 billion (twice 26,280 periods of it).
monkey_period_budget=190258000000000000000000
# The exit period, claim window, and deposit staleness are thirty days each, past anything this
# waits for, and past the timelock's one-second delay as the vault's constructor requires.
deployed_vault="$(create --private-key "$deployer_key" src/Vault.sol:Vault \
  --constructor-args "$deployed_usdc" "$enclave" "$governance" "$governance" "$monkey_period_budget" \
  2592000 2592000 2592000)"
[[ "$(lower "$deployed_usdc")" == "$usdc" ]] || die "the mock USDC deployed at $deployed_usdc, not at $usdc as config/anvil.toml names"
[[ "$(lower "$deployed_vault")" == "$vault" ]] || die "the vault deployed at $deployed_vault, not at $vault as config/anvil.toml names"
usdc="$deployed_usdc"
vault="$deployed_vault"
signer="$(cast call "$vault" 'checkpointSigner()(address)' --rpc-url "$rpc")"
[[ "$(lower "$signer")" == "$(lower "$enclave")" ]] || die "the vault's signer is $signer, not the mock enclave $enclave"
monkey="$(cast call "$vault" 'monkey()(address)' --rpc-url "$rpc")"

step "Deploy the operator registry, which deploys the MONKEY staking contract"
# The deployer is the initial operator, and rotation is off at deployment: no election moves the
# operator key, which stays the dev config's (with SECOND_ENGINE=1, rotation goes on below). The election parameters are development values, as
# in the engine's election scenario, within the bounds given after them.
initial_operator="($deployer,$(hex_bytes d0 48),$(hex_bytes c0 32))"
mon=000000000000000000
parameters="(3600,3600,600,1000,500,2000,10,1000$mon,604800)"
minimums="(60,0,0,0,0,0,1,0,60)"
maximums="(2592000,31536000,86400,10000,10000,10000,100,1000000$mon,2592000)"
if [[ "$second_engine" == 1 ]]; then
  # The first engine's own operator key and release are the operator in effect, so the vault's
  # release, which follows the registry once rotation is on, names what the first engine runs.
  initial_operator="($operator,$first_digest,$first_config_hash)"
  parameters="($registry_epoch_secs,0,60,1000,500,2000,10,${candidate_bond_monkey}$mon,604800)"
fi
deployed_registry="$(create --private-key "$deployer_key" src/OperatorRegistry.sol:OperatorRegistry \
  --constructor-args "$monkey" "$staking_cooldown_secs" "$staking_epoch_secs" "$governance" \
  "$initial_operator" "$parameters" "$minimums" "$maximums")"
[[ "$(lower "$deployed_registry")" == "$(lower "$registry")" ]] || die "the registry deployed at $deployed_registry, not at $registry"
deployed_staking="$(cast call "$registry" 'staking()(address)' --rpc-url "$rpc")"
[[ "$(lower "$deployed_staking")" == "$(lower "$staking")" ]] || die "the registry deployed staking at $deployed_staking, not at $staking"
registry="$deployed_registry"
staking="$deployed_staking"

step "Fund the house with $house_usdc USDC in the vault, and the dev wallet with $dev_usdc USDC"
send() { nice -n 10 cast send "$@" --rpc-url "$rpc" >>"$step_log" 2>&1; }
send "$usdc" 'mint(address,uint256)' "$house" $((house_usdc * usdc_units)) --private-key "$deployer_key"
send "$usdc" 'approve(address,uint256)' "$vault" $((house_usdc * usdc_units)) --private-key "$house_key"
send "$vault" 'depositToHouse(uint256)' $((house_usdc * usdc_units)) --private-key "$house_key"
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
  step "Register both engines as candidates, turn rotation on and fund the staking wallets"
  step_log="$work/election-setup.log"
  mkdir -p "$work/second"
  # Sends from an account the node does not hold a key for, such as the operator's or a contract.
  send_as() {
    local from="$1"
    shift
    cast rpc anvil_impersonateAccount "$from" --rpc-url "$rpc" >>"$step_log" 2>&1
    cast rpc anvil_setBalance "$from" 0x56bc75e2d63100000 --rpc-url "$rpc" >>"$step_log" 2>&1
    send "$@" --unlocked --from "$from"
    cast rpc anvil_stopImpersonatingAccount "$from" --rpc-url "$rpc" >>"$step_log" 2>&1
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
    "127.0.0.1:$api_port" "127.0.0.1:$handover_port"
  register_candidate "$second_candidate" "$second_admin_key" "$second_digest" "$second_config_hash" \
    "127.0.0.1:$second_api_port" "127.0.0.1:$second_handover_port"
  mint_monkey "$dev_wallet" "${wallet_monkey}$mon"
  mint_monkey "$dev_wallet2" "${wallet_monkey}$mon"
  if [[ -n "${DEV_WALLET2:-}" ]]; then
    cast rpc anvil_setBalance "$dev_wallet2" 0x56bc75e2d63100000 --rpc-url "$rpc" >>"$step_log" 2>&1
  fi
  send "$usdc" 'mint(address,uint256)' "$dev_wallet2" $((dev_usdc * usdc_units)) --private-key "$deployer_key"
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
node_up() {
  alive "$node_pid" || die "the node exited"
  [[ "$(curl -sk --max-time 2 "$api/v1/health" 2>/dev/null)" == ok ]]
}
if [[ "$second_engine" == 1 ]]; then
  attestation_up() {
    alive "$node_pid" || die "the node exited"
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
  [[ "$(curl -sk --max-time 2 "$api/v1/markets" 2>/dev/null)" != "[]" ]]
}
poll 120 genesis_applied || die "genesis did not apply within two minutes"
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

# Every market a configured venue quotes, BTC-USD among them.
venues_priced() {
  alive "$node_pid" || die "the node exited"
  curl -sk --max-time 2 "$api/v1/markets" 2>/dev/null |
    jq -e --argjson venue "$venue_markets" '[.[] | select(.id as $id | $venue | index($id)) | .mark] | length > 0 and all(. != null)' \
      >/dev/null 2>&1
}
if ! poll 60 venues_priced; then
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
export NEXT_PUBLIC_ENGINE_ORIGIN="$api"
export NEXT_PUBLIC_ENGINE_DEV_ORIGINS="$api"
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
  export NEXT_PUBLIC_ENGINE_CANDIDATE_ORIGINS="$second_api"
  export NEXT_PUBLIC_ENGINE_DEV_ORIGINS="$api,$second_api"
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
  jq -n --arg consoleUrl "$console_url" --arg apiOrigin "$api" --arg rpcUrl "$rpc" --arg vault "$vault" \
    --arg usdc "$usdc" --arg monkey "$monkey" --arg staking "$staking" --arg registry "$registry" \
    --arg devWallet "$dev_wallet" --arg devWalletKey "$dev_wallet_key" --arg houseKey "$house_key" \
    --arg deployerKey "$deployer_key" --arg workDir "$work" --arg nodeLog "$work/node.log" --arg metricsUrl "$metrics_url" \
    --arg secondEngine "$second_engine" --arg secondApiOrigin "$second_api" --arg secondNodeLog "$work/second.log" \
    --arg dev2Wallet "${dev_wallet2:-}" --arg dev2WalletKey "${dev_wallet2_key:-}" --arg payerKey "${payer_key:-}" \
    --arg secondRelease "${second_release:-}" --arg firstRelease "${first_release:-}" \
    --arg operator "${operator:-}" --arg secondCandidate "${second_candidate:-}" \
    '{consoleUrl: $consoleUrl, apiOrigin: $apiOrigin, rpcUrl: $rpcUrl, chainId: 31337, vault: $vault, usdc: $usdc,
      monkey: $monkey, staking: $staking, registry: $registry,
      devWallet: $devWallet, devWalletKey: (if $devWalletKey == "" then null else $devWalletKey end),
      houseKey: $houseKey, deployerKey: $deployerKey, workDir: $workDir, nodeLog: $nodeLog, metricsUrl: $metricsUrl}
      + (if $secondEngine == "1" then {secondApiOrigin: $secondApiOrigin, secondNodeLog: $secondNodeLog,
          secondDevWallet: $dev2Wallet, secondDevWalletKey: (if $dev2WalletKey == "" then null else $dev2WalletKey end),
          payerKey: $payerKey, firstRelease: $firstRelease, secondRelease: $secondRelease,
          operator: $operator, secondCandidate: $secondCandidate} else {} end)' \
    >"$STACK_INFO_FILE.tmp"
  mv "$STACK_INFO_FILE.tmp" "$STACK_INFO_FILE"
  info_written=yes
fi

if [[ -n "$dev_wallet_key" ]]; then
  wallet_line="$dev_wallet (Anvil account 1)
  Private key      $dev_wallet_key
                   A public test key: import it into a dev wallet profile, never use it on a real chain."
else
  wallet_line="$dev_wallet (DEV_WALLET, given 100 ETH for gas)"
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
  two_engines="
Two engines        The first engine ($api) is the operator in effect, under sealed keys.
                   The second ($second_api) is registered with an approved release, and
                   the stack starts it once an election has made the vault name its release;
                   then open $second_api/v1/health once and accept its certificate.
Second wallet      $wallet2_line
MONKEY to stake    Both wallets hold $wallet_monkey MONKEY to stake and delegate on the Staking page; the stack also gave the
                   second wallet $dev_usdc mock USDC.
Drive it           ./scripts/dev-local-stack-ctl.sh status | elect | handover | fund-house <USDC>
                   (reads $STACK_INFO_FILE)
"
else
  rotation_state="rotation off"
  signer_line="$enclave (the node's published mock key)"
  two_engines=""
fi
cat <<EOF

==> The local stack is up. Ctrl-C stops everything it started.

Console            $console_url
                   Open it at localhost, not 127.0.0.1: the node accepts that browser origin only.
Engine API         $api
                   Open $api/v1/health once in the same browser and accept its
                   self-signed certificate, or the console cannot reach the node.

Add the network to MetaMask or Rabby
  Network name     Anvil (local)
  RPC URL          $rpc
  Chain ID         31337
  Currency symbol  ETH

Dev wallet         $wallet_line
Mock USDC          $usdc
                   Add it to the wallet as a custom token (6 decimals); the dev wallet holds $dev_usdc.
Vault              $vault (house capital $house_usdc USDC)
MONKEY token       $monkey (the vault mints it against emissions claims)
Staking contract   $staking (deployed by the operator registry $registry, $rotation_state)
Staking values     Development values, not production parameters: epochs of $((staking_epoch_secs / 60)) minutes from
                   $staking_start, an unstake cooldown of $((staking_cooldown_secs / 60)) minutes, and a liquidity floor of
                   $staking_floor_usdc USDC.
Enclave signer     $signer_line

Priced markets     ${priced:-none yet}
Awaiting quotes    ${waiting:-none} (live crypto venues)
Unpriced markets   ${unfed:-none} (no market-data vendor keys)

Setup              Connecting a wallet opens the console's setup popup: the Anvil faucet, the
                   eligibility declaration, then authorizing the browser.
Deposits           Approve the vault and deposit from the console. The node sees a deposit a few
                   blocks (seconds) after it is mined and credits it; a deposit sent straight to the
                   vault before a declaration stays pending until the wallet signs one.
Withdrawals        The engine approves a withdrawal; the next checkpoint (every 1000 commands, within
                   seconds) is posted to the vault, and the console then claims it on the vault.
MONKEY             Emissions run from $emissions_start: ten-minute budgets accrue to each period's
                   gross realised losses and show in the console once a losing trade closes; claim
                   them on the MONKEY page, then stake. An epoch that closes with a stake while the
                   house's NAV is above the floor pays the excess to the stakers in USDC.

$two_engines
Node log           $work/node.log
Metrics            $metrics_url
EOF
[[ "${KEEP_WORK:-0}" == 1 ]] || echo "The work directory is removed on exit; set KEEP_WORK=1 to keep it."

# What the two-engine option does between the owner's commands. `dev-local-stack-ctl.sh handover`
# makes the vault name the second engine's release at a finalized block, where a node reads it, and
# says so by creating a file; the second engine starts then. The first engine exits once the second
# holds its keys and its log. The stack reads no chain state here: Anvil can deadlock under polling.
second_engine_tick() {
  if [[ -z "$second_pid" && -f "$work/start-second-engine" ]]; then
    step "The vault names the second engine's release: starting it on $second_api (open $second_api/v1/health once and accept its certificate)"
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
  if [[ -n "$node_pid" ]] && ! alive "$node_pid" && [[ -z "$second_pid" ]]; then step_log="$work/node.log" && die "the node exited"; fi
  if [[ -n "$second_pid" ]]; then alive "$second_pid" || { step_log="$work/second.log" && die "the second engine exited"; }; fi
  if [[ "$second_engine" == 1 ]]; then second_engine_tick; anvil_probe; fi
  alive "$console_pid" || { step_log="$work/console.log" && die "the console exited"; }
  # In the background, so a signal's trap runs at once.
  sleep 2 &
  wait "$!" || true
done
