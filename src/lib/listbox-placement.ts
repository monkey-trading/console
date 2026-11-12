/**
 * Where an open listbox sits so every option stays inside the viewport: under enlarged text or
 * spacing a list wider or taller than the space beside its control is moved and narrowed rather than
 * left to clip or to widen the page. Pure geometry, in CSS pixels in viewport coordinates.
 */

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface Placement {
  /** Horizontal shift from where the list's anchor puts it, so its edges are inside the margins. */
  shiftX: number;
  /** The widest the list may be: the viewport less both margins. */
  maxWidth: number;
  /** Whether the list opens above its control, where more room is. */
  above: boolean;
  /** The tallest the list may be on its side of the control. */
  maxHeight: number;
}

export interface PlacementInput {
  control: Box;
  /** The list's width once capped at `maxWidth`, and the height of all its options. */
  list: { width: number; contentHeight: number };
  viewport: { width: number; height: number };
  /** The gap kept between the list and the viewport's edges, and between it and the control. */
  margin: number;
  /** The control edge the list is anchored to. */
  align: "start" | "end";
}

/**
 * The list's placement. It opens below its control unless the options do not fit there and there is
 * more room above; it is anchored to the control's start or end edge and shifted only as far as the
 * margins need.
 */
export function placeListbox({ control, list, viewport, margin, align }: PlacementInput): Placement {
  const maxWidth = Math.max(0, viewport.width - 2 * margin);
  const width = Math.min(list.width, maxWidth);
  const anchored = align === "end" ? control.right - width : control.left;
  const clamped = Math.min(Math.max(anchored, margin), viewport.width - margin - width);
  const below = Math.max(0, viewport.height - control.bottom - 2 * margin);
  const above = Math.max(0, control.top - 2 * margin);
  const flip = list.contentHeight > below && above > below;
  return { shiftX: clamped - anchored, maxWidth, above: flip, maxHeight: flip ? above : below };
}
