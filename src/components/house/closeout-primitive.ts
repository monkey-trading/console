/**
 * The close-out map's bands, drawn behind a series (the anchor line that always holds data, so the bands
 * place even while the candles have not loaded) with Lightweight Charts' series
 * primitive: one horizontal band per close-out price range, shaded by the notional that closes out
 * there. The renderer reads the primitive's current bands on each frame, so new bands go in through
 * `update` and a repaint, never a rebuilt chart.
 */

import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";

import { bandUsd, intensity, type Band } from "@/lib/house-bands";

/** What the primitive draws: the bands, the heaviest band's notional, and the fill colours. */
export interface BandsData {
  bands: readonly Band[];
  maxUsd: number;
  /** Maps a band's intensity from 0 to 1 to the fill colour. */
  colour: (weight: number) => string;
}

export class BandsPrimitive implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType> | null = null;
  private repaint: (() => void) | null = null;
  private data: BandsData = { bands: [], maxUsd: 0, colour: () => "transparent" };

  private readonly renderer: IPrimitivePaneRenderer = {
    draw: (target) => {
      const series = this.series;
      if (series === null) return;
      target.useBitmapCoordinateSpace(({ context, bitmapSize, verticalPixelRatio }) => {
        for (const band of this.data.bands) {
          const top = series.priceToCoordinate(band.toPrice);
          const bottom = series.priceToCoordinate(band.fromPrice);
          if (top === null || bottom === null) continue;
          context.fillStyle = this.data.colour(intensity(bandUsd(band), this.data.maxUsd));
          context.fillRect(0, Math.round(top * verticalPixelRatio), bitmapSize.width, Math.max(1, Math.round((bottom - top) * verticalPixelRatio)));
        }
      });
    },
  };

  private readonly view: IPrimitivePaneView = { zOrder: () => "bottom", renderer: () => this.renderer };

  attached(param: SeriesAttachedParameter<Time>): void {
    this.series = param.series;
    this.repaint = param.requestUpdate;
  }

  detached(): void {
    this.series = null;
    this.repaint = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  /** Replaces the bands and repaints. */
  update(data: BandsData): void {
    this.data = data;
    this.repaint?.();
  }
}
