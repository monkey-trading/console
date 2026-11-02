/** Where a tooltip sits: against the viewport, below its label or above it, never off an edge. */

export interface Spot {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
}

/** The tallest a tooltip is expected to be, which decides whether it fits below its label. */
const TOOLTIP_ROOM = 160;
const MARGIN = 8;
const MAX_WIDTH = 240;

/**
 * Places a tooltip for the label whose box is `box` inside `viewport`: as wide as it may be, clamped
 * to the viewport's edges, touching the label (so the pointer can cross to it), below it or, with
 * no room below and room above, above it. Null while the label is out of view.
 */
export function placeTooltip(box: { left: number; top: number; bottom: number }, viewport: { width: number; height: number }): Spot | null {
  if (box.bottom < 0 || box.top > viewport.height) return null;
  const width = Math.min(MAX_WIDTH, viewport.width - 2 * MARGIN);
  const left = Math.max(MARGIN, Math.min(box.left, viewport.width - width - MARGIN));
  return box.bottom + TOOLTIP_ROOM > viewport.height && box.top > TOOLTIP_ROOM ? { left, width, bottom: viewport.height - box.top } : { left, width, top: box.bottom };
}
