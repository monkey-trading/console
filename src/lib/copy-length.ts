/** The length limits interface-copy sets on help text (`agents/rules/interface-copy.md`), and how text is counted against them. */

/** Where help text shows: in a tooltip, or as a note under a control. */
export type HelpKind = "tooltip" | "note";

/** The most sentences and words each kind of help text may hold; null for no word limit. */
export const HELP_LIMITS: Record<HelpKind, { sentences: number; words: number | null }> = {
  tooltip: { sentences: 2, words: 40 },
  note: { sentences: 2, words: null },
};

/** The words in `text`: each run of characters between spaces that holds a letter or a digit. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/** The sentences in `text`: each part that a full stop, question mark or exclamation mark ends before a space, and any words after the last. A decimal point ends none. */
export function countSentences(text: string): number {
  return text.split(/(?<=[.!?]["')\]]*)\s+/).filter((part) => /[\p{L}\p{N}]/u.test(part)).length;
}

/** What `text` holds when it exceeds the limits of `kind`, such as "3 sentences, 52 words"; null within them. */
export function overLimit(kind: HelpKind, text: string): string | null {
  const { sentences, words } = HELP_LIMITS[kind];
  const counted = { sentences: countSentences(text), words: countWords(text) };
  const over = counted.sentences > sentences || (words !== null && counted.words > words);
  return over ? `${counted.sentences} sentences, ${counted.words} words` : null;
}
