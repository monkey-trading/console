/** What a MONKEY panel says of a read that has not given it a figure, or whose last attempt failed. */

import type { Read } from "@/lib/monkey/figures";

import { NOTE } from "./styles";

/** A read's message is a sentence, which may already end in a full stop. */
const sentence = (message: string) => message.replace(/\.+$/, "");

/**
 * A line while a first read is pending, a calm one for a node without the route, and the reason
 * for a failure, which shows even beside the last figures the panel still holds. `quiet` keeps the
 * pending line for screen readers alone, for a card whose dashed figures already hold its loaded
 * shape, so the line's leaving moves nothing below.
 */
export function ReadNote({ read, loading = "Reading the node's figures…", quiet = false }: { read: Pick<Read<unknown>, "status" | "value" | "message">; loading?: string; quiet?: boolean }) {
  if (read.status === "unavailable") return <p className={NOTE}>This node does not serve these figures yet.</p>;
  if (read.status === "failed") return <p role="status" className="text-caption leading-relaxed text-amber">Could not read: {sentence(read.message ?? "the read failed")}. It is tried again at the next refresh.</p>;
  if (read.status === "loading" && read.value === null) return <p className={quiet ? "sr-only" : NOTE}>{loading}</p>;
  return null;
}
