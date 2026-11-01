/** The node's signed-answer wire format: header names, the challenge, and the stream envelope (engine-wire). */

import type { MarketQuote, SignedWithdrawal, StreamMessage } from "./types";

export const CHALLENGE_HEADER = "X-Engine-Challenge";
export const SIGNATURE_HEADER = "X-Engine-Signature";
export const TIME_HEADER = "X-Engine-Time";
export const SEQ_HEADER = "X-Engine-Seq";

const CHALLENGE_HEX = /^[0-9a-f]{64}$/;

/** A fresh 32-byte challenge as 64 lowercase hex characters, from the browser's random source. */
export function newChallenge(fill: (bytes: Uint8Array) => void = (bytes) => void crypto.getRandomValues(bytes)): string {
  const bytes = new Uint8Array(32);
  fill(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isChallenge(value: string): boolean {
  return CHALLENGE_HEX.test(value);
}

/** One frame of a signed stream connection: `msg` is the message as the JSON text that was signed. */
export interface SignedFrame {
  v: 1;
  n: number;
  time: number;
  msg: string;
  sig: string;
}

/** A signed heartbeat: `head` is the last log offset the node has flushed, or null before the first. */
export interface Heartbeat {
  type: "heartbeat";
  head: string | null;
}

/** Reads one WebSocket text frame as a signed envelope; null when it is not one. */
export function parseSignedFrame(text: string): SignedFrame | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { v, n, time, msg, sig } = value as Record<string, unknown>;
  if (v !== 1 || !Number.isSafeInteger(n) || !Number.isSafeInteger(time) || typeof msg !== "string" || typeof sig !== "string") return null;
  return { v, n: n as number, time: time as number, msg, sig };
}

/** A refusal of the connection's `quotes` op: an uncredited account, an unknown market, too many markets. */
export interface QuoteError {
  type: "quote_error";
  error: string;
}

/** A signed withdrawal entry of the log, at its offset. */
export type WithdrawalEntry = SignedWithdrawal & { type: "withdrawal"; offset: string };

/** A signed checkpoint entry of the log; the console reads where it sits and the root it commits to. */
export interface CheckpointEntry {
  type: "checkpoint";
  offset: string;
  seq: number;
  /** The 0x-prefixed keccak-256 state root the enclave signed at `seq`. */
  root: string;
}

export type FrameMessage = StreamMessage | Heartbeat | MarketQuote | QuoteError | WithdrawalEntry | CheckpointEntry;

/** Reads a verified frame's message: a log entry, a heartbeat, or a quote; null for any other shape. */
export function parseFrameMessage(msg: string): FrameMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(msg);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { type } = value as { type?: unknown };
  if (type === "heartbeat") {
    const { head } = value as { head?: unknown };
    return head === null || typeof head === "string" ? { type, head } : null;
  }
  if (type === "quote_error") {
    const { error } = value as { error?: unknown };
    return typeof error === "string" ? { type, error } : null;
  }
  // The enclave signed these, so past their tag their shape is the engine's.
  if (type === "command" || type === "quote" || type === "withdrawal" || type === "checkpoint") return value as FrameMessage;
  return null;
}
