/* @ts-self-types="./engine_verify.d.ts" */

/**
 * Who must have signed an answer, for which deployment, and the challenge the request carried.
 */
export class ExpectedSigner {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ExpectedSignerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_expectedsigner_free(ptr, 0);
    }
    /**
     * `signer` is the verified attestation's `enclaveAddress`, `chainId` and `vault` the
     * deployment's, and `challenge` the 64 hex digits the request or connection sent.
     * Error cases:
     * - an address is not `0x` and 40 hex digits, or the challenge is not 64 hex digits
     * @param {string} signer
     * @param {bigint} chain_id
     * @param {string} vault
     * @param {string} challenge
     */
    constructor(signer, chain_id, vault, challenge) {
        const ptr0 = passStringToWasm0(signer, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(vault, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(challenge, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.expectedsigner_new(ptr0, len0, chain_id, ptr1, len1, ptr2, len2);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        ExpectedSignerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) ExpectedSigner.prototype[Symbol.dispose] = ExpectedSigner.prototype.free;

/**
 * Checks one signed stream connection's frames in the order received. Once a frame fails, every
 * later one does too, and the page closes the connection.
 */
export class FrameVerifier {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        FrameVerifierFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_frameverifier_free(ptr, 0);
    }
    /**
     * A verifier for the connection that `GET` of `pathAndQuery`, exactly as sent, opened with
     * `expected`'s challenge.
     * @param {ExpectedSigner} expected
     * @param {string} path_and_query
     */
    constructor(expected, path_and_query) {
        _assertClass(expected, ExpectedSigner);
        const ptr0 = passStringToWasm0(path_and_query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.frameverifier_new(expected.__wbg_ptr, ptr0, len0);
        this.__wbg_ptr = ret;
        FrameVerifierFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Checks the connection's next frame, its JSON text as received, and returns its message: the
     * unsigned stream's frame, as JSON text.
     * Error cases:
     * - see `engine_wire::FrameVerifier::verify_text`
     * @param {string} frame
     * @returns {string}
     */
    verifyFrame(frame) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(frame, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.frameverifier_verifyFrame(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
}
if (Symbol.dispose) FrameVerifier.prototype[Symbol.dispose] = FrameVerifier.prototype.free;

/**
 * What an attestation proves: the enclave whose signed answers the page then accepts.
 */
export class VerifiedAttestation {
    static __wrap(ptr) {
        const obj = Object.create(VerifiedAttestation.prototype);
        obj.__wbg_ptr = ptr;
        VerifiedAttestationFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        VerifiedAttestationFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_verifiedattestation_free(ptr, 0);
    }
    /**
     * The release's name for the node's configuration file; absent for a mock.
     * @returns {string | undefined}
     */
    get configName() {
        const ret = wasm.__wbg_get_verifiedattestation_configName(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]);
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * `0x` and 40 lower-case hex digits: the address that signs the enclave's answers.
     * @returns {string}
     */
    get enclaveAddress() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.__wbg_get_verifiedattestation_enclaveAddress(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * True only for a mock attestation read by `verifyMockAttestation`, where nothing proves an
     * enclave; a page that accepts one says so on screen.
     * @returns {boolean}
     */
    get mock() {
        const ret = wasm.__wbg_get_verifiedattestation_mock(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * The release manifest that admitted the quote; absent for a mock.
     * @returns {string | undefined}
     */
    get releaseName() {
        const ret = wasm.__wbg_get_verifiedattestation_releaseName(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]);
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * `0x` and 64 hex digits: SHA-256 of the API TLS key's DER SubjectPublicKeyInfo.
     * @returns {string}
     */
    get tlsPublicKeySha256() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.__wbg_get_verifiedattestation_tlsPublicKeySha256(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * The first Unix millisecond at which every date check passes; absent for a mock. Dates are
     * checked in whole seconds, so `nowMs` verifies exactly from `validFromMs` to `validUntilMs`.
     * @returns {number | undefined}
     */
    get validFromMs() {
        const ret = wasm.__wbg_get_verifiedattestation_validFromMs(this.__wbg_ptr);
        return ret[0] === 0 ? undefined : ret[1];
    }
    /**
     * The last Unix millisecond at which every date check passes; absent for a mock. A clock
     * outside the window, such as the node's signed time, would not have given this verdict.
     * @returns {number | undefined}
     */
    get validUntilMs() {
        const ret = wasm.__wbg_get_verifiedattestation_validUntilMs(this.__wbg_ptr);
        return ret[0] === 0 ? undefined : ret[1];
    }
}
if (Symbol.dispose) VerifiedAttestation.prototype[Symbol.dispose] = VerifiedAttestation.prototype.free;

/**
 * What a verified response's signature vouches for besides its body.
 */
export class VerifiedResponse {
    static __wrap(ptr) {
        const obj = Object.create(VerifiedResponse.prototype);
        obj.__wbg_ptr = ptr;
        VerifiedResponseFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        VerifiedResponseFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_verifiedresponse_free(ptr, 0);
    }
    /**
     * The log head's seq when it answered.
     * @returns {bigint}
     */
    get headSeq() {
        const ret = wasm.__wbg_get_verifiedresponse_headSeq(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * @returns {number}
     */
    get status() {
        const ret = wasm.__wbg_get_verifiedresponse_status(this.__wbg_ptr);
        return ret;
    }
    /**
     * The node's time when it answered, in Unix milliseconds.
     * @returns {number}
     */
    get timeMs() {
        const ret = wasm.__wbg_get_verifiedresponse_timeMs(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) VerifiedResponse.prototype[Symbol.dispose] = VerifiedResponse.prototype.free;

/**
 * Verifies the attestation `/v1/attestation` served against the release manifests' TOML texts, with
 * the collateral `/v1/attestation/collateral` served, checking every date at `nowMs`, and pinning
 * the chain to the vendor roots plus `extraRootPem` when given (a test or private chain only). A
 * mock quote never verifies.
 * Error cases:
 * - `nowMs` is not a finite number, or an input does not parse
 * - see `engine_verify::verify_attestation`
 * @param {string} attestation
 * @param {string[]} manifests
 * @param {string} collateral
 * @param {number} now_ms
 * @param {string | null} [extra_root_pem]
 * @returns {VerifiedAttestation}
 */
export function verifyAttestation(attestation, manifests, collateral, now_ms, extra_root_pem) {
    const ptr0 = passStringToWasm0(attestation, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayJsValueToWasm0(manifests, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(collateral, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len2 = WASM_VECTOR_LEN;
    var ptr3 = isLikeNone(extra_root_pem) ? 0 : passStringToWasm0(extra_root_pem, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len3 = WASM_VECTOR_LEN;
    const ret = wasm.verifyAttestation(ptr0, len0, ptr1, len1, ptr2, len2, now_ms, ptr3, len3);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return VerifiedAttestation.__wrap(ret[0]);
}

/**
 * Reads a mock attestation, for a development node only: the result says `mock`, and no release,
 * configuration, or time window vouches for it. A page calls this only in a development build and
 * shows that the attestation is a mock.
 * Error cases:
 * - the attestation does not parse
 * - see `engine_verify::verify_mock_attestation`
 * @param {string} attestation
 * @returns {VerifiedAttestation}
 */
export function verifyMockAttestation(attestation) {
    const ptr0 = passStringToWasm0(attestation, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.verifyMockAttestation(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return VerifiedAttestation.__wrap(ret[0]);
}

/**
 * Verifies a response as `expected`'s answer to the request sent: its method, path and query, and
 * body exactly as sent; the status; the values of `X-Engine-Signature`, `X-Engine-Time`,
 * `X-Engine-Seq`, and `X-Engine-Challenge` (`null` or `undefined` when absent); and the body as
 * received. A response without a signature is never relied on.
 * Error cases:
 * - see `engine_wire::verify_received`
 * @param {ExpectedSigner} expected
 * @param {string} method
 * @param {string} path_and_query
 * @param {Uint8Array} request_body
 * @param {number} status
 * @param {string | null | undefined} signature
 * @param {string | null | undefined} time
 * @param {string | null | undefined} seq
 * @param {string | null | undefined} challenge
 * @param {Uint8Array} body
 * @returns {VerifiedResponse}
 */
export function verifyResponse(expected, method, path_and_query, request_body, status, signature, time, seq, challenge, body) {
    _assertClass(expected, ExpectedSigner);
    const ptr0 = passStringToWasm0(method, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(path_and_query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(request_body, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    var ptr3 = isLikeNone(signature) ? 0 : passStringToWasm0(signature, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len3 = WASM_VECTOR_LEN;
    var ptr4 = isLikeNone(time) ? 0 : passStringToWasm0(time, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len4 = WASM_VECTOR_LEN;
    var ptr5 = isLikeNone(seq) ? 0 : passStringToWasm0(seq, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len5 = WASM_VECTOR_LEN;
    var ptr6 = isLikeNone(challenge) ? 0 : passStringToWasm0(challenge, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len6 = WASM_VECTOR_LEN;
    const ptr7 = passArray8ToWasm0(body, wasm.__wbindgen_malloc);
    const len7 = WASM_VECTOR_LEN;
    const ret = wasm.verifyResponse(expected.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, status, ptr3, len3, ptr4, len4, ptr5, len5, ptr6, len6, ptr7, len7);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return VerifiedResponse.__wrap(ret[0]);
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_string_get_0380ccaa2f57f0d9: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_41e9ee4f547fc59a: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_generic_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./engine_verify_bg.js": import0,
    };
}

const ExpectedSignerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_expectedsigner_free(ptr, 1));
const FrameVerifierFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_frameverifier_free(ptr, 1));
const VerifiedAttestationFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_verifiedattestation_free(ptr, 1));
const VerifiedResponseFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_verifiedresponse_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayJsValueToWasm0(array, malloc) {
    const ptr = malloc(array.length * 4, 4) >>> 0;
    for (let i = 0; i < array.length; i++) {
        const add = addToExternrefTable0(array[i]);
        getDataViewMemory0().setUint32(ptr + 4 * i, add, true);
    }
    WASM_VECTOR_LEN = array.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('engine_verify_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
