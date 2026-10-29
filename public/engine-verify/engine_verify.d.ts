/* tslint:disable */
/* eslint-disable */

/**
 * Who must have signed an answer, for which deployment, and the challenge the request carried.
 */
export class ExpectedSigner {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * `signer` is the verified attestation's `enclaveAddress`, `chainId` and `vault` the
     * deployment's, and `challenge` the 64 hex digits the request or connection sent.
     * Error cases:
     * - an address is not `0x` and 40 hex digits, or the challenge is not 64 hex digits
     */
    constructor(signer: string, chain_id: bigint, vault: string, challenge: string);
}

/**
 * Checks one signed stream connection's frames in the order received. Once a frame fails, every
 * later one does too, and the page closes the connection.
 */
export class FrameVerifier {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * A verifier for the connection that `GET` of `pathAndQuery`, exactly as sent, opened with
     * `expected`'s challenge.
     */
    constructor(expected: ExpectedSigner, path_and_query: string);
    /**
     * Checks the connection's next frame, its JSON text as received, and returns its message: the
     * unsigned stream's frame, as JSON text.
     * Error cases:
     * - see `engine_wire::FrameVerifier::verify_text`
     */
    verifyFrame(frame: string): string;
}

/**
 * What an attestation proves: the enclave whose signed answers the page then accepts.
 */
export class VerifiedAttestation {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The release's name for the node's configuration file; absent for a mock.
     */
    readonly configName: string | undefined;
    /**
     * `0x` and 40 lower-case hex digits: the address that signs the enclave's answers.
     */
    readonly enclaveAddress: string;
    /**
     * True only for a mock attestation read by `verifyMockAttestation`, where nothing proves an
     * enclave; a page that accepts one says so on screen.
     */
    readonly mock: boolean;
    /**
     * The release manifest that admitted the quote; absent for a mock.
     */
    readonly releaseName: string | undefined;
    /**
     * `0x` and 64 hex digits: SHA-256 of the API TLS key's DER SubjectPublicKeyInfo.
     */
    readonly tlsPublicKeySha256: string;
    /**
     * The first Unix millisecond at which every date check passes; absent for a mock. Dates are
     * checked in whole seconds, so `nowMs` verifies exactly from `validFromMs` to `validUntilMs`.
     */
    readonly validFromMs: number | undefined;
    /**
     * The last Unix millisecond at which every date check passes; absent for a mock. A clock
     * outside the window, such as the node's signed time, would not have given this verdict.
     */
    readonly validUntilMs: number | undefined;
}

/**
 * What a verified response's signature vouches for besides its body.
 */
export class VerifiedResponse {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The log head's seq when it answered.
     */
    readonly headSeq: bigint;
    readonly status: number;
    /**
     * The node's time when it answered, in Unix milliseconds.
     */
    readonly timeMs: number;
}

/**
 * Verifies the attestation `/v1/attestation` served against the release manifests' TOML texts, with
 * the collateral `/v1/attestation/collateral` served, checking every date at `nowMs`, and pinning
 * the chain to the vendor roots plus `extraRootPem` when given (a test or private chain only). A
 * mock quote never verifies.
 * Error cases:
 * - `nowMs` is not a finite number, or an input does not parse
 * - see `engine_verify::verify_attestation`
 */
export function verifyAttestation(attestation: string, manifests: string[], collateral: string, now_ms: number, extra_root_pem?: string | null): VerifiedAttestation;

/**
 * Reads a mock attestation, for a development node only: the result says `mock`, and no release,
 * configuration, or time window vouches for it. A page calls this only in a development build and
 * shows that the attestation is a mock.
 * Error cases:
 * - the attestation does not parse
 * - see `engine_verify::verify_mock_attestation`
 */
export function verifyMockAttestation(attestation: string): VerifiedAttestation;

/**
 * Verifies a response as `expected`'s answer to the request sent: its method, path and query, and
 * body exactly as sent; the status; the values of `X-Engine-Signature`, `X-Engine-Time`,
 * `X-Engine-Seq`, and `X-Engine-Challenge` (`null` or `undefined` when absent); and the body as
 * received. A response without a signature is never relied on.
 * Error cases:
 * - see `engine_wire::verify_received`
 */
export function verifyResponse(expected: ExpectedSigner, method: string, path_and_query: string, request_body: Uint8Array, status: number, signature: string | null | undefined, time: string | null | undefined, seq: string | null | undefined, challenge: string | null | undefined, body: Uint8Array): VerifiedResponse;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_expectedsigner_free: (a: number, b: number) => void;
    readonly __wbg_frameverifier_free: (a: number, b: number) => void;
    readonly __wbg_get_verifiedattestation_configName: (a: number) => [number, number];
    readonly __wbg_get_verifiedattestation_enclaveAddress: (a: number) => [number, number];
    readonly __wbg_get_verifiedattestation_mock: (a: number) => number;
    readonly __wbg_get_verifiedattestation_releaseName: (a: number) => [number, number];
    readonly __wbg_get_verifiedattestation_tlsPublicKeySha256: (a: number) => [number, number];
    readonly __wbg_get_verifiedattestation_validFromMs: (a: number) => [number, number];
    readonly __wbg_get_verifiedattestation_validUntilMs: (a: number) => [number, number];
    readonly __wbg_get_verifiedresponse_headSeq: (a: number) => bigint;
    readonly __wbg_get_verifiedresponse_status: (a: number) => number;
    readonly __wbg_get_verifiedresponse_timeMs: (a: number) => number;
    readonly __wbg_verifiedattestation_free: (a: number, b: number) => void;
    readonly __wbg_verifiedresponse_free: (a: number, b: number) => void;
    readonly expectedsigner_new: (a: number, b: number, c: bigint, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly frameverifier_new: (a: number, b: number, c: number) => number;
    readonly frameverifier_verifyFrame: (a: number, b: number, c: number) => [number, number, number, number];
    readonly verifyAttestation: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number];
    readonly verifyMockAttestation: (a: number, b: number) => [number, number, number];
    readonly verifyResponse: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number) => [number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
