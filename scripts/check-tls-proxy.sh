#!/usr/bin/env bash
# Checks the local stack's TLS proxy (dev-tls-proxy.mjs) against a stand-in engine, with a throwaway root made here
# with openssl, so it needs neither mkcert nor a trusted root, and touches no keychain: the client trusts the root
# through NODE_EXTRA_CA_CERTS only. Uses loopback ports 18461 to 18463.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/check-tls-proxy.XXXXXX")"
trap 'rm -rf "$work"' EXIT
cd "$work"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 1 -subj "/CN=throwaway root" \
  -keyout root-key.pem -out root.pem 2>/dev/null
openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -subj "/CN=proxy" -keyout proxy-key.pem -out proxy.csr 2>/dev/null
printf 'subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=CA:FALSE\n' >san.ext
openssl x509 -req -in proxy.csr -CA root.pem -CAkey root-key.pem -CAcreateserial -days 1 -extfile san.ext -out proxy.pem 2>/dev/null
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 1 -subj "/CN=engine" \
  -addext "subjectAltName=IP:127.0.0.1" -keyout engine-key.pem -out engine.pem 2>/dev/null
NODE_EXTRA_CA_CERTS="$work/root.pem" node "$root/scripts/check-tls-proxy.mjs" proxy.pem proxy-key.pem engine.pem engine-key.pem
