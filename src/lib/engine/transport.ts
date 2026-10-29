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
}

const decoder = new TextDecoder();

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
  const { error, reason } = typeof body === "object" && body !== null ? (body as { error?: unknown; reason?: unknown }) : {};
  const message = typeof error === "string" ? error : `The node answered HTTP ${status}.`;
  // The node names the region refusal in `reason`; the console's reject types mirror the engine's.
  const reject = status === 403 && typeof reason === "string" ? ({ kind: "access", reason } as EngineError["reject"]) : null;
  return new EngineError(status, message, reject);
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
    const signer = await this.deps.trust.signer();
    try {
      return await this.attempt(path, signer);
    } catch (error) {
      if (!(error instanceof SignatureError) || !(await this.deps.trust.recheck(signer))) throw error;
      // The enclave restarted and the new attestation verified: answer the same request again under it.
      return this.attempt(path, await this.deps.trust.signer());
    }
  }

  private async attempt(path: string, signer: string): Promise<unknown> {
    const challenge = this.deps.challenge();
    let response: Response;
    let bytes: Uint8Array;
    try {
      response = await this.deps.fetch(this.deps.origin + path, {
        headers: { [CHALLENGE_HEADER]: challenge }, cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
      });
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (cause) {
      throw new EngineError(0, "The node did not answer.", null, { cause });
    }
    const header = (name: string) => response.headers.get(name);
    if (header(SIGNATURE_HEADER) === null) throw unsigned(response.status);
    const checked = this.deps.verifier().verifyResponse({
      signer, chainId: this.deps.chainId, vault: this.deps.vault, challenge, method: "GET", pathAndQuery: path, requestBody: new Uint8Array(),
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
    try {
      return JSON.parse(text);
    } catch (cause) {
      throw new UntrustedError("The node's signed answer was not JSON.", { cause });
    }
  }
}
