/** The operator's status notice, `GET /v1/notice` and the signed stream's `notice` frames, as `crates/node/src/api/notice.rs` serializes it (monkey-trading/engine#927). */

/** The notice in force: its plain text (1 to 280 characters, no markup or links) and the sequenced time it was set. */
export interface StatusNotice {
  text: string;
  set_at_ms: number;
}

/** The body of the route and of a frame: the notice, or null while none is in force. */
export interface NoticeBody {
  notice: StatusNotice | null;
}

/** The body's notice, or undefined when `body` is not the shape the route answers. */
export function noticeOf(body: unknown): StatusNotice | null | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { notice } = body as { notice?: unknown };
  if (notice === null) return null;
  if (typeof notice !== "object" || Array.isArray(notice)) return undefined;
  const { text, set_at_ms } = notice as { text?: unknown; set_at_ms?: unknown };
  return typeof text === "string" && text !== "" && typeof set_at_ms === "number" ? { text, set_at_ms } : undefined;
}

/** Whether two readings are the same notice. */
export function sameNotice(a: StatusNotice | null, b: StatusNotice | null): boolean {
  return a === b || (a !== null && b !== null && a.text === b.text && a.set_at_ms === b.set_at_ms);
}
