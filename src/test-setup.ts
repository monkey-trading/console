/** Loaded before every test file: the session key signer is a lazy chunk in the page (monkey-trading/console#338), which a live session loads before its store exists; the tests build stores directly. */

import { loadSessionKeySigner } from "@/lib/engine/session-key-class";

await loadSessionKeySigner();
