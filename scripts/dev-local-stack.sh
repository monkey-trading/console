#!/usr/bin/env bash
# Runs a local trading stack for the console, from a fresh chain and a fresh node log each time:
#   1. Anvil (chain 31337) with the mock USDC and the vault at the addresses config/anvil.toml
#      names, the vault signed for by the node's published mock enclave key;
#   2. the house's capital deposited into the vault, and mock USDC minted to a dev wallet;
#   3. an engine node on EVM custody that prices BTC-USD and ETH-USD from live crypto venues,
#      screens through the local synthetic access source, and posts checkpoints on-chain, so
#      withdrawals are authorized and claimable on the vault;
#   4. the console in live-dev mode against that node.
# It prints what to add to the wallet, then runs until Ctrl-C, which stops everything it started.
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
#   CONSOLE_BUILD    `dev` (default) runs next dev; `production` runs npm run build, then next start
#   STACK_INFO_FILE  a path to write the stack's addresses and keys to as JSON while it is up
#   KEEP_WORK=1      keep the private work directory (configs and logs) on exit
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
anvil_port="${ANVIL_PORT:-8545}"
api_port="${API_PORT:-8080}"
console_port="${CONSOLE_PORT:-3000}"
metrics_port="${METRICS_PORT:-9464}"
access_port="${ACCESS_SOURCE_PORT:-18846}"
console_build="${CONSOLE_BUILD:-dev}"
rpc="http://127.0.0.1:$anvil_port"
# The node serves its API over TLS with a key it generates at startup, so curl skips verification.
api="https://127.0.0.1:$api_port"
# The node allows this browser origin only.
console_url="http://localhost:$console_port"
metrics_url="http://127.0.0.1:$metrics_port/metrics"
# Whole USDC; the token has 6 decimals.
usdc_units=1000000
house_usdc=5000000
dev_usdc=100000

work=""
step_log=""
anvil_pid=""
access_pid=""
node_pid=""
console_pid=""
info_written=""

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
for port in "$anvil_port" "$api_port" "$console_port" "$metrics_port" "$access_port"; do
  if ! [[ "$port" =~ ^[0-9]+$ ]] || ((port < 1 || port > 65535)); then die "not a port: $port"; fi
  if port_answers "$port"; then
    die "something already answers on port $port; stop it or choose another port (see the header)"
  fi
done
[[ "$(printf '%s\n' "$anvil_port" "$api_port" "$console_port" "$metrics_port" "$access_port" | sort -u | wc -l | tr -d ' ')" == 5 ]] ||
  die "ANVIL_PORT, API_PORT, CONSOLE_PORT, METRICS_PORT and ACCESS_SOURCE_PORT must differ"
if [[ -n "${DEV_WALLET:-}" ]]; then
  [[ "$DEV_WALLET" =~ ^0x[0-9a-fA-F]{40}$ ]] || die "DEV_WALLET must be a 0x address: $DEV_WALLET"
fi
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
# The node's published mock enclave key (tee.use_published_mock_key): 32 bytes of 0x43. The vault
# checks checkpoints and withdrawal authorizations against it.
enclave="$(address 0x4343434343434343434343434343434343434343434343434343434343434343)"

step "Write the node config"
step_log="$work/config.log"
# dev.toml with EVM custody, as config/anvil.toml has it, against Anvil itself: the three
# providers must have distinct URLs, and Anvil ignores the query that sets them apart.
python3 - "$engine_dir/config" "$work" "$rpc" "$api_port" "$metrics_port" "$console_port" "$access_port" \
  "$relayer" "$deployer" >"$work/config-values" 2>"$step_log" <<'PY' || die "could not write the node config"
import json
import re
import sys
import tomllib
from pathlib import Path

config, work, rpc, api, metrics, console, access, relayer, source = sys.argv[1:]
cfg = tomllib.loads(Path(config, "dev.toml").read_text())
anvil = tomllib.loads(Path(config, "anvil.toml").read_text())

# Live venues sequence about 30 price commands a second, so a checkpoint, and with it a
# withdrawal authorization, comes every few seconds.
cfg["node"].update(listen=f"127.0.0.1:{api}", log_dir=f"{work}/log", auth="eip712", checkpoint_every=100)
cfg["api"]["allowed_origins"] = [f"http://localhost:{console}"]
cfg["history"]["dir"] = f"{work}/history"
cfg["metrics"]["listen"] = f"127.0.0.1:{metrics}"
cfg["alerts"]["outbox"]["dir"] = f"{work}/alerts"
cfg["alerts"]["critical"] = {"url_env": "ENGINE_ALERTS_CRITICAL_URL"}
cfg["custody"] = anvil["custody"]
evm = cfg["custody"]["evm"]
evm["providers"] = [{"name": f"local-{name}", "rpc_url": f"{rpc}/?provider={name}"} for name in "abc"]
evm["cursor_path"] = f"{work}/custody-cursor.json"
# Live crypto venues price BTC-USD and ETH-USD; markets with no venue stay unpriced.
cfg["feeds"]["provider"] = "venues"
# With EVM custody, house capital comes from vault deposits to the house.
cfg["genesis"]["house_capital"] = "0"
cfg["checkpoints"] = {"rpc_url": rpc, "relayer": relayer, "retry_interval": "500ms", "rpc_timeout": "5s"}
cfg["access"] = {"source": source, "endpoint": f"http://127.0.0.1:{access}", "timeout": "2s", "max_age": "30s",
                 "max_response_bytes": 4096, "max_in_flight": 8}

def key(name):
    return name if re.fullmatch(r"[A-Za-z0-9_-]+", name) else json.dumps(name)

