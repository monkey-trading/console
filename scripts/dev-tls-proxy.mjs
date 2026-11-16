// A development-only TLS proxy for the local stack: it serves each engine's API again under a locally trusted
// certificate (mkcert's), so a browser that trusts mkcert's root needs no certificate accepted by hand.
//
//   node scripts/dev-tls-proxy.mjs --cert FILE --key FILE LISTEN=ENGINE [LISTEN=ENGINE ...]
//
// Each LISTEN port serves the TLS listener of the engine on loopback port ENGINE. HTTP requests and WebSocket
// upgrades pass through byte for byte, headers and bodies included, so every answer still carries the engine's own
// signature and the console verifies it as before. The engine's own certificate is not verified on this hop: it is
// a self-signed key the engine generates, the hop never leaves loopback, and what it carries is signed by the enclave.
// An engine that is not listening is answered as it would be without the proxy: the connection is reset.

import console from "node:console";
import { readFileSync } from "node:fs";
import https from "node:https";
import process from "node:process";
import tls from "node:tls";

const HOP = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "te", "trailer", "upgrade"]);

/**
 * Serves `routes` (listen port to engine port) over TLS with `cert` and `key`.
 * Returns the servers, for a caller that stops them.
 */
export function startProxy({ cert, key, routes, host = "127.0.0.1" }) {
  const upstream = new https.Agent({ keepAlive: true, rejectUnauthorized: false, maxSockets: 256 });
  return routes.map(({ listen, engine }) => {
    const server = https.createServer({ cert, key }, (req, res) => {
      const headers = {};
      for (const [name, value] of Object.entries(req.headers)) if (!HOP.has(name)) headers[name] = value;
      const forwarded = https.request(
        { host: "127.0.0.1", port: engine, method: req.method, path: req.url, headers, agent: upstream },
        (answer) => {
          const out = {};
          for (const [name, value] of Object.entries(answer.headers)) if (!HOP.has(name)) out[name] = value;
          res.writeHead(answer.statusCode ?? 502, answer.statusMessage, out);
          answer.pipe(res);
          answer.on("error", () => req.socket.destroy());
        },
      );
      forwarded.on("error", () => req.socket.destroy());
      req.on("aborted", () => forwarded.destroy());
      res.on("close", () => forwarded.destroy());
      req.pipe(forwarded);
    });
    server.on("upgrade", (req, socket, head) => {
      const engineSocket = tls.connect({ host: "127.0.0.1", port: engine, rejectUnauthorized: false });
      const drop = () => {
        socket.destroy();
        engineSocket.destroy();
      };
      engineSocket.on("error", drop);
      socket.on("error", drop);
      engineSocket.on("secureConnect", () => {
        let lines = `${req.method} ${req.url} HTTP/1.1\r\n`;
        for (let i = 0; i < req.rawHeaders.length; i += 2) lines += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
        engineSocket.write(`${lines}\r\n`);
        if (head.length > 0) engineSocket.write(head);
        socket.pipe(engineSocket);
        engineSocket.pipe(socket);
      });
      engineSocket.on("close", () => socket.destroy());
      socket.on("close", () => engineSocket.destroy());
    });
    server.listen(listen, host);
    return server;
  });
}

function main(argv) {
  let cert;
  let key;
  const routes = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--cert") cert = readFileSync(argv[++i]);
    else if (argv[i] === "--key") key = readFileSync(argv[++i]);
    else {
      const match = /^(\d+)=(\d+)$/.exec(argv[i] ?? "");
      if (match === null) throw new Error(`expected LISTEN=ENGINE or --cert/--key, got ${argv[i]}`);
      routes.push({ listen: Number(match[1]), engine: Number(match[2]) });
    }
  }
  if (cert === undefined || key === undefined || routes.length === 0) throw new Error("usage: dev-tls-proxy.mjs --cert FILE --key FILE LISTEN=ENGINE...");
  for (const server of startProxy({ cert, key, routes })) server.on("error", (error) => {
    console.error(`dev-tls-proxy: ${error.message}`);
    process.exit(1);
  });
  for (const { listen, engine } of routes) console.log(`proxying https://127.0.0.1:${listen} to the engine on ${engine}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
