/** `fetch` to the node with a fresh challenge, answering only with data the attested enclave signed for that request. */

import { EngineError } from "./client";
import { SignatureError, UntrustedError, type NodeTrust } from "./trust";
import { SupersededAnswer, UnsignedAnswer } from "./trust-errors";
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

function unsigned(status: number): UnsignedAnswer {
  return new UnsignedAnswer(`The server's response (HTTP ${status}) was not signed by the verified server, so it was rejected.`);
}

/** The refusal of a verified answer under `signer`, a key put aside while it was in flight, carrying the JSON of a 2xx answer signed within the clock tolerance (`fresh`), which can still say what it named of the signer. */
function superseded(why: string, fresh: boolean, bytes: Uint8Array, signer: string): UntrustedError {
  if (!fresh) return new UntrustedError(why);
  try {
    return new SupersededAnswer(why, JSON.parse(decoder.decode(bytes)), signer);
  } catch {
    // Not JSON: it names nothing.
    return new UntrustedError(why);
  }
}

/** The error a signed non-2xx answer stands for. */
function refusal(status: number, text: string, retryAfter: string | null = null): EngineError {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const { error, reason, expected, tier, requests_per_second: perSecond } = typeof body === "object" && body !== null ? (body as { error?: unknown; reason?: unknown; expected?: unknown; tier?: unknown; requests_per_second?: unknown }) : {};
  const message = typeof error === "string" ? error : `The server returned an error (HTTP ${status}).`;
  // The node names the region refusal in `reason`; the console's reject types mirror the engine's.
  if (status === 403 && typeof reason === "string") return new EngineError(status, message, { kind: "access", reason } as EngineError["reject"]);
  // A signed request whose nonce is not the account's next: the node names the one it expects.
  // `Number.isSafeInteger` held, so `expected` is a number.
  if (status === 409 && Number.isSafeInteger(expected)) return new EngineError(status, message, { kind: "invalid_nonce", expected: expected as number });
  if (status === 401) return new EngineError(status, message, { kind: message === "missing signature" ? "missing_signature" : "invalid_signature" });
  const refused = new EngineError(status, message);
  // The screening step's own refusals, which the node words in its terms; neither used the nonce, and neither reached the log.
  if (status === 503 && (message === "screening is at capacity" || message === "declaration screening is at capacity")) refused.screening = "busy";
  if (status === 409 && message === "the same request is already being screened") refused.screening = "duplicate";
  // A credited account over its volume tier's request rate: the signed body names the tier and its rate.
  // `Number.isSafeInteger` held for both, so they are numbers.
  if (status === 429 && Number.isSafeInteger(tier) && Number.isSafeInteger(perSecond)) refused.tierLimit = { tier: tier as number, requestsPerSecond: perSecond as number };
  // A node not ready yet names, in whole seconds, when to ask again; the header is outside the signature, so callers bound it.
  if (status === 503 && retryAfter !== null && /^\d{1,6}$/.test(retryAfter.trim())) refused.retryAfterMs = Number(retryAfter.trim()) * 1000;
  return refused;
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

  /**
   * `GET path`, answered under `signer`, an enclave just verified and not yet trusted, as the check of the node's own word on the
   * vault's signer needs. The answer is judged by that check, so this one does not refuse a signer put aside.
   */
  async getUnder(path: string, signer: string): Promise<unknown> {
    return (await this.attempt("GET", path, null, signer, false)).body;
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
   * Error cases: as `get`, and the last gate refuses it before it leaves: `NotSentError`.
   */
  async post(path: string, body: unknown): Promise<SignedAnswer> {
    return this.attempt("POST", path, JSON.stringify(body), await this.deps.trust.sendingSigner());
  }

  /** `DELETE path` with `body` as JSON, resolving with the signed answer of a 2xx; as `post`, never sent again after an answer that does not verify. */
  async delete(path: string, body: unknown): Promise<SignedAnswer> {
    return this.attempt("DELETE", path, JSON.stringify(body), await this.deps.trust.sendingSigner());
  }

  private async attempt(method: "GET" | "POST" | "DELETE", path: string, requestBody: string | null, signer: string, judged = true): Promise<SignedAnswer> {
    const challenge = this.deps.challenge();
    let response: Response;
    let bytes: Uint8Array;
    try {
      const headers: Record<string, string> = { [CHALLENGE_HEADER]: challenge };
      if (requestBody !== null) headers["Content-Type"] = "application/json";
      // No `cache` mode: Chrome skips its preflight cache for `no-store` and `no-cache`, so the node's
      // `Access-Control-Max-Age` would never apply. A cached answer still cannot pass: the challenge is new per request and signed.
      response = await this.deps.fetch(this.deps.origin + path, {
        method, headers, ...(requestBody === null ? {} : { body: requestBody }), credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", signal: this.deps.signal(),
      });
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (cause) {
      throw new EngineError(0, "The server did not respond.", null, { cause });
    }
    const header = (name: string) => response.headers.get(name);
    if (header(SIGNATURE_HEADER) === null) throw unsigned(response.status);
    const checked = this.deps.verifier().verifyResponse({
      signer, chainId: this.deps.chainId, vault: this.deps.vault, challenge, method, pathAndQuery: path, requestBody: requestBody === null ? new Uint8Array() : encoder.encode(requestBody),
      status: response.status, signature: header(SIGNATURE_HEADER), time: header(TIME_HEADER), seq: header(SEQ_HEADER), echoedChallenge: header(CHALLENGE_HEADER), body: bytes,
    });
    if (!checked.ok) throw new SignatureError(`The server's response failed verification: ${checked.reason}.`);
    const skewMs = checked.response.timeMs - this.deps.nowMs();
    // The vault named another signer while this request was in flight: an answer from the key it no longer names is discarded, valid as its signature is.
    if (judged && this.deps.trust.refuses(signer)) throw superseded(this.deps.trust.whyRefused(signer), response.ok && Math.abs(skewMs) <= CLOCK_TOLERANCE_MS, bytes, signer);
    if (Math.abs(skewMs) > CLOCK_TOLERANCE_MS) {
      this.deps.trust.clockWrong(skewMs);
      throw new UntrustedError(`Your device clock differs from the server's time by ${Math.round(Math.abs(skewMs) / 1000)} seconds, so the server's response was rejected. Correct the clock and reload the page.`);
    }
    this.deps.trust.clockRight();
    const text = decoder.decode(bytes);
    if (!response.ok) throw refusal(response.status, text, header("Retry-After"));
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch (cause) {
      throw new UntrustedError("The server's response could not be read.", { cause });
    }
    const seq = header(SEQ_HEADER) === null ? NaN : Number(header(SEQ_HEADER));
    return { body, timeMs: checked.response.timeMs, seq: Number.isSafeInteger(seq) ? seq : null };
  }
}
