/** The session key's caps and lifetime, apart from the signer that needs the curves, so the setup text and the mock can name them without loading it. */

/** The engine's registration cap (`MAX_SESSION_KEY_EXPIRY_MS`). */
export const MAX_SESSION_KEY_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** The engine's live-key cap (`MAX_SESSION_KEYS_PER_ACCOUNT`); a refusal naming any other maximum is its budget of new keys, which no revocation refills. */
export const MAX_SESSION_KEYS_PER_ACCOUNT = 10;

/** How long one login authorizes the key: the engine's registration cap, less a minute so a clock step cannot pass it. */
export const SESSION_KEY_TTL_MS = MAX_SESSION_KEY_EXPIRY_MS - 60_000;

/** The expiry a registration signed at node time `nowMs` may name. */
export const sessionKeyExpiry = (nowMs: number): number => nowMs + SESSION_KEY_TTL_MS;
