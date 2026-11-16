#!/usr/bin/env bash
# Checks the comparison inside `check-local-stack-genesis.sh` for a market's quote currency: a node leaves out the field
# when it is USD, so a file's explicit USD matches, while another currency has to be served as listed. It runs the
# script's own Python against canned answers of the node: no stack, no node and no port.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/check-genesis-quote.XXXXXX")"
trap 'rm -rf "$work"' EXIT
sed -n "/<<'PY'/,/^PY\$/p" "$root/scripts/check-local-stack-genesis.sh" | sed '1d;$d' >"$work/compare.py"
[[ -s "$work/compare.py" ]] || {
  echo "FAIL: the comparison was not found in check-local-stack-genesis.sh" >&2
  exit 1
}
echo '{"params": {}}' >"$work/house-state.json"
echo '{"nav": "0"}' >"$work/house.json"

# Runs the comparison on a served market with the given extra fields and a file listing `$1` for its quote currency.
compare() {
  local listed="$1" served="$2"
  printf '[genesis]\nparams = {}\n[[genesis.markets]]\nid = 1\nsymbol = "X"\n%s\n' "$listed" >"$work/genesis.toml"
  printf '[{"id": 1, "symbol": "X"%s}]\n' "$served" >"$work/markets.json"
  python3 -I "$work/compare.py" "$work/genesis.toml" "$work" 0 >/dev/null 2>"$work/err"
}
expect() {
  local verdict="$1" listed="$2" served="${3:-}"
  local got=fail
  compare "$listed" "$served" && got=pass
  [[ "$got" == "$verdict" ]] || {
    echo "FAIL: the file lists \`$listed\` and the node serves \`$served\`: expected $verdict, got $got" >&2
    cat "$work/err" >&2
    exit 1
  }
}
expect pass 'quote_currency = { currency = "usd" }'
expect pass ''
expect pass 'quote_currency = { currency = "jpy", fx_market = 12 }' ', "quote_currency": {"currency": "jpy", "fx_market": 12}'
expect fail 'quote_currency = { currency = "jpy", fx_market = 12 }'
expect fail 'quote_currency = { currency = "eur", fx_market = 12 }' ', "quote_currency": {"currency": "jpy", "fx_market": 12}'
expect fail 'quote_currency = { currency = "usd" }' ', "quote_currency": {"currency": "jpy", "fx_market": 12}'
echo "the genesis check reads an omitted quote currency as USD and still holds any other to the file"
