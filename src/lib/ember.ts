/**
 * TEMPORARY design aid: candidate pinks for the `ember` token, each at glow's chroma (0.175) and the
 * highest lightness the sRGB gamut holds at its hue, with a lighter hover as glow-hover is. Remove the
 * losing candidates, and this switch, once the owner chooses.
 */

export type EmberId = "h0" | "h350" | "h340";

export interface EmberCandidate {
  id: EmberId;
  label: string;
  base: string;
  hover: string;
}

export const EMBER_CANDIDATES: readonly EmberCandidate[] = [
  { id: "h0", label: "Hue 0°: oklch(0.737 0.175 0) #ff74a5", base: "#ff74a5", hover: "#ff91b5" },
  { id: "h350", label: "Hue 350°: oklch(0.756 0.175 350) #ff7cbf", base: "#ff7cbf", hover: "#ff97ca" },
  { id: "h340", label: "Hue 340°: oklch(0.780 0.175 340) #ff86da", base: "#ff86da", hover: "#ffa0e0" },
];

export const DEFAULT_EMBER: EmberId = "h350";

/** The candidate for `id`; the default if none matches. */
export function emberFor(id: string): EmberCandidate {
  return EMBER_CANDIDATES.find((c) => c.id === id) ?? EMBER_CANDIDATES[1] ?? { id: "h350", label: "", base: "#ff7cbf", hover: "#ff97ca" };
}
