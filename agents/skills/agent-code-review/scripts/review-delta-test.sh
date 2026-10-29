#!/usr/bin/env bash
# Checks review-delta.sh and review-change.sh on a scratch repository: a rebase onto a main that moved (also under an
# inherited diff.interHunkContext), a change that differs, a line moved between functions, a rename,
# binary fixtures (also under a text conversion), an external diff driver, a caller in a subdirectory
# under an inherited diff.relative, the change added after a rebase (conflicted files included),
# bad arguments, and failures, among them a comparison command that fails. Prints one line
# per case and exits 1 if any case fails.
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd)"
script=$dir/review-delta.sh change_script=$dir/review-change.sh
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
lines() { # the numbered lines of src/lines.txt, with the PR's edits to lines 3 and 6 and main's line
  for n in 1 2 3 4 5 6 7 8; do
    case "$n:$1" in 3:pr | 6:pr) echo "L$n edited" ;; *) echo "L$n" ;; esac
    [ "$n:$2" != 4:main ] || echo "main line"
  done > src/lines.txt
}
commit() { git add -A && git commit -qm "$1" && git rev-parse HEAD; }
from() { git checkout -q --detach "$1"; }

page none; base=$(commit base)
page first; reviewed=$(commit reviewed)
page second; moved=$(commit moved)
from "$reviewed"; echo "// edited" >> src/page.ts; edited=$(commit edited)
from "$base"; { echo "// header"; echo "// header"; cat src/page.ts; } > src/page.next && mv src/page.next src/page.ts
main=$(commit main)
page first; { echo "// header"; echo "// header"; cat src/page.ts; } > src/page.next && mv src/page.next src/page.ts
rebased=$(commit rebased)
from "$rebased"; echo "// fix" >> src/page.ts; fixed=$(commit fixed)
from "$base"; printf '\0\1AAAA' > blob.bin; blob_a=$(commit blob-a)
from "$base"; printf '\0\1BBBB' > blob.bin; blob_b=$(commit blob-b)
from "$main"; printf '\0\1AAAA' > blob.bin; blob_a_on_main=$(commit blob-a-on-main)

from "$base"; lines none none; lines_base=$(commit lines-base)
lines pr none; lines_reviewed=$(commit lines-reviewed)
from "$lines_base"; lines none main; lines_main=$(commit lines-main)
lines pr main; lines_rebased=$(commit lines-rebased)
from "$reviewed"; git mv src/page.ts src/moved.ts; renamed=$(commit renamed)

failed=0
check() { # name expected-exit args...
  local name=$1 want=$2 got=0; shift 2
  "$script" "$@" > "$name.out" 2> "$name.err" || got=$?
  if [ "$got" = "$want" ]; then echo "ok   $name"; return; fi
  echo "FAIL $name: exit $got, want $want"; failed=1
}
check_change() { # name expected-exit args...: review-change.sh
  local name=$1 want=$2 got=0; shift 2
  "$change_script" "$@" > "$name.out" 2> "$name.err" || got=$?
  if [ "$got" = "$want" ]; then echo "ok   $name"; return; fi
  echo "FAIL $name: exit $got, want $want"; failed=1
}
check identical 0 "$base" "$reviewed" "$base" "$reviewed"
check rebase-onto-moved-main 0 "$base" "$reviewed" "$main" "$rebased"
has() { # case pattern what: the case's residual holds a line matching pattern
  grep -q -e "$2" "$1.out" || { echo "FAIL $1: the residual lacks $3"; failed=1; }
}
empty() { # case: a matching case prints nothing
  [ ! -s "$1.out" ] || { echo "FAIL $1: output on a match"; failed=1; }
}
empty identical
empty rebase-onto-moved-main
check line-added 1 "$base" "$reviewed" "$base" "$edited"
has line-added '^++// edited$' "the added line"
has line-added '^@@ .*page.ts\|^diff --git' "the file"
check line-moved-between-functions 1 "$base" "$reviewed" "$base" "$moved"
has line-moved-between-functions "^-@@ export function first" "the old function"
has line-moved-between-functions "^+@@ export function second" "the new function"
check binary-changed 1 "$base" "$blob_a" "$base" "$blob_b"
has binary-changed '^-[A-Za-z0-9]' "the old payload"
has binary-changed '^+[A-Za-z0-9]' "the new payload"
has binary-changed 'blob.bin' "the file"
check binary-same 0 "$base" "$blob_a" "$main" "$blob_a_on_main"
empty binary-same
check renamed-file 1 "$base" "$reviewed" "$base" "$renamed"
has renamed-file 'moved.ts' "the new path"
has renamed-file 'new file mode' "the new file, as a rename is not detected"
# A text conversion that renders both blobs alike must not hide the change.
echo '*.bin diff=alike' > .git/info/attributes
git config diff.alike.textconv "sh -c 'echo alike'"
check binary-changed-under-textconv 1 "$base" "$blob_a" "$base" "$blob_b"
# A comparison that fails must not pass as a valid residual.
mkdir bin; printf '#!/bin/sh\nexit 2\n' > bin/diff; chmod +x bin/diff
PATH="$tmp/bin:$PATH" check diff-fails 3 "$base" "$reviewed" "$base" "$edited"
PATH="$tmp/bin:$PATH" check diff-fails-on-match 3 "$base" "$reviewed" "$base" "$reviewed"
check bad-ref 3 "$base" no-such-ref "$base" "$reviewed"
check too-few-arguments 2 "$base" "$reviewed" "$base"
check too-many-arguments 2 "$base" "$reviewed" "$base" "$reviewed" extra
# An inherited diff.interHunkContext or external diff driver must not change the comparison.
git config diff.interHunkContext 3
check inter-hunk-context-rebase 0 "$lines_base" "$lines_reviewed" "$lines_main" "$lines_rebased"
git config --unset diff.interHunkContext
git config diff.external "false"
check external-diff-driver 0 "$base" "$reviewed" "$main" "$rebased"
git config --unset diff.external
# An inherited diff.relative must not shrink the patches to the caller's directory.
git config diff.relative true
cd src
check relative-binary-changed 1 "$base" "$blob_a" "$base" "$blob_b"
check relative-rebase 0 "$base" "$reviewed" "$main" "$rebased"
check_change relative-change 0 "$rebased" "$fixed"
cd "$tmp"
git config --unset diff.relative
# The change after a rebase holds the added commits, not what main brought in.
check_change change-after-rebase 0 "$rebased" "$fixed"
grep -qx '+// fix' change-after-rebase.out || { echo "FAIL change-after-rebase: lacks the added line"; failed=1; }
grep -q 'main' change-after-rebase.out && { echo "FAIL change-after-rebase: holds main's commit"; failed=1; }
grep -qx '+// header' change-after-rebase.out && { echo "FAIL change-after-rebase: holds main's change"; failed=1; }
# After a conflicted rebase the named file's new diff follows the added commits.
check_change change-conflicted-file 0 "$rebased" "$fixed" "$main" src/page.ts
[ "$(grep -cx '+// fix' change-conflicted-file.out)" = 2 ] ||
  { echo "FAIL change-conflicted-file: lacks the commit or the file's diff"; failed=1; }
check_change change-none 0 "$rebased" "$rebased"
empty change-none
# A reviewed head that was rebased away is not an ancestor: its range would mix in main's commits.
check_change change-unrebased-head 3 "$reviewed" "$fixed"
check_change change-too-few-arguments 2 "$rebased"
check_change change-base-without-file 2 "$rebased" "$fixed" "$main"
exit "$failed"
