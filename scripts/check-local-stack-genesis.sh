#!/usr/bin/env bash
# Starts the local stack (scripts/dev-local-stack.sh) with GENESIS_FILE and checks that the node accepted that
# genesis: it serves every market the file lists with the file's house cap floors, margin and spread bands,
# serves the file's total cap floor and volume tiers, starts the house with nothing, and that the stack's summary
# and `dev-local-stack-ctl.sh status` name the genesis. The default is the launch genesis,
# config/production-genesis.toml (34 markets, a $61M total floor).
#
# The stack runs on its own ports (default 18545, 18080, 13000, 19464 and 28846; ANVIL_PORT, API_PORT,
# CONSOLE_PORT, METRICS_PORT and ACCESS_SOURCE_PORT move them) and on its own info file, so it never meets a stack
# already running on the defaults. It needs what the stack needs, builds the node (set CARGO_CMD to prefix Cargo, for
# example with a build-slot wrapper), and takes a few minutes. ENGINE_DIR names the engine checkout.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
export GENESIS_FILE="${GENESIS_FILE:-config/production-genesis.toml}"
export ANVIL_PORT="${ANVIL_PORT:-18545}" API_PORT="${API_PORT:-18080}" CONSOLE_PORT="${CONSOLE_PORT:-13000}"
export METRICS_PORT="${METRICS_PORT:-19464}" ACCESS_SOURCE_PORT="${ACCESS_SOURCE_PORT:-28846}"
work="$(mktemp -d "${TMPDIR:-/tmp}/check-stack-genesis.XXXXXX")"
export STACK_INFO_FILE="$work/info.json"
stack_pid=""

die() {
  echo "FAIL: $*" >&2
  [[ ! -f "$work/stack.log" ]] || { echo "--- the last lines of the stack's output ---" >&2; tail -n 30 "$work/stack.log" >&2; }
  exit 1
}
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "$stack_pid" ]] && kill -0 "$stack_pid" 2>/dev/null; then
    # The stack stops everything it started on TERM; give it time to drain the node.
    kill -TERM "$stack_pid" 2>/dev/null || true
    for _ in $(seq 1 200); do kill -0 "$stack_pid" 2>/dev/null || break; sleep 0.2; done
    kill -KILL "$stack_pid" 2>/dev/null || true
    wait "$stack_pid" 2>/dev/null || true
  fi
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "==> Start the stack on $GENESIS_FILE (API port $API_PORT)"
"$root/scripts/dev-local-stack.sh" >"$work/stack.log" 2>&1 &
stack_pid=$!
# The stack writes its info file once the console answers, after the node has applied the genesis.
for _ in $(seq 1 1800); do
  [[ -f "$STACK_INFO_FILE" ]] && break
  kill -0 "$stack_pid" 2>/dev/null || die "the stack exited before it was up"
  sleep 1
done
[[ -f "$STACK_INFO_FILE" ]] || die "the stack was not up within 30 minutes"

api="$(jq -r .apiOrigin "$STACK_INFO_FILE")"
genesis="$(jq -r .genesisFile "$STACK_INFO_FILE")"
echo "==> Check the node's markets against $genesis"
curl -sk --max-time 10 "$api/v1/markets" >"$work/markets.json" || die "the node did not answer /v1/markets"
curl -sk --max-time 10 "$api/v1/house/state" >"$work/house-state.json" || die "the node did not answer /v1/house/state"
curl -sk --max-time 10 "$api/v1/house" >"$work/house.json" || die "the node did not answer /v1/house"
python3 -I - "$genesis" "$work" <<'PY' || die "the node's genesis is not the file's"
import json
import sys
import tomllib
from decimal import Decimal
from pathlib import Path

genesis = tomllib.loads(Path(sys.argv[1]).read_text())["genesis"]
work = Path(sys.argv[2])
served = {m["id"]: m for m in json.loads((work / "markets.json").read_text())}
params = json.loads((work / "house-state.json").read_text())["params"]
house = json.loads((work / "house.json").read_text())

def bands(tiers):
    """A band table as numbers, its open last band as None."""
    return [(None if t.get("up_to") is None else Decimal(t["up_to"]), t.get("bps", t.get("tenth_bps"))) for t in tiers]

wanted = {m["id"]: m for m in genesis["markets"]}
assert set(served) == set(wanted), f"markets differ: only served {sorted(set(served) - set(wanted))}, only listed {sorted(set(wanted) - set(served))}"
for i, want in sorted(wanted.items()):
    got = served[i]
    name = f"{want['symbol']} ({i})"
    assert got["symbol"] == want["symbol"], f"{name}: served as {got['symbol']}"
    # A field the file leaves out takes the engine's default for its asset class, so only listed ones are compared.
    for field in ("house_cap_floor", "house_cap_bps", "max_slippage_bps"):
        if field in want:
            assert Decimal(got[field]) == Decimal(want[field]), f"{name}: {field} {got[field]}"
    for field in ("margin_tiers", "spread_tiers"):
        if field in want:
            assert bands(got[field]) == bands(want[field]), f"{name}: {field} {got[field]}"
total = Decimal(genesis["params"].get("house_total_cap_floor", params["house_total_cap_floor"]))
assert Decimal(params["house_total_cap_floor"]) == total, f"total cap floor {params['house_total_cap_floor']}"
assert len(params["volume_tiers"]) == len(genesis["params"].get("volume_tiers", [])), "volume tiers differ"
if genesis["house_capital"] == "0":
    assert Decimal(house["cash"]) == 0 and Decimal(house["nav"]) == 0, f"the house starts with {house['nav']}, not nothing"
print(f"{len(wanted)} markets match, total cap floor {total:,.0f} USD, {len(params['volume_tiers'])} volume tiers")
PY

echo "==> Check the summary and the control script name the genesis"
grep -Fq "Genesis            $genesis" "$work/stack.log" || die "the stack's summary does not name $genesis"
status="$("$root/scripts/dev-local-stack-ctl.sh" status)" || die "dev-local-stack-ctl.sh status failed"
grep -Fq "$genesis" <<<"$status" || die "dev-local-stack-ctl.sh status does not name $genesis"
echo "OK: the node runs $genesis"
