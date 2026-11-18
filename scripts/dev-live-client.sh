#!/usr/bin/env bash
# The live client's dev scenario: starts an engine dev node, runs the live client against it with a
# tampering proxy in between, and checks that reads equal curl and that a flipped byte, a replayed
# response, a dropped stream frame, and a mock attestation in a production build are each refused.
#
# Needs Node, curl, and either ENGINE_BIN (a built `engine` binary) with ENGINE_DIR (the engine
# checkout holding config/dev.toml), or just ENGINE_DIR to build and run it with Cargo; set
# CARGO_CMD to prefix Cargo (for example a build-slot wrapper). The node runs on private temporary data,
# on LIVE_CLIENT_API_PORT (default 8080) and LIVE_CLIENT_METRICS_PORT (default 9464).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
engine_dir="$(cd "${ENGINE_DIR:?ENGINE_DIR is the engine checkout}" && pwd)"
[[ -z "${ENGINE_BIN:-}" ]] || ENGINE_BIN="$(cd "$(dirname "$ENGINE_BIN")" && pwd)/$(basename "$ENGINE_BIN")"
api_port="${LIVE_CLIENT_API_PORT:-8080}"
metrics_port="${LIVE_CLIENT_METRICS_PORT:-9464}"
work="$(mktemp -d)"
node_pid=""
cleanup() {
  [[ -n "$node_pid" ]] && kill "$node_pid" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

api="https://127.0.0.1:$api_port"
# A node already on the port would answer the health check below in place of the one started here.
[[ "$(curl -sk "$api/v1/health" || true)" == ok ]] && { echo "FAIL: something already answers on $api; stop it or choose another LIVE_CLIENT_API_PORT" >&2; exit 1; }

# dev.toml with the API and metrics on this scenario's ports; the replacements fail loudly if the
# config no longer names the ports they move.
python3 - "$engine_dir/config/dev.toml" "$work/node.toml" "$api_port" "$metrics_port" <<'PY' || { echo "FAIL: could not write the node config" >&2; exit 1; }
import sys
from pathlib import Path

src, out, api, metrics = sys.argv[1:]
text = Path(src).read_text()
for old, new in ((' = "127.0.0.1:8080"', f' = "127.0.0.1:{api}"'), (' = "127.0.0.1:9464"', f' = "127.0.0.1:{metrics}"')):
    assert text.count(old) == 1, f"config/dev.toml does not name {old.strip()} exactly once"
    text = text.replace(old, new)
Path(out).write_text(text)
PY
node_config="$work/node.toml"

# The node writes `data/dev` under its working directory.
cd "$work"
if [[ -n "${ENGINE_BIN:-}" ]]; then
  "$ENGINE_BIN" run --config "$node_config" > "$work/node.log" 2>&1 &
else
  # shellcheck disable=SC2086
  (cd "$engine_dir" && ${CARGO_CMD:-} cargo build -p engine-node >&2)
  "${CARGO_TARGET_DIR:-$engine_dir/target}/debug/engine" run --config "$node_config" > "$work/node.log" 2>&1 &
fi
node_pid=$!

for _ in $(seq 1 60); do
  kill -0 "$node_pid" 2>/dev/null || { echo "FAIL: the dev node exited" >&2; tail -20 "$work/node.log" >&2; exit 1; }
  [[ "$(curl -sk "$api/v1/health" || true)" == ok ]] && break
  sleep 1
done
[[ "$(curl -sk "$api/v1/health" || true)" == ok ]] || { echo "FAIL: the dev node did not start" >&2; tail -20 "$work/node.log" >&2; exit 1; }

cd "$root"
# The dev node's certificate is self-signed.
NODE_TLS_REJECT_UNAUTHORIZED=0 ENGINE_NODE_URL="$api" nice -n 10 npx vitest run --config vitest.live.config.ts scripts/live/dev-live-client.live.test.ts
echo "PASS: signed reads verify; tamper, replay, gap and mock-in-production are refused"
