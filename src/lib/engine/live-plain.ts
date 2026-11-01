/** Unsigned reads of the node: routes the attestation itself authenticates, read as text. */

import { EngineError } from "./client";
import type { LiveDeps } from "./live";

/**
 * An unsigned read of a route the attestation itself authenticates: its status, and its body as
 * text when 200.
 * Error cases:
 * - the node does not answer
 */
export async function plain(deps: LiveDeps, path: string): Promise<{ status: number; text: string }> {
  try {
    const response = await deps.fetch(deps.origin + path, { cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", signal: deps.signal?.() ?? AbortSignal.timeout(10_000) });
    return { status: response.status, text: response.status === 200 ? await response.text() : "" };
  } catch (cause) {
    throw new EngineError(0, "The node did not answer.", null, { cause });
  }
}

/**
 * `plain`, requiring a 200.
 * Error cases:
 * - the route does not answer 200: an `EngineError` naming the path and status
 */
export async function plainText(deps: LiveDeps, path: string): Promise<string> {
  const { status, text } = await plain(deps, path);
  if (status !== 200) throw new EngineError(status, `The node did not serve ${path} (HTTP ${status}).`);
  return text;
}

/**
 * The attestation's vendor collateral, if the node serves any; null on its 404.
 * Error cases:
 * - the route answers anything but 200 or 404
 */
export async function collateral(deps: LiveDeps): Promise<string | null> {
  const { status, text } = await plain(deps, "/v1/attestation/collateral");
  if (status === 404) return null;
  if (status !== 200) throw new EngineError(status, `The node did not serve the attestation's collateral (HTTP ${status}).`);
  return text;
}
