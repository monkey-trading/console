#!/usr/bin/env bash
# The trading dev scenario: starts a private engine dev node (mock TEE, mock custody, mock feeds,
# EIP-712 client auth, and the synthetic loopback access source that clears every screening) and
# trades against it through the console's store and actions: a fixed-key wallet funds itself
# through the mock-custody dev endpoint, declares eligibility, fills a market order at the streamed
# executable quote sent as the quoted price with a slippage bound, rests and cancels a limit order,
# and closes a position reduce only at the streamed closing price. It then opens BTC-USD and
# EUR-USD positions, checks each partial close's preview is a bound the fill meets, restarts the
# node with their mock mids raised and ETH-USD's, which closes out an ETH-USD short, and after the
# fee's 15-minute curve checks each whole close's preview equals the fill: price, fee and cash move.
# It runs for about twenty minutes. The private genesis quotes every mock market every 3 s and keeps
# a quote fresh for 10 s on BTC-USD, ETH-USD and EUR-USD, so the index holds between a quote and its
# fill, and keeps EUR-USD open every day.
#
# TRADING_SCENARIO=tiers runs the volume tier scenario instead, on a node whose genesis names a tier table
# a fresh wallet climbs in a few minutes (scripts/live/dev-volume-tier.live.test.ts): a fresh wallet at tier 0
# sees its leverage, best-price size and order limit at the ticket, is stopped past each, trades to tier 1
# and withdraws, its fee discount, financing discount and emissions boost are read, and each figure the panel, the ticket and the
# withdraw form show equals the account read.
#
# Needs Node, curl, python3 (3.11 or later), and either ENGINE_BIN (a built `engine` binary with
# the access_source example built beside it) with ENGINE_DIR (the engine checkout holding
# config/dev.toml), or just ENGINE_DIR to build and run them with Cargo; set CARGO_CMD to prefix
# Cargo (for example a build-slot wrapper). The node runs on private temporary data,
# TRADING_API_PORT (default 18080), and the internet, for the node's Roughtime servers.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
engine_dir="$(cd "${ENGINE_DIR:?ENGINE_DIR is the engine checkout}" && pwd)"
if [[ -n "${ENGINE_BIN:-}" ]]; then
  engine_bin="$(cd "$(dirname "$ENGINE_BIN")" && pwd)/$(basename "$ENGINE_BIN")"
else
  # One resolved path serves the node, the tests' admin CLI, and the example beside it. The target
  # directory is whatever Cargo resolves — CARGO_TARGET_DIR or build.target-dir move it — so ask
  # `cargo metadata`, as the local stack does.
  # shellcheck disable=SC2086
  target_dir="$( (cd "$engine_dir" && ${CARGO_CMD:-} cargo metadata --format-version 1 --no-deps) | python3 -c 'import json, sys; print(json.load(sys.stdin)["target_directory"])')"
  engine_bin="$target_dir/debug/engine"
fi
access_source="$(dirname "$engine_bin")/examples/access_source"
scenario="${TRADING_SCENARIO:-trading}"
case "$scenario" in
  trading) test_file=scripts/live/dev-trading.live.test.ts ;;
  tiers) test_file=scripts/live/dev-volume-tier.live.test.ts ;;
  *) echo "FAIL: TRADING_SCENARIO is trading or tiers, not $scenario" >&2; exit 1 ;;
esac
api_port="${TRADING_API_PORT:-18080}"
access_port="${TRADING_ACCESS_PORT:-28846}"
metrics_port="${TRADING_METRICS_PORT:-19464}"
work="$(mktemp -d)"
node_pid=""
access_pid=""
cleanup() {
  # Quietly: bash reports each child a signal stops.
  [[ -z "$node_pid" ]] || { kill "$node_pid" 2>/dev/null || true; wait "$node_pid" 2>/dev/null || true; }
  # The node the test restarted, if it did: its PID is the one the test recorded.
  if [[ -s "$work/node.pid" && "$(cat "$work/node.pid")" != "$node_pid" ]]; then
    restarted="$(cat "$work/node.pid")"
    kill "$restarted" 2>/dev/null || true
    for _ in $(seq 1 50); do kill -0 "$restarted" 2>/dev/null || break; sleep 0.2; done
  fi
  [[ -z "$access_pid" ]] || { kill "$access_pid" 2>/dev/null || true; wait "$access_pid" 2>/dev/null || true; }
  rm -rf "$work"
}
trap cleanup EXIT

api="https://127.0.0.1:$api_port"
# A node already on the port would answer the health check below in place of the one started here.
[[ "$(curl -sk --max-time 2 "$api/v1/health" || true)" == ok ]] && { echo "FAIL: something already answers on $api; stop it or choose another TRADING_API_PORT" >&2; exit 1; }

# The private config is dev.toml with the API, access source and metrics on this scenario's ports
# and EIP-712 client auth, so the node verifies every signed request the console sends it. The
# access source is the synthetic loopback fixture that clears every screening, as the local stack
# runs it.
python3 - "$engine_dir/config/dev.toml" "$work/node.toml" "$api_port" "$access_port" "$metrics_port" "$scenario" <<'PY' || { echo "FAIL: could not write the node config" >&2; exit 1; }
import json
import re
import sys
import tomllib
from pathlib import Path

