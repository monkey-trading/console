// Checks scripts/dev-tls-proxy.mjs against a stand-in engine, with the trust a browser would have: the client trusts
// only the throwaway root in NODE_EXTRA_CA_CERTS, and the stand-in engine's own certificate is another, untrusted one.
// Usage (see check-tls-proxy.sh): node check-tls-proxy.mjs PROXY_CERT PROXY_KEY ENGINE_CERT ENGINE_KEY

/* global fetch, WebSocket */
import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import console from "node:console";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import https from "node:https";
import process from "node:process";
import { clearInterval, setInterval, setTimeout } from "node:timers";
import { startProxy } from "./dev-tls-proxy.mjs";

const [proxyCert, proxyKey, engineCert, engineKey] = process.argv.slice(2).map((path) => readFileSync(path));
const ENGINE = 18461;
const PROXY = 18462;
const DOWN = 18463;
const ORIGIN = "http://localhost:3000";

const engine = https.createServer({ cert: engineCert, key: engineKey }, (req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    if (req.url === "/slow") {
      res.writeHead(200, { "content-type": "text/plain", "x-signature": "0xabc" });
      res.write("one,");
      setTimeout(() => res.end("two"), 100);
      return;
    }
    res.writeHead(200, { "content-type": "application/json", "x-signature": "0xabc", "x-seen-origin": req.headers.origin ?? "" });
    res.end(JSON.stringify({ method: req.method, url: req.url, body: Buffer.concat(chunks).toString() }));
  });
});
engine.on("upgrade", (req, socket) => {
  const accept = createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const hello = Buffer.from(`hello ${req.headers.origin} ${req.url}`);
  socket.write(Buffer.concat([Buffer.from([0x81, hello.length]), hello]));
  socket.on("data", (frame) => {
    // A client frame is masked and short: echo its payload back, unmasked.
    const length = frame[1] & 0x7f;
    const mask = frame.subarray(2, 6);
    const payload = Buffer.from(frame.subarray(6, 6 + length).map((byte, i) => byte ^ mask[i % 4]));
    socket.write(Buffer.concat([Buffer.from([0x81, length]), payload]));
  });
});
await new Promise((done) => engine.listen(ENGINE, "127.0.0.1", done));
const servers = startProxy({ cert: proxyCert, key: proxyKey, routes: [{ listen: PROXY, engine: ENGINE }, { listen: DOWN, engine: 18999 }] });
await new Promise((done) => setTimeout(done, 300));

// Node's fetch trusts NODE_EXTRA_CA_CERTS and refuses anything else, as a browser would.
const base = `https://localhost:${PROXY}`;
const got = await fetch(`${base}/v1/markets?x=1`, { headers: { origin: ORIGIN } });
assert.equal(got.status, 200);
assert.equal(got.headers.get("x-signature"), "0xabc");
assert.equal(got.headers.get("x-seen-origin"), ORIGIN);
assert.deepEqual(await got.json(), { method: "GET", url: "/v1/markets?x=1", body: "" });

const posted = await fetch(`https://127.0.0.1:${PROXY}/v1/orders`, { method: "POST", body: "signed-body" });
assert.deepEqual(await posted.json(), { method: "POST", url: "/v1/orders", body: "signed-body" });
assert.equal(await (await fetch(`${base}/slow`)).text(), "one,two");

// The engine's own certificate stays untrusted: the proxy's is what makes the hop trusted for the client.
await assert.rejects(fetch(`https://127.0.0.1:${ENGINE}/v1/health`));

// A WebSocket upgrade carries the browser's Origin and the path, and frames pass both ways.
const socket = new WebSocket(`wss://localhost:${PROXY}/v1/stream?signed=1`, { headers: { origin: ORIGIN } });
const messages = [];
socket.addEventListener("message", (event) => {
  messages.push(String(event.data));
  if (messages.length === 1) socket.send("ping");
});
await new Promise((done, fail) => {
  socket.addEventListener("error", () => fail(new Error("the stream did not open")));
  const timer = setInterval(() => {
    if (messages.length === 2) {
      clearInterval(timer);
      done();
    }
  }, 20);
});
assert.equal(messages[0], `hello ${ORIGIN} /v1/stream?signed=1`);
assert.equal(messages[1], "ping");
socket.close();

// An engine that is not listening is answered with a reset, as without the proxy, not with a made-up status.
await assert.rejects(fetch(`https://localhost:${DOWN}/v1/health`), /fetch failed/);

for (const server of [engine, ...servers]) server.closeAllConnections();
console.log("PASS: the proxy forwards requests, bodies, headers, streams and upgrades, and resets when the engine is down");
process.exit(0);
