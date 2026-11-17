#!/usr/bin/env bash
# Checks that `dev-local-stack-ctl.sh stop-operator` has the stack start the stopped engine again however the stack's
# work directory is spelled: here a path with an apostrophe, a space and a dollar sign. It runs the command against a
# stand-in `cast` and `sleep`: no chain, no node and no port.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/check-stop-trap.XXXXXX")"
trap 'rm -rf "$work"' EXIT
stack="$work/owner's \$stack"
mkdir -p "$work/bin" "$stack"
a=0x00000000000000000000000000000000000000a1
b=0x00000000000000000000000000000000000000b2
c=0x00000000000000000000000000000000000000c3
jq -n --arg a "$a" --arg b "$b" --arg c "$c" --arg dir "$stack" '{
  rpcUrl: "http://stand-in.invalid", vault: "0xv", registry: "0xr", schedule: "0xs", workDir: $dir,
  apiOrigin: "https://a.invalid", secondApiOrigin: "https://b.invalid", thirdApiOrigin: "https://c.invalid",
  operator: $a, secondCandidate: $b, thirdCandidate: $c}' >"$work/info.json"

# The stand-in chain: the vault's signer epoch is 5, then 6; the registry names `a`, then `b` once the epoch has moved.
cat >"$work/bin/cast" <<'STUB'
#!/usr/bin/env bash
sig=""
for arg in "$@"; do
  case "$arg" in *\(*) sig="$arg"; break ;; esac
done
reads="$STUB_DIR/epoch-reads"
case "$1:$sig" in
  block:*) echo 0 ;;
  call:'signerEpoch()(uint64)')
    echo x >>"$reads"
    if (($(wc -l <"$reads" | tr -d ' ') == 1)); then echo 5; else echo 6; fi
    ;;
  call:'namedOperator()'*)
    if (($(wc -l <"$reads" | tr -d ' ') >= 2)); then echo "($STUB_B, $STUB_B, 0x00, 0)"; else echo "($STUB_A, $STUB_A, 0x00, 0)"; fi
    ;;
  call:'liveness()'*) printf '10\n2\n3\n1\n' ;;
  call:'turnLength()'*) echo 86400 ;;
  call:'boundary(uint64)'*) echo 0 ;;
  call:'turnOf(uint64)'*) echo "($STUB_A, 0, 0, 0, 0, 0, 0x00, 0x00)" ;;
  *) echo "stand-in cast: unexpected call: $*" >&2; exit 2 ;;
esac
STUB
printf '#!/usr/bin/env bash\nexit 0\n' >"$work/bin/sleep"
printf '#!/usr/bin/env bash\necho ok\n' >"$work/bin/curl"
chmod +x "$work/bin/curl" "$work/bin/cast" "$work/bin/sleep"
: >"$work/epoch-reads"

status=0
PATH="$work/bin:$PATH" STUB_DIR="$work" STUB_A="$a" STUB_B="$b" STACK_INFO_FILE="$work/info.json" \
  "$root/scripts/dev-local-stack-ctl.sh" stop-operator >"$work/out" 2>&1 || status=$?
fail() {
  echo "FAIL: $*" >&2
  cat "$work/out" >&2
  exit 1
}
((status == 0)) || fail "stop-operator exited $status"
[[ -f "$stack/stop-first" ]] || fail "the operator's engine was not asked to stop"
[[ -f "$stack/start-first" ]] || fail "the stopped engine was not asked to start again"
echo "stop-operator has the stopped engine start again from a work directory with an apostrophe"
