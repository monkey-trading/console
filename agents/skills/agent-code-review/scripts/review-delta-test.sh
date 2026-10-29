#!/usr/bin/env bash
# Checks review-delta.sh on a scratch repository: a rebase onto a main that moved, a change that
# differs, a line moved between functions, binary fixtures (also under a text conversion), a caller
# in a subdirectory under an inherited diff.relative, bad arguments, and failures. Prints one line
# per case and exits 1 if any case fails.
set -euo pipefail
script="$(cd "$(dirname "$0")" && pwd)/review-delta.sh"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
cd "$tmp"
git init -q . && git config user.name test && git config user.email test@example.com

mkdir -p src
page() { # the line each function gains: none, first, second
  {
    echo "export function first() {"
    echo "  return 1;"
    [ "$1" != first ] || echo "  log('first');"
    echo "}"
    echo "export function second() {"
    echo "  return 2;"
    [ "$1" != second ] || echo "  log('first');"
    echo "}"
  } > src/page.ts
}
notes() { printf '# notes\n%s\n' "$1" > notes.md; }
commit() { git add -A && git commit -qm "$1" && git rev-parse HEAD; }
from() { git checkout -q --detach "$1"; }

notes "a"; page none; base=$(commit base)
page first; reviewed=$(commit reviewed)
page second; moved=$(commit moved)
from "$reviewed"; echo "// edited" >> src/page.ts; edited=$(commit edited)
from "$base"; { echo "// header"; echo "// header"; cat src/page.ts; } > src/page.next && mv src/page.next src/page.ts
main=$(commit main)
page first; { echo "// header"; echo "// header"; cat src/page.ts; } > src/page.next && mv src/page.next src/page.ts
rebased=$(commit rebased)
from "$base"; printf '\0\1AAAA' > blob.bin; blob_a=$(commit blob-a)
from "$base"; printf '\0\1BBBB' > blob.bin; blob_b=$(commit blob-b)
from "$main"; printf '\0\1AAAA' > blob.bin; blob_a_on_main=$(commit blob-a-on-main)

failed=0
check() { # name expected-exit args...
  local name=$1 want=$2 got=0; shift 2
  "$script" "$@" > "$name.out" 2> "$name.err" || got=$?
  if [ "$got" = "$want" ]; then echo "ok   $name"; return; fi
  echo "FAIL $name: exit $got, want $want"; failed=1
}
check identical 0 "$base" "$reviewed" "$base" "$reviewed"
check rebase-onto-moved-main 0 "$base" "$reviewed" "$main" "$rebased"
check line-added 1 "$base" "$reviewed" "$base" "$edited"
grep -q '^++// edited$' line-added.out ||
  { echo "FAIL line-added: the added line is not in the residual"; failed=1; }
check line-moved-between-functions 1 "$base" "$reviewed" "$base" "$moved"
check binary-changed 1 "$base" "$blob_a" "$base" "$blob_b"
check binary-same 0 "$base" "$blob_a" "$main" "$blob_a_on_main"
# A text conversion that renders both blobs alike must not hide the change.
echo '*.bin diff=alike' > .git/info/attributes
git config diff.alike.textconv "sh -c 'echo alike'"
check binary-changed-under-textconv 1 "$base" "$blob_a" "$base" "$blob_b"
check bad-ref 3 "$base" no-such-ref "$base" "$reviewed"
check too-few-arguments 2 "$base" "$reviewed" "$base"
check too-many-arguments 2 "$base" "$reviewed" "$base" "$reviewed" extra
# An inherited diff.relative must not shrink the patches to the caller's directory.
git config diff.relative true
cd src
check relative-binary-changed 1 "$base" "$blob_a" "$base" "$blob_b"
check relative-rebase 0 "$base" "$reviewed" "$main" "$rebased"
cd "$tmp"
git config diff.relative false
exit "$failed"
