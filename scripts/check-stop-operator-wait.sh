#!/usr/bin/env bash
# Checks that `dev-local-stack-ctl.sh stop-operator` waits for the turn that follows when too little of the current one
# is left for a promotion, says so with how long, then stops the operator and reports the promotion; and that it does not
# wait when a whole promotion fits or the next turn is the same member's. It runs the command against a stand-in `cast`
# and a `sleep` that moves a fake chain clock: no chain, no node and no port.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/check-stop-wait.XXXXXX")"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin" "$work/stack"
a=0x00000000000000000000000000000000000000a1
b=0x00000000000000000000000000000000000000b2
c=0x00000000000000000000000000000000000000c3
jq -n --arg a "$a" --arg b "$b" --arg c "$c" --arg dir "$work/stack" '{
  rpcUrl: "http://stand-in.invalid", vault: "0xv", registry: "0xr", schedule: "0xs", workDir: $dir,
  apiOrigin: "https://a.invalid", secondApiOrigin: "https://b.invalid", thirdApiOrigin: "https://c.invalid",
  operator: $a, secondCandidate: $b, thirdCandidate: $c}' >"$work/info.json"

# The stand-in chain: 300 s turns from 0, 30 s slots, 20 s tolerance and 5 misses, so a promotion needs 200 s and two
# slots more. The vault's signer epoch is 5, then 6; the registry names `a`, then `b` once the epoch has moved; the turn
# after the current one is `$STUB_NEXT`'s. The clock is `$STUB_DIR/clock`, which `sleep` advances.
cat >"$work/bin/cast" <<'STUB'
#!/usr/bin/env bash
sig=""
for arg in "$@"; do
  case "$arg" in *\(*) sig="$arg"; break ;; esac
done
reads="$STUB_DIR/epoch-reads"
case "$1:$sig" in
  block:*) cat "$STUB_DIR/clock" ;;
  call:'signerEpoch()(uint64)')
    echo x >>"$reads"
    if (($(wc -l <"$reads" | tr -d ' ') >= 2)); then echo 6; else echo 5; fi
    ;;
  call:'namedOperator()'*)
    if (($(wc -l <"$reads" | tr -d ' ') >= 2)); then echo "($STUB_B, $STUB_B, 0x00, 0)"; else echo "($STUB_A, $STUB_A, 0x00, 0)"; fi
    ;;
  call:'liveness()'*) printf '30\n20\n5\n10\n' ;;
  call:'turnLength()'*) echo 300 ;;
  call:'boundary(uint64)'*) echo 0 ;;
  call:'turnOf(uint64)'*) echo "($STUB_NEXT, 0, 0, 0, 0, 0, 0x00, 0x00)" ;;
  *) echo "stand-in cast: unexpected call: $*" >&2; exit 2 ;;
esac
STUB
cat >"$work/bin/sleep" <<'STUB'
#!/usr/bin/env bash
echo "$1" >>"$STUB_DIR/sleeps"
echo $(($(cat "$STUB_DIR/clock") + $1)) >"$STUB_DIR/clock"
STUB
chmod +x "$work/bin/cast" "$work/bin/sleep"

fail() {
  echo "FAIL: $*" >&2
  cat "$work/out" >&2
  exit 1
}
# run CLOCK NEXT: stop-operator with the chain at CLOCK and the next turn `NEXT`'s.
run() {
  rm -f "$work/sleeps" "$work/stack/stop-first" "$work/stack/start-first"
  : >"$work/epoch-reads"
  echo "$1" >"$work/clock"
  PATH="$work/bin:$PATH" STUB_DIR="$work" STUB_A="$a" STUB_B="$b" STUB_NEXT="$2" STACK_INFO_FILE="$work/info.json" \
    "$root/scripts/dev-local-stack-ctl.sh" stop-operator >"$work/out" 2>&1 || fail "stop-operator exited $? at clock $1"
  grep -q "in signer epoch 6:" "$work/out" || fail "no promotion was reported at clock $1"
  [[ -f "$work/stack/stop-first" && -f "$work/stack/start-first" ]] || fail "the engine was not stopped and started again at clock $1"
}

# 150 s into a turn, 150 s are left, short of the 260 s a promotion needs: it waits those 150 s, once, and stops at the boundary.
run 1050 "$b"
grep -q "Waiting 150 s" "$work/out" || fail "it did not say it was waiting 150 s"
[[ "$(awk '{s += $1} END {print s}' "$work/sleeps")" == 150 ]] || fail "it did not wait 150 s in all"
[[ "$(cat "$work/clock")" == 1200 ]] || fail "it did not stop at the turn's boundary"
# 40 s into a turn, 260 s are left, which is enough: no wait.
run 1240 "$b"
if grep -q "Waiting" "$work/out" || [[ -s "$work/sleeps" ]]; then fail "it waited with a whole promotion's time left"; fi
# The next turn is the same member's: no wait however little is left.
run 1050 "$a"
if grep -q "Waiting" "$work/out" || [[ -s "$work/sleeps" ]]; then fail "it waited for a turn the same member holds"; fi
echo "stop-operator waits for the next turn when a promotion would not fit in the current one, and only then"
