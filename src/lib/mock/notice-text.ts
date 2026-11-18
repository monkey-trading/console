/** What the engine allows a status notice to say (`crates/core/src/notice.rs`), checked as the mock's controls publish one. */

/** The most characters a notice may hold. */
export const MAX_NOTICE_CHARS = 280;

/** Control characters, and the ones that render nothing or break a line: separators, zero-width and bidirectional marks, variation selectors and fillers. Close to the engine's list, not the whole of it. */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]|͏|ᅟ|ᅠ|឴|឵|[᠋-᠏]|ㅤ|[︀-️]|ﾠ/u;

/** Why the node would refuse `text` as a notice, written for the person at the demo controls, or null when it would accept it. */
export function noticeProblem(text: string): string | null {
  if (text.trim() === "") return "The notice must not be empty.";
  if (text.trim() !== text) return "The notice must not begin or end with a space.";
  if ([...text].length > MAX_NOTICE_CHARS) return `The notice must not exceed ${MAX_NOTICE_CHARS} characters.`;
  if (INVISIBLE.test(text)) return "The notice must not contain line breaks or other control characters.";
  if (/[<>&[\]]/.test(text)) return "The notice must not contain the characters < > & [ or ].";
  const lower = text.toLowerCase();
  if (["://", "www.", "mailto:"].some((marker) => lower.includes(marker))) return "The notice must not contain a link.";
  return null;
}
