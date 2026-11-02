import { describe, expect, it } from "vitest";

import { placeTooltip } from "./tooltip";

const phone = { width: 320, height: 700 };

describe("placeTooltip", () => {
  it("opens below the label, touching it", () => {
    expect(placeTooltip({ left: 20, top: 100, bottom: 120 }, phone)).toEqual({ left: 20, width: 240, top: 120 });
  });

  it("keeps a label near the right edge's tooltip inside the viewport", () => {
    expect(placeTooltip({ left: 300, top: 100, bottom: 120 }, phone)).toEqual({ left: 72, width: 240, top: 120 });
  });

  it("keeps a label near the left edge's tooltip off the edge, and narrows it to a narrow viewport", () => {
    expect(placeTooltip({ left: -30, top: 100, bottom: 120 }, phone)?.left).toBe(8);
    expect(placeTooltip({ left: 0, top: 100, bottom: 120 }, { width: 200, height: 700 })).toEqual({ left: 8, width: 184, top: 120 });
  });

  it("opens above a label near the bottom of the viewport when there is room above", () => {
    expect(placeTooltip({ left: 20, top: 640, bottom: 660 }, phone)).toEqual({ left: 20, width: 240, bottom: 60 });
  });

  it("opens below when there is no room above either, and not at all for a label out of view", () => {
    expect(placeTooltip({ left: 20, top: 100, bottom: 120 }, { width: 320, height: 200 })).toEqual({ left: 20, width: 240, top: 120 });
    expect(placeTooltip({ left: 20, top: 800, bottom: 820 }, phone)).toBeNull();
    expect(placeTooltip({ left: 20, top: -40, bottom: -20 }, phone)).toBeNull();
  });
});
