#!/usr/bin/env bash
# Print what changed in a PR's patch since its review loop ended.
#
#   review-delta.sh <reviewed-base> <reviewed-head> <new-base> <new-head>
#
# Compares the reviewed patch (reviewed-base...reviewed-head) with the new one
# (new-base...new-head), so changes on main between the two bases drop out. Index
# lines and hunk line numbers are ignored. The comparison keys each hunk to its file
# and the function line git shows in its header, so a line moved from one function to
# another does not match; the residual's hunk headers name the file. `--no-relative`
# and `--inter-hunk-context=0` pin the diff against an inherited diff.relative, which could
# otherwise shrink both patches to the caller's directory and compare unequal patches as equal,
# and an inherited diff.interHunkContext, which could merge hunks and pull in context lines.
#
# Exit 0 with no output: the patches match. Exit 1: the residual is printed.
# Exit 2: bad arguments. Exit 3: git, sed, or diff failed.
set -Eeuo pipefail
trap 'exit 3' ERR
export LC_ALL=C
[ $# -eq 4 ] || { sed -n '2,16p' "$0" >&2; exit 2; }
rb=$1 rh=$2 nb=$3 nh=$4
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

patch() { # base head out
  git diff --no-relative --no-color --no-ext-diff --no-textconv --no-renames --binary -U0 \
    --inter-hunk-context=0 "$1...$2" -- ':(top)' |
    sed -E -e '/^index /d' -e 's/^@@ [^@]* @@/@@/' > "$3"
}
patch "$rb" "$rh" "$tmp/reviewed"
patch "$nb" "$nh" "$tmp/new"
status=0
diff -u -F '^diff --git' -L reviewed -L new "$tmp/reviewed" "$tmp/new" > "$tmp/residual" ||
  status=$?
[ "$status" -ne 0 ] || exit 0
[ "$status" -eq 1 ] || exit 3
cat "$tmp/residual"
exit 1