src, out, api, access, metrics, scenario = sys.argv[1:]
cfg = tomllib.loads(Path(src).read_text())
cfg["node"]["listen"] = f"127.0.0.1:{api}"
cfg["node"]["auth"] = "eip712"
# One mock quote every 3 s, fresh for 10 s on the scenario's markets, so the index holds between a quote and its fill.
cfg["feeds"]["interval"] = "3s"
for market in cfg["genesis"]["markets"]:
    if market["id"] in (1, 2, 10):
        market["price_rules"]["max_age_ms"] = 10000
    # EUR-USD trades every day here, so the scenario runs on a weekend too.
    if market["id"] == 10:
        market["schedule"] = {"kind": "always_open"}
if scenario == "tiers":
    # The production genesis's shares, margin floors (5%, 2%, none) and the shape of its limits, with thresholds a fresh
    # wallet reaches in minutes: $50,000 of counted volume in a day takes tier 1, $5,000,000 tier 2. The orders a tier
    # rests and the requests a second it sends are small, so a few orders reach the limit and a short burst reaches the rate.
    # From V68 tiers 1 and 2 take 10% and 20% off the profit fee, 5% and 10% off the financing markup, and weigh emissions 1.1 and 1.25 times.
    cfg["genesis"]["params"]["volume_tiers"] = [
        {"threshold": "0", "day_divisor": 1, "best_price_share_bps": 2500, "margin_floor_bps": 500, "max_resting_orders": 3, "requests_per_second": 3},
        {"threshold": "50000", "day_divisor": 1, "best_price_share_bps": 5000, "margin_floor_bps": 200, "max_resting_orders": 5, "requests_per_second": 6,
         "fee_discount_bps": 1000, "financing_discount_bps": 500, "emissions_boost_bps": 1000},
        {"threshold": "5000000", "day_divisor": 1, "best_price_share_bps": 10000, "max_resting_orders": 10, "requests_per_second": 12,
         "fee_discount_bps": 2000, "financing_discount_bps": 1000, "emissions_boost_bps": 2500},
    ]
cfg["metrics"]["listen"] = f"127.0.0.1:{metrics}"
# Anvil account 0, the published access-source test authority the fixture signs with.
cfg["access"] = {"source": "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "endpoint": f"http://127.0.0.1:{access}",
                 "timeout": "2s", "max_age": "30s", "max_response_bytes": 4096, "max_in_flight": 8,
                 "max_in_flight_per_account": 2, "max_in_flight_per_client": 4, "reserved_in_flight": 2}

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
Path(out).write_text(text)
PY
node_config="$work/node.toml"

# The node writes data/dev under its working directory.
cd "$work"
# Cargo builds whenever ENGINE_BIN is unset: its incremental checks make the no-op case cheap,
# and this never reports PASS against binaries that predate the source in ENGINE_DIR.
if [[ -z "${ENGINE_BIN:-}" ]]; then
  # shellcheck disable=SC2086
  (cd "$engine_dir" && ${CARGO_CMD:-} cargo build -p engine-node --bin engine --example access_source >&2)
fi
[[ -x "$access_source" ]] || { echo "FAIL: $access_source is not built; build the access_source example beside $engine_bin" >&2; exit 1; }
"$engine_bin" run --config "$node_config" > "$work/node.log" 2>&1 &
node_pid=$!
# The test restarts the node by this PID, and records the new one here.
echo "$node_pid" > "$work/node.pid"

printf '%s\n' '{"mode":"clear","jurisdictions":{},"sanctioned":[]}' >"$work/access-fixture.json"
"$access_source" "127.0.0.1:$access_port" 31337 0x0000000000000000000000000000000000000000 "$work/access-fixture.json" >"$work/access-source.log" 2>&1 &
access_pid=$!

for _ in $(seq 1 90); do
  kill -0 "$node_pid" 2>/dev/null || { echo "FAIL: the dev node exited" >&2; tail -20 "$work/node.log" >&2; exit 1; }
  kill -0 "$access_pid" 2>/dev/null || { echo "FAIL: the access source exited" >&2; tail -20 "$work/access-source.log" >&2; exit 1; }
  [[ "$(curl -sk --max-time 2 "$api/v1/health" || true)" == ok ]] && break
  sleep 1
done
[[ "$(curl -sk --max-time 2 "$api/v1/health" || true)" == ok ]] || { echo "FAIL: the dev node did not start" >&2; tail -20 "$work/node.log" >&2; exit 1; }

cd "$root"
# The dev node's certificate is self-signed; the scenario's proxy forwards to it without checking.
if ! ENGINE_NODE_URL="$api" ENGINE_BIN="$engine_bin" NODE_CONFIG="$node_config" SCENARIO_WORK="$work" \
  nice -n 10 npx vitest run --config vitest.live.config.ts "$test_file"; then
  # The work directory is removed on exit, so a failed run prints the logs that explain it.
  echo "--- the last lines of $work/node.log ---" >&2
  tail -n 40 "$work/node.log" >&2
  echo "--- the last lines of $work/access-source.log ---" >&2
  tail -n 20 "$work/access-source.log" >&2
  exit 1
fi
if [[ "$scenario" == tiers ]]; then
  echo "PASS: a fresh wallet's tier 0 limits at the ticket, stopped past its leverage and order limit and over its request rate, traded to tier 1 and withdrew, every figure equal to the account read"
  exit 0
fi
echo "PASS: funded, declared, filled at the streamed quote with the slippage bound, rested and cancelled, closed reduce only, priced partial closes as bounds and whole closes exactly in BTC-USD and EUR-USD, and traded through a close-out"
