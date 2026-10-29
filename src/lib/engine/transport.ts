/** `fetch` to the node with a fresh challenge, answering only with data the attested enclave signed for that request. */

import { EngineError } from "./client";
import { SignatureError, UntrustedError, type NodeTrust } from "./trust";
import { CHALLENGE_HEADER, SEQ_HEADER, SIGNATURE_HEADER, TIME_HEADER } from "./wire";
import type { Verifier } from "./verifier";

/** How far the node's signed time may be from the device clock, in milliseconds. */
export const CLOCK_TOLERANCE_MS = 30_000;

export interface TransportDeps {
  origin: string;
  chainId: number;
  vault: string;
  /** The verifier, which `trust.signer()` has loaded by the time a response is checked. */
  verifier(): Verifier;
  trust: NodeTrust;
  fetch: typeof fetch;
  nowMs(): number;
  challenge(): string;
  /** A signal that aborts a request, and the read of its body, when the node stalls. */
  signal(): AbortSignal;
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function unsigned(status: number): UntrustedError {
  return new UntrustedError(`The node's answer (HTTP ${status}) was not signed by the attested enclave, so it was discarded.`);
}

/** The error a signed non-2xx answer stands for. */
function refusal(status: number, text: string): EngineError {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const { error, reason, expected } = typeof body === "object" && body !== null ? (body as { error?: unknown; reason?: unknown; expected?: unknown }) : {};
  const message = typeof error === "string" ? error : `The node answered HTTP ${status}.`;
  // The node names the region refusal in `reason`; the console's reject types mirror the engine's.
  if (status === 403 && typeof reason === "string") return new EngineError(status, message, { kind: "access", reason } as EngineError["reject"]);
  // A signed request whose nonce is not the account's next: the node names the one it expects.
  if (status === 409 && Number.isSafeInteger(expected)) return new EngineError(status, message, { kind: "invalid_nonce", expected: expected as number });
  if (status === 401) return new EngineError(status, message, { kind: message === "missing signature" ? "missing_signature" : "invalid_signature" });
  return new EngineError(status, message);
}

/** A verified answer: its parsed JSON, the node's signed time, and the log head it was answered at. */
export interface SignedAnswer {
  body: unknown;
  timeMs: number;
  seq: number | null;
}

export class SignedTransport {
  constructor(private readonly deps: TransportDeps) {}

  /**
   * `GET path`, resolving with the parsed JSON of a 2xx answer.
   * Error cases:
   * - the answer is unsigned, or its signature does not verify for this request under the attested address: `UntrustedError`
   * - the device clock is off the node's signed time by more than 30 s: `UntrustedError`, and the session shows the clock as wrong
   * - the node refuses the request in a signed answer: `EngineError`
   */
  async get(path: string): Promise<unknown> {
    return (await this.getSigned(path)).body;
  }

  /** `get`, with the node's signed time of the answer. */
  async getSigned(path: string): Promise<SignedAnswer> {
    const signer = await this.deps.trust.signer();
    try {
      return await this.attempt("GET", path, null, signer);
    } catch (error) {
      if (!(error instanceof SignatureError) || !(await this.deps.trust.recheck(signer))) throw error;
      // The enclave restarted and the new attestation verified: answer the same request again under it.
      return this.attempt("GET", path, null, await this.deps.trust.signer());
    }
  }

  /**
   * `POST path` with `body` as JSON, resolving with the signed answer of a 2xx. Never sent again
   * after an answer that does not verify: the request may have been sequenced, and the account's
   * nonce makes a resend fail anyway.
   * Error cases: as `get`.
   */
  async post(path: string, body: unknown): Promise<SignedAnswer> {
    return this.attempt("POST", path, JSON.stringify(body), await this.deps.trust.signer());
  }

  private async attempt(method: "GET" | "POST", path: string, requestBody: string | null, signer: string): Promise<SignedAnswer> {
    const challenge = this.deps.challenge();
    let response: Response;
    let bytes: Uint8Array;
    try {
      const headers: Record<string, string> = { [CHALLENGE_HEADER]: challenge };
      if (requestBody !== null) headers["Content-Type"] = "application/json";
      response = await this.deps.fetch(this.deps.origin + path, {
        method, headers, ...(requestBody === null ? {} : { body: requestBody }), cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", signal: this.deps.signal(),
      });
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (cause) {
      throw new EngineError(0, "The node did not answer.", null, { cause });
    }
    const header = (name: string) => response.headers.get(name);
    if (header(SIGNATURE_HEADER) === null) throw unsigned(response.status);
    const checked = this.deps.verifier().verifyResponse({
      signer, chainId: this.deps.chainId, vault: this.deps.vault, challenge, method, pathAndQuery: path, requestBody: requestBody === null ? new Uint8Array() : encoder.encode(requestBody),
      status: response.status, signature: header(SIGNATURE_HEADER), time: header(TIME_HEADER), seq: header(SEQ_HEADER), echoedChallenge: header(CHALLENGE_HEADER), body: bytes,
    });
    if (!checked.ok) throw new SignatureError(`The node's answer did not verify: ${checked.reason}.`);
    const skewMs = checked.response.timeMs - this.deps.nowMs();
    if (Math.abs(skewMs) > CLOCK_TOLERANCE_MS) {
      this.deps.trust.clockWrong(skewMs);
      throw new UntrustedError(`Your device clock differs from the node's signed time by ${Math.round(Math.abs(skewMs) / 1000)} s, so the answer was discarded. Correct the clock and reload.`);
    }
    this.deps.trust.clockRight();
    const text = decoder.decode(bytes);
    if (!response.ok) throw refusal(response.status, text);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch (cause) {
      throw new UntrustedError("The node's signed answer was not JSON.", { cause });
    }
    const seq = header(SEQ_HEADER) === null ? NaN : Number(header(SEQ_HEADER));
    return { body, timeMs: checked.response.timeMs, seq: Number.isSafeInteger(seq) ? seq : null };
  }
}
