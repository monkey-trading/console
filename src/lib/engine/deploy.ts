/** The deployment a build pins: the node it talks to, its chain and vault, and what the build trusts. */

export type EngineMode =
  /** The in-browser mock node, accepting its own mock attestation. */
  | "mock"
  /** A live node, a dev build: it may accept the node's mock attestation if the origin is a dev origin. */
  | "live-dev"
  /** A live node, a production build: it refuses a mock attestation and the dev stub verifier. */
  | "live";

export interface Deploy {
  mode: EngineMode;
  /** The node's origin, `https://host[:port]`; null for the mock. */
  origin: string | null;
  chainId: number | null;
  /** The vault address, lowercase `0x` hex. */
  vault: string | null;
  usdc: string | null;
  /** The node's `[api] heartbeat_interval`, which the attestation binds. */
  heartbeatMs: number;
  /** Node origins a `live-dev` build may accept a mock attestation from. */
  devOrigins: readonly string[];
  /** The chain's RPC URL a wallet that does not know the chain is offered, such as a local Anvil chain's; null when wallets know it. */
  rpcUrl: string | null;
  /** The WalletConnect project id; null leaves WalletConnect out of the build. */
  walletConnectProjectId: string | null;
}

/** The raw `NEXT_PUBLIC_ENGINE_*` values. */
export interface RawDeploy {
  mode?: string | undefined;
  origin?: string | undefined;
  chainId?: string | undefined;
  vault?: string | undefined;
  usdc?: string | undefined;
  heartbeatMs?: string | undefined;
  devOrigins?: string | undefined;
  rpcUrl?: string | undefined;
  walletConnectProjectId?: string | undefined;
}

const DEFAULT_HEARTBEAT_MS = 5_000;

/** WalletConnect's relay: the one origin besides the node's that a build with a project id talks to. The connector pins the SDK to it and the CSP names it. */
export const WALLETCONNECT_RELAY = "wss://relay.walletconnect.org";

/** WalletConnect's Verify service, whose hidden frame tells the wallet which domain a pairing or request comes from; the CSP allows only its frame. */
export const WALLETCONNECT_VERIFY = "https://verify.walletconnect.org";

/** The raw values from the build environment; Next.js inlines only literal `process.env.NEXT_PUBLIC_*` reads. */
export function rawDeploy(): RawDeploy {
  return {
    mode: process.env.NEXT_PUBLIC_ENGINE_MODE,
    origin: process.env.NEXT_PUBLIC_ENGINE_ORIGIN,
    chainId: process.env.NEXT_PUBLIC_ENGINE_CHAIN_ID,
    vault: process.env.NEXT_PUBLIC_ENGINE_VAULT,
    usdc: process.env.NEXT_PUBLIC_ENGINE_USDC,
    heartbeatMs: process.env.NEXT_PUBLIC_ENGINE_HEARTBEAT_MS,
    devOrigins: process.env.NEXT_PUBLIC_ENGINE_DEV_ORIGINS,
    rpcUrl: process.env.NEXT_PUBLIC_ENGINE_RPC_URL,
    walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
  };
}

/** The `https://host[:port]` origin of `value`, which must be a bare https origin. */
function httpsOrigin(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new Error(`${name} is not a URL: ${value}`, { cause });
  }
  const bare = url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password && !value.endsWith("?") && !value.endsWith("#");
  if (url.protocol !== "https:" || !bare) throw new Error(`${name} must be a bare https origin, such as https://api.example.com: ${value}`);
  return url.origin;
}

function address(value: string | undefined, name: string): string {
  if (value === undefined || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${name} must be a 20-byte 0x address: ${value ?? "unset"}`);
  return value.toLowerCase();
}

/**
 * The deployment `raw` describes. A live mode needs the node's origin, chain id and vault, since
 * the node's answers are only trusted for the deployment the build pins.
 * Error cases:
 * - an unknown mode, or a live mode missing or misspelling a pinned value
 * - a `live-dev` origin that is not listed as a dev origin
 * - an RPC URL that is not http(s), or a WalletConnect project id that is not 32 hex characters
 */
export function parseDeploy(raw: RawDeploy): Deploy {
  const mode = raw.mode === undefined || raw.mode === "" ? "mock" : raw.mode;
  if (mode !== "mock" && mode !== "live-dev" && mode !== "live") throw new Error(`NEXT_PUBLIC_ENGINE_MODE must be mock, live-dev or live: ${mode}`);
  if (mode === "mock") return { mode, origin: null, chainId: null, vault: null, usdc: null, heartbeatMs: DEFAULT_HEARTBEAT_MS, devOrigins: [], rpcUrl: null, walletConnectProjectId: null };
  if (raw.origin === undefined) throw new Error(`NEXT_PUBLIC_ENGINE_ORIGIN is required in ${mode} mode`);
  const origin = httpsOrigin(raw.origin, "NEXT_PUBLIC_ENGINE_ORIGIN");
  const chain = Number(raw.chainId);
  if (raw.chainId === undefined || !Number.isSafeInteger(chain) || chain <= 0) throw new Error(`NEXT_PUBLIC_ENGINE_CHAIN_ID must be a positive integer: ${raw.chainId ?? "unset"}`);
  const heartbeatMs = raw.heartbeatMs === undefined ? DEFAULT_HEARTBEAT_MS : Number(raw.heartbeatMs);
  if (!Number.isSafeInteger(heartbeatMs) || heartbeatMs < 1_000) throw new Error(`NEXT_PUBLIC_ENGINE_HEARTBEAT_MS must be at least 1000: ${raw.heartbeatMs ?? ""}`);
  const devOrigins = (raw.devOrigins ?? "").split(",").map((item) => item.trim()).filter((item) => item !== "").map((item) => httpsOrigin(item, "NEXT_PUBLIC_ENGINE_DEV_ORIGINS"));
  if (mode === "live-dev" && !devOrigins.includes(origin)) throw new Error(`NEXT_PUBLIC_ENGINE_ORIGIN ${origin} is not in NEXT_PUBLIC_ENGINE_DEV_ORIGINS, so a dev build will not talk to it`);
  const projectId = raw.walletConnectProjectId === undefined || raw.walletConnectProjectId === "" ? null : raw.walletConnectProjectId;
  if (projectId !== null && !/^[0-9a-f]{32}$/.test(projectId)) throw new Error(`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID must be 32 lowercase hex characters: ${projectId}`);
  return {
    mode, origin, chainId: chain, vault: address(raw.vault, "NEXT_PUBLIC_ENGINE_VAULT"),
    usdc: raw.usdc === undefined ? null : address(raw.usdc, "NEXT_PUBLIC_ENGINE_USDC"), heartbeatMs, devOrigins,
    rpcUrl: raw.rpcUrl === undefined || raw.rpcUrl === "" ? null : httpUrl(raw.rpcUrl, "NEXT_PUBLIC_ENGINE_RPC_URL"), walletConnectProjectId: projectId,
  };
}

/** `value` as an http(s) URL. */
function httpUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new Error(`${name} is not a URL: ${value}`, { cause });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`${name} must be an http or https URL: ${value}`);
  return url.href;
}

/** The `wss://` origin of the stream for an `https://` node origin. */
export function streamOrigin(origin: string): string {
  return `wss://${new URL(origin).host}`;
}

/** Whether a build in this deployment accepts a node's mock attestation: only the mock itself, or a dev build for a listed dev origin. */
export function acceptsMockAttestation(deploy: Deploy): boolean {
  return deploy.mode === "mock" || (deploy.mode === "live-dev" && deploy.origin !== null && deploy.devOrigins.includes(deploy.origin));
}
