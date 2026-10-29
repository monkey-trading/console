/** A man in the middle for the dev scenario: forwards to a node and, when told to, alters, replays or drops what it carries. */

import { request as httpsRequest } from "node:https";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface Tamper {
  /** Flips one byte of every response body. */
  flipBodyByte: boolean;
  /** Answers every read with the last response recorded for its path. */
  replay: boolean;
  /** Drops the text frame with this index (from 0) from every stream connection. */
  dropFrame: number | null;
}

interface Recorded {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

export interface Proxy {
  url: string;
  tamper: Tamper;
  close(): Promise<void>;
}

/** The length of the first complete WebSocket frame in `buffer` and its opcode, or null when it is incomplete. Server frames are unmasked. */
function frameAt(buffer: Buffer): { length: number; opcode: number } | null {
  if (buffer.length < 2) return null;
  const small = (buffer[1] ?? 0) & 0x7f;
  const header = small === 126 ? 4 : small === 127 ? 10 : 2;
  if (buffer.length < header) return null;
  const payload = small === 126 ? buffer.readUInt16BE(2) : small === 127 ? Number(buffer.readBigUInt64BE(2)) : small;
  const length = header + payload;
  return buffer.length < length ? null : { length, opcode: (buffer[0] ?? 0) & 0x0f };
}

/** Starts a plain-HTTP proxy to the TLS node at `target`, which uses a self-signed certificate. */
export async function startProxy(target: string): Promise<Proxy> {
  const tamper: Tamper = { flipBodyByte: false, replay: false, dropFrame: null };
  const recorded = new Map<string, Recorded>();
  const server: Server = createServer((req, res) => {
    const path = req.url ?? "/";
    const send = (r: Recorded) => {
      res.writeHead(r.status, r.headers);
      res.end(r.body);
    };
    const earlier = recorded.get(path);
    if (tamper.replay && earlier) return send(earlier);
    const upstream = httpsRequest(target + path, { method: req.method, headers: { ...req.headers, host: new URL(target).host }, rejectUnauthorized: false }, (answer) => {
      const chunks: Buffer[] = [];
      answer.on("data", (chunk: Buffer) => chunks.push(chunk));
      answer.on("end", () => {
        const body = Buffer.concat(chunks);
        const answered = { status: answer.statusCode ?? 502, headers: answer.headers, body: Buffer.from(body) };
        recorded.set(path, answered);
        if (tamper.flipBodyByte && body.length > 0) body[Math.floor(body.length / 2)] = (body[Math.floor(body.length / 2)] ?? 0) ^ 0x01;
        send({ ...answered, body });
      });
    });
    upstream.on("error", () => res.writeHead(502).end());
    req.pipe(upstream);
  });
  server.on("upgrade", (req, client) => {
    const upstream = httpsRequest(target + (req.url ?? "/"), { headers: { ...req.headers, host: new URL(target).host }, rejectUnauthorized: false });
    upstream.on("upgrade", (answer, node, head) => {
      client.write(`HTTP/1.1 101 Switching Protocols\r\n${answer.rawHeaders.reduce((text, item, i) => text + (i % 2 === 0 ? `${item}: ` : `${item}\r\n`), "")}\r\n`);
      let pending = Buffer.from(head);
      let text = 0;
      const forward = (chunk: Buffer) => {
        pending = Buffer.concat([pending, chunk]);
        for (let frame = frameAt(pending); frame !== null; frame = frameAt(pending)) {
          const bytes = pending.subarray(0, frame.length);
          pending = pending.subarray(frame.length);
          const index = frame.opcode === 1 ? text++ : -1;
          if (index !== tamper.dropFrame || index === -1) client.write(bytes);
        }
      };
      forward(Buffer.alloc(0));
      node.on("data", forward);
      client.on("data", (chunk) => node.write(chunk));
      for (const socket of [node, client]) socket.on("close", () => { node.destroy(); client.destroy(); }).on("error", () => {});
    });
    upstream.on("error", () => client.destroy());
    upstream.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, tamper, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
