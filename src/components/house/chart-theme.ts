/** What the House page's charts take from the console's theme: tokens read from the document, and the options every chart shares. */

import type { ChartOptions, DeepPartial } from "lightweight-charts";

/** The tokens a series may take its colour from. */
export type Tone = "fg" | "glow" | "ember" | "amber";

/** A theme token's value, read from the document. */
export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim();
}

/** `colour` (a `#rrggbb` token) at `opacity`, as the `rgba(…)` text a chart accepts. */
export function withOpacity(colour: string, opacity: number): string {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour);
  if (hex === null) return colour;
  const [, r = "00", g = "00", b = "00"] = hex;
  return `rgba(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}, ${opacity})`;
}

/** The options of every House chart: the console's dark surface, thin grid, and the library's attribution, as its licence asks. */
export function chartOptions(): DeepPartial<ChartOptions> {
  return {
    autoSize: true,
    layout: { background: { color: token("ink-1") }, textColor: token("fg-3"), fontFamily: getComputedStyle(document.body).fontFamily, fontSize: 11, attributionLogo: true },
    grid: { vertLines: { color: token("line") }, horzLines: { color: token("line") } },
    crosshair: { vertLine: { color: token("edge"), labelBackgroundColor: token("line-2") }, horzLine: { color: token("edge"), labelBackgroundColor: token("line-2") } },
    rightPriceScale: { borderColor: token("line-2"), scaleMargins: { top: 0.1, bottom: 0.08 } },
    timeScale: { borderColor: token("line-2"), timeVisible: true, secondsVisible: false, fixLeftEdge: true, fixRightEdge: true },
    // A finger dragging up or down scrolls the page; one dragging sideways pans the chart.
    handleScroll: { vertTouchDrag: false },
    handleScale: { axisPressedMouseMove: { price: false } },
  };
}

/** Gives the attribution link, which opens another site in a new tab, the same rel as every such link. */
export function hardenLinks(host: HTMLElement): void {
  for (const link of host.querySelectorAll("a")) link.rel = "noopener noreferrer";
}
