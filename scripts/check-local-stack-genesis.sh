#!/usr/bin/env bash
# Starts the local stack (scripts/dev-local-stack.sh) with GENESIS_FILE and checks that the node accepted that
# genesis: it serves exactly the markets the file lists with every field the file gives them (cap floors, margin and
# spread bands, schedule, price rules, financing, futures contracts, weekend margin), serves the file's protocol
# parameters (the total cap floor, volume tiers and the rest the house state lists, field by field), starts the house
# with what the stack deposited to it (nothing with launch values), and that the stack's summary and
# `dev-local-stack-ctl.sh status` name the genesis. The default is the launch
# genesis, config/production-genesis.toml (34 markets, a $61M total floor).
#
# The stack runs on its own ports (default 18545, 18080, 13000, 19464 and 28846; ANVIL_PORT, API_PORT,
# CONSOLE_PORT, METRICS_PORT and ACCESS_SOURCE_PORT move them) and on its own info file, so it never meets a stack
# already running on the defaults. It needs what the stack needs, builds the node (set CARGO_CMD to prefix Cargo, for
# example with a build-slot wrapper), and takes a few minutes, longer while a build slot is taken (it waits up to an hour). ENGINE_DIR names the engine checkout.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
export GENESIS_FILE="${GENESIS_FILE:-config/production-genesis.toml}"
export ANVIL_PORT="${ANVIL_PORT:-18545}" API_PORT="${API_PORT:-18080}" CONSOLE_PORT="${CONSOLE_PORT:-13000}"
export METRICS_PORT="${METRICS_PORT:-19464}" ACCESS_SOURCE_PORT="${ACCESS_SOURCE_PORT:-28846}"
# The second engine's ports, for SECOND_ENGINE=1.
export SECOND_API_PORT="${SECOND_API_PORT:-18081}" SECOND_METRICS_PORT="${SECOND_METRICS_PORT:-19465}"
export HANDOVER_PORT="${HANDOVER_PORT:-19443}" SECOND_HANDOVER_PORT="${SECOND_HANDOVER_PORT:-19444}"
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
    # The stack leads its own process group, so a build it waits on stops with it and its shell can run its
    # cleanup, which stops everything it started one after another (up to 50 s); give it that and more.
    kill -TERM -- "-$stack_pid" 2>/dev/null || true
    for _ in $(seq 1 350); do kill -0 "$stack_pid" 2>/dev/null || break; sleep 0.2; done
    kill -KILL -- "-$stack_pid" 2>/dev/null || true
    wait "$stack_pid" 2>/dev/null || true
  fi
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "==> Start the stack on $GENESIS_FILE (API port $API_PORT)"
python3 -c 'import os, sys; os.setpgid(0, 0); os.execv(sys.argv[1], sys.argv[1:])' "$root/scripts/dev-local-stack.sh" \
  >"$work/stack.log" 2>&1 &
stack_pid=$!
# The stack writes its info file once the console answers, after the node has applied the genesis.
for _ in $(seq 1 3600); do
  [[ -f "$STACK_INFO_FILE" ]] && break
  kill -0 "$stack_pid" 2>/dev/null || die "the stack exited before it was up"
  sleep 1
done
[[ -f "$STACK_INFO_FILE" ]] || die "the stack was not up within an hour"

api="$(jq -r .apiOrigin "$STACK_INFO_FILE")"
genesis="$(jq -r .genesisFile "$STACK_INFO_FILE")"
echo "==> Check the node's markets against $genesis"
curl -sk --max-time 10 "$api/v1/markets" >"$work/markets.json" || die "the node did not answer /v1/markets"
curl -sk --max-time 10 "$api/v1/house/state" >"$work/house-state.json" || die "the node did not answer /v1/house/state"
curl -sk --max-time 10 "$api/v1/house" >"$work/house.json" || die "the node did not answer /v1/house"
python3 -I - "$genesis" "$work" "$(jq -r .houseUsdc "$STACK_INFO_FILE")" <<'PY' || die "the node's genesis is not the file's"
import json
import sys
import tomllib
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

genesis = tomllib.loads(Path(sys.argv[1]).read_text())["genesis"]
work = Path(sys.argv[2])
house_usdc = Decimal(sys.argv[3])
served = {m["id"]: m for m in json.loads((work / "markets.json").read_text())}
params = json.loads((work / "house-state.json").read_text())["params"]
house = json.loads((work / "house.json").read_text())


def number(value):
    """The value as a Decimal, or None when it is not a number."""
    if isinstance(value, bool):
        return None
    try:
        return Decimal(str(value))
    except InvalidOperation:
        return None


def empty(value):
    """What the node leaves out of its answer: absent, zero, or an empty list or table."""
    return value is None or value == "" or value is False or value == [] or value == {} or number(value) == 0


def same(got, want):
    """Whether the node serves `want`. Numbers compare as numbers, a table by each key the file lists, and
    a field the node leaves out when it is zero equals a zero in the file."""
    if isinstance(want, dict):
        got = got if isinstance(got, dict) else {}
        return all(same(got.get(key), value) for key, value in want.items())
    if isinstance(want, list):
        if got is None:
            return not want
        return isinstance(got, list) and len(got) == len(want) and all(same(g, w) for g, w in zip(got, want, strict=True))
    if isinstance(want, datetime | date):
        return got == want.isoformat()
    if got is None:
        return empty(want)
    if number(got) is not None and number(want) is not None:
        return number(got) == number(want)
    return got == want


wanted = {m["id"]: m for m in genesis["markets"]}
assert set(served) == set(wanted), f"markets differ: only served {sorted(set(served) - set(wanted))}, only listed {sorted(set(wanted) - set(served))}"
for i, want in sorted(wanted.items()):
    # Every field the file lists for the market: the node leaves out one that is zero or empty.
    for field, value in want.items():
        assert same(served[i].get(field), value), f"{want['symbol']} ({i}): {field} is {served[i].get(field)}, the file lists {value}"
# The house state serves the protocol parameters as set. It leaves out the four below when they are zero or empty, so a
# file's value for one is always compared; any other the file lists is compared when the node serves it (the order limit
# is served per volume tier instead).
OPTIONAL_PARAMS = ("house_total_cap_floor", "volume_tiers", "stress_levels", "profit_fee_curve")
compared = 0
for field, want in genesis["params"].items():
    if field not in params and field not in OPTIONAL_PARAMS:
        continue
    compared += 1
    assert same(params.get(field), want), f"parameter {field} is {params.get(field)}, the file lists {want}"
# The house holds what the stack deposited to it in the vault, nothing with launch values.
assert Decimal(house["nav"]) == house_usdc, f"the house starts with {house['nav']} USD, not the stack's {house_usdc}"
print(f"{len(wanted)} markets and {compared} parameters match, total cap floor {number(params.get('house_total_cap_floor', 0)):,.0f} USD, "
      f"{len(params.get('volume_tiers', []))} volume tiers")
PY

echo "==> Check the summary and the control script name the genesis"
grep -Fq "Genesis            $genesis" "$work/stack.log" || die "the stack's summary does not name $genesis"
status="$("$root/scripts/dev-local-stack-ctl.sh" status)" || die "dev-local-stack-ctl.sh status failed"
grep -Fq "$genesis" <<<"$status" || die "dev-local-stack-ctl.sh status does not name $genesis"
echo "OK: the node runs $genesis"
