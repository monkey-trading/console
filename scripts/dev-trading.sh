#!/usr/bin/env bash
# The trading dev scenario: starts a private engine dev node (mock TEE, mock custody, mock feeds,
# EIP-712 client auth, and the synthetic loopback access source that clears every screening) and
# trades against it through the console's store and actions: a fixed-key wallet funds itself
# through the mock-custody dev endpoint, declares eligibility, fills a market order at the streamed
# executable quote sent as the quoted price with a slippage bound, rests and cancels a limit order,
# closes a position reduce only at the streamed closing price, and is closed out when the
# operator's upsert-market raises the margin tier past its equity.
#
# Needs Node, curl, python3 (3.11 or later), and either ENGINE_BIN (a built `engine` binary with
# the access_source example built beside it) with ENGINE_DIR (the engine checkout holding
# config/dev.toml), or just ENGINE_DIR to build and run them with Cargo; set CARGO_CMD to prefix
# Cargo (for example a build-slot wrapper). The node runs on private temporary data,
# TRADING_API_PORT (default 18080), and the internet, for the node's Roughtime servers.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
engine_dir="$(cd "${ENGINE_DIR:?ENGINE_DIR is the engine checkout}" && pwd)"
[[ -z "${ENGINE_BIN:-}" ]] || ENGINE_BIN="$(cd "$(dirname "$ENGINE_BIN")" && pwd)/$(basename "$ENGINE_BIN")"
api_port="${TRADING_API_PORT:-18080}"
access_port="${TRADING_ACCESS_PORT:-28846}"
metrics_port="${TRADING_METRICS_PORT:-19464}"
work="$(mktemp -d)"
node_pid=""
access_pid=""
cleanup() {
  # Quietly: bash reports each child a signal stops.
  [[ -z "$node_pid" ]] || { kill "$node_pid" 2>/dev/null || true; wait "$node_pid" 2>/dev/null || true; }
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
python3 - "$engine_dir/config/dev.toml" "$work/node.toml" "$api_port" "$access_port" "$metrics_port" <<'PY' || { echo "FAIL: could not write the node config" >&2; exit 1; }
import json
import sys
import tomllib
from pathlib import Path

src, out, api, access, metrics = sys.argv[1:]
cfg = tomllib.loads(Path(src).read_text())
cfg["node"]["listen"] = f"127.0.0.1:{api}"
cfg["node"]["auth"] = "eip712"
cfg["metrics"]["listen"] = f"127.0.0.1:{metrics}"
# Anvil account 0, the published access-source test authority the fixture signs with.
cfg["access"] = {"source": "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "endpoint": f"http://127.0.0.1:{access}",
                 "timeout": "2s", "max_age": "30s", "max_response_bytes": 4096, "max_in_flight": 8}

def key(name):
    return name if name.isalnum() or "_" in name or "-" in name else json.dumps(name)

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
if [[ -n "${ENGINE_BIN:-}" ]]; then
  access_source="$(dirname "$ENGINE_BIN")/examples/access_source"
  [[ -x "$access_source" ]] || { echo "FAIL: $access_source is not built; build the access_source example or run without ENGINE_BIN" >&2; exit 1; }
  "$ENGINE_BIN" run --config "$node_config" > "$work/node.log" 2>&1 &
else
  # shellcheck disable=SC2086
  (cd "$engine_dir" && ${CARGO_CMD:-} cargo build -p engine-node --example access_source >&2)
  access_source="${CARGO_TARGET_DIR:-$engine_dir/target}/debug/examples/access_source"
  "${CARGO_TARGET_DIR:-$engine_dir/target}/debug/engine" run --config "$node_config" > "$work/node.log" 2>&1 &
fi
node_pid=$!

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
ENGINE_NODE_URL="$api" ENGINE_BIN="${ENGINE_BIN:-$engine_dir/target/debug/engine}" NODE_CONFIG="$node_config" SCENARIO_WORK="$work" \
  nice -n 10 npx vitest run --config vitest.live.config.ts scripts/live/dev-trading.live.test.ts
echo "PASS: funded, declared, filled at the streamed quote with the slippage bound, rested and cancelled, closed reduce only, and traded through a close-out"