def value(item):
    if isinstance(item, bool):
        return "true" if item else "false"
    if isinstance(item, int):
        return str(item)
    if isinstance(item, str):
        return json.dumps(item)
    if isinstance(item, list):
        return "[" + ", ".join(map(value, item)) + "]"
    if isinstance(item, dict):
        return "{ " + ", ".join(f"{key(k)} = {value(v)}" for k, v in item.items()) + " }"
    raise TypeError(f"no TOML writer for {item!r}")

def table(section, path, lines):
    lines += [f"{key(k)} = {value(v)}" for k, v in section.items() if not isinstance(v, dict)]
    for k, v in section.items():
        if isinstance(v, dict):
            lines += ["", "[" + ".".join(map(key, path + [k])) + "]"]
            table(v, path + [k], lines)

lines = []
table(cfg, [], lines)
text = "\n".join(lines).lstrip("\n") + "\n"
assert tomllib.loads(text) == cfg, "the written config does not read back the same"
Path(work, "node.toml").write_text(text)
heartbeat = re.fullmatch(r"(\d+)(ms|s)", cfg["api"]["heartbeat_interval"])
assert heartbeat, "api.heartbeat_interval is not whole seconds or milliseconds"
ms = int(heartbeat[1]) * (1 if heartbeat[2] == "ms" else 1000)
venues = sorted({s["market"] for c in cfg["feeds"]["venues"]["connections"] for s in c["symbols"]})
print(cfg["custody"]["vault"].lower(), evm["usdc"].lower(), ms, json.dumps(venues, separators=(",", ":")))
PY
read -r vault usdc heartbeat_ms venue_markets <"$work/config-values"

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
# The MONKEY period budget, 1 MONKEY, is a development value, not an approved production parameter.
deployed_vault="$(create --private-key "$deployer_key" src/Vault.sol:Vault \
  --constructor-args "$deployed_usdc" "$enclave" "$governance" 1000000000000000000)"
lower() { tr '[:upper:]' '[:lower:]' <<<"$1"; }
[[ "$(lower "$deployed_usdc")" == "$usdc" ]] || die "the mock USDC deployed at $deployed_usdc, not at $usdc as config/anvil.toml names"
[[ "$(lower "$deployed_vault")" == "$vault" ]] || die "the vault deployed at $deployed_vault, not at $vault as config/anvil.toml names"
usdc="$deployed_usdc"
vault="$deployed_vault"
signer="$(cast call "$vault" 'checkpointSigner()(address)' --rpc-url "$rpc")"
[[ "$(lower "$signer")" == "$(lower "$enclave")" ]] || die "the vault's signer is $signer, not the mock enclave $enclave"

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
(cd "$work" && exec "$engine" run --config "$work/node.toml") >"$step_log" 2>&1 &
node_pid=$!
node_up() {
  alive "$node_pid" || die "the node exited"
  [[ "$(curl -sk --max-time 2 "$api/v1/health" 2>/dev/null)" == ok ]]
}
poll 120 node_up || die "the node did not report healthy on $api/v1/health"
attested="$(curl -sk --max-time 5 "$api/v1/attestation" | jq -r '.enclave_address // empty')"
[[ "$(lower "$attested")" == "$(lower "$enclave")" ]] || die "the node attests enclave ${attested:-none}, not the vault's signer $enclave"
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
export NEXT_PUBLIC_ENGINE_HEARTBEAT_MS="$heartbeat_ms"
export NEXT_PUBLIC_ENGINE_RPC_URL="$rpc"
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
    --arg usdc "$usdc" --arg devWallet "$dev_wallet" --arg devWalletKey "$dev_wallet_key" --arg houseKey "$house_key" \
    --arg deployerKey "$deployer_key" --arg workDir "$work" --arg nodeLog "$work/node.log" --arg metricsUrl "$metrics_url" \
    '{consoleUrl: $consoleUrl, apiOrigin: $apiOrigin, rpcUrl: $rpcUrl, chainId: 31337, vault: $vault, usdc: $usdc,
      devWallet: $devWallet, devWalletKey: (if $devWalletKey == "" then null else $devWalletKey end),
      houseKey: $houseKey, deployerKey: $deployerKey, workDir: $workDir, nodeLog: $nodeLog, metricsUrl: $metricsUrl}' \
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
Enclave signer     $enclave (the node's published mock key)

Priced markets     ${priced:-none yet}
Awaiting quotes    ${waiting:-none} (live crypto venues)
Unpriced markets   ${unfed:-none} (no market-data vendor keys)

Deposits           Approve the vault and deposit from the console. The node sees a deposit a few
                   blocks (seconds) after it is mined; it stays pending until the wallet signs its
                   eligibility declaration, then it is credited.
Withdrawals        The engine approves a withdrawal; the next checkpoint (every 100 commands, a few
                   seconds) is posted to the vault, and the console then claims it on the vault.

Node log           $work/node.log
Metrics            $metrics_url
EOF
[[ "${KEEP_WORK:-0}" == 1 ]] || echo "The work directory is removed on exit; set KEEP_WORK=1 to keep it."

# Stops the stack when any part of it exits.
while :; do
  alive "$anvil_pid" || { step_log="$work/anvil.log" && die "Anvil exited"; }
  alive "$access_pid" || { step_log="$work/access-source.log" && die "the access source exited"; }
  alive "$node_pid" || { step_log="$work/node.log" && die "the node exited"; }
  alive "$console_pid" || { step_log="$work/console.log" && die "the console exited"; }
  # In the background, so a signal's trap runs at once.
  sleep 2 &
  wait "$!" || true
done
