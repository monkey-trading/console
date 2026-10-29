#!/usr/bin/env bash
# Serves the production build and checks the geo-block through real requests: a request from a
# listed country gets the restricted page at every path, one from another country or with no
# country header gets the console, the restricted page still loads its own assets, and every page
# stays noindex with robots.txt served as written.
# Run `npm run build` first. Usage: scripts/check-geo-block.sh [port]
set -euo pipefail

port="${1:-3217}"
base="http://127.0.0.1:$port"
marker="Not available in your region"
log="$(mktemp)"

npx next start --hostname 127.0.0.1 --port "$port" >"$log" 2>&1 &
server=$!
cleanup() {
  kill "$server" 2>/dev/null || true
  rm -f "$log"
}
trap cleanup EXIT

# `next start` exits when its port is taken, so only trust this server: it must be alive and its own
# log must say it listens here, never a request answered by another process on the port.
ready=0
for _ in $(seq 1 60); do
  kill -0 "$server" 2>/dev/null || { cat "$log"; echo "server exited" >&2; exit 1; }
  if grep -q "Local: .*127.0.0.1:$port\$" "$log" && curl -fs -o /dev/null "$base/restricted"; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then cat "$log"; echo "server not ready after 60s" >&2; exit 1; fi

failures=0
fail() { echo "FAIL: $1" >&2; failures=$((failures + 1)); }

# fetch <path> [country]: prints the body, a newline, then the HTTP status.
fetch() {
  local args=(-s -w '\n%{http_code}')
  # An empty value is sent as an empty header, which curl writes as `name;`.
  if [ "${2+set}" = set ]; then
    if [ -n "$2" ]; then args+=(-H "x-vercel-ip-country: $2"); else args+=(-H "x-vercel-ip-country;"); fi
  fi
  curl "${args[@]}" "$base$1"
}

expect_restricted() { # path country
  local out; out="$(fetch "$1" "$2")"
  if [ "${out##*$'\n'}" != 200 ] || ! grep -q "$marker" <<<"$out"; then fail "$2 $1 should get the restricted page"; fi
}
expect_console() { # path [country]; no country argument sends no header
  local out; out="$(fetch "$@")"
  if [ "${out##*$'\n'}" != 200 ] || grep -q "$marker" <<<"$out"; then fail "${2:-no country} $1 should get the console"; fi
}

for path in / /trade /a/b/c; do
  expect_restricted "$path" US
done
expect_console / GB
expect_console / ZZ
expect_console /
expect_console / ""

# A blocked visitor gets none of the console's shell, and an allowed one gets it.
blocked_page="$(fetch / US)"
allowed_page="$(fetch / GB)"
if grep -q 'Mock controls' <<<"$blocked_page" || grep -q '<header' <<<"$blocked_page"; then fail "US / should carry none of the console shell"; fi
grep -q '<header' <<<"$allowed_page" || fail "GB / should carry the console shell"

# A bare "/restricted" is the page itself for everyone.
expect_restricted /restricted US
out="$(fetch /restricted GB)"; grep -q "$marker" <<<"$out" || fail "GB /restricted should show the page"

# The restricted page must still reach its stylesheet.
page="$(fetch / US)"
css="$(grep -o '/_next/static/[^"]*\.css' <<<"$page" | head -n 1 || true)"
[ -n "$css" ] || fail "restricted page links no stylesheet"
headers="$(curl -s -D - -o /dev/null -H 'x-vercel-ip-country: US' "$base$css")"
grep -qi '^HTTP/[0-9.]* 200' <<<"$headers" && grep -qi '^content-type: text/css' <<<"$headers" ||
  fail "stylesheet $css should be served as CSS to a blocked country"

# Every page carries the noindex header and meta tag, and robots.txt disallows everything, for a
# blocked country as for any other: robots.txt is never rewritten to the restricted page.
for country in US GB; do
  headers="$(curl -s -D - -o /dev/null -H "x-vercel-ip-country: $country" "$base/")"
  grep -qi '^x-robots-tag: noindex, nofollow' <<<"$headers" || fail "$country / should send X-Robots-Tag: noindex"
  page="$(fetch / "$country")"
  grep -q '<meta name="robots" content="noindex, nofollow"' <<<"$page" || fail "$country / should carry the robots meta tag"
  robots="$(curl -s -D - -H "x-vercel-ip-country: $country" "$base/robots.txt")"
  grep -qi '^content-type: text/plain' <<<"$robots" && grep -q '^Disallow: /$' <<<"$(tr -d '\r' <<<"$robots")" ||
    fail "$country /robots.txt should disallow everything"
done

if [ "$failures" -eq 0 ]; then echo "geo-block checks passed"; fi
exit "$failures"
