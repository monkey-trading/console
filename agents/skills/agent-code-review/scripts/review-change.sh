#!/usr/bin/env bash
# Print the change a PR gained since its review loop ended.
#
#   review-change.sh <stand-in-head> <new-head> [<new-base> <conflicted-file>...]
#
# <stand-in-head> is the reviewed head as it stands after any rebase: the reviewed head itself,
# or the commit a rebase made of it. Prints each commit added after it, oldest first, with its
# patch, so `main`'s changes from a rebase never appear. After a rebase that resolved conflicts,
# name the new base and each conflicted file, and the new diff of each file follows.
#
# Exit 0: the change is printed (empty when no commit was added and no file named). Exit 2: bad
# arguments. Exit 3: git failed, or <stand-in-head> is not an ancestor of <new-head>.
set -Eeuo pipefail
trap 'exit 3' ERR
export LC_ALL=C
{ [ $# -eq 2 ] || [ $# -ge 4 ]; } || { sed -n '2,13p' "$0" >&2; exit 2; }
sh=$1 nh=$2
git merge-base --is-ancestor "$sh" "$nh" # a head that was rebased needs its stand-in
git log -p --reverse --no-merges --no-color --no-ext-diff --no-textconv --no-renames --binary \
  --no-relative "$sh..$nh" -- ':(top)'
if [ $# -ge 4 ]; then
  nb=$3; shift 3
  for f in "$@"; do
    git diff --no-relative --no-color --no-ext-diff --no-textconv --no-renames --binary \
      "$nb...$nh" -- ":(top,literal)$f"
  done
fi
