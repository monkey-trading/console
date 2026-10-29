/** Tests for the QR code path the pairing dialog draws. */

import { encode } from "uqr";
import { describe, expect, it } from "vitest";

import { QUIET_ZONE, qrPath } from "./qr";

// The shape of a WalletConnect pairing link: a 32-byte topic, the protocol version, and the pairing's key.
const URI = `wc:${"7f3a".repeat(16)}@2?relay-protocol=irn&symKey=${"c0de".repeat(16)}&expiryTimestamp=1761700000`;

/** The dark cells a path draws, as "x,y" keys, read back from its `M x y h w v1 h-w z` runs. */
function cells(path: string): Set<string> {
  const dark = new Set<string>();
  for (const [, x, y, width, back] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
    expect(back).toBe(width);
    for (let dx = 0; dx < Number(width); dx += 1) dark.add(`${Number(x) + dx},${y}`);
  }
  return dark;
}

describe("qrPath", () => {
  it("draws exactly the dark modules of the encoded link, with a four-module quiet zone", () => {
    const { size, path } = qrPath(URI);
    const { data } = encode(URI, { ecc: "M", border: QUIET_ZONE });
    const expected = new Set(data.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`${x},${y}`] : []))));
    expect(cells(path)).toEqual(expected);
    // Nothing but the run syntax is in the path.
    expect(path.replace(/M\d+ \d+h\d+v1h-\d+z/g, "")).toBe("");
    // A version-v code is 17 + 4v modules wide; the quiet zone adds four on each side.
    expect(size).toBe(data.length);
    expect((size - 2 * QUIET_ZONE - 17) % 4).toBe(0);
    const inZone = [...expected].filter((key) => {
      const [x = 0, y = 0] = key.split(",").map(Number);
      return x < QUIET_ZONE || y < QUIET_ZONE || x >= size - QUIET_ZONE || y >= size - QUIET_ZONE;
    });
    expect(inZone).toEqual([]);
  });

  it("starts with the top-left finder pattern: a run of seven, then its two sides", () => {
    const { path } = qrPath(URI);
    expect(path.startsWith(`M4 4h7v1h-7z`)).toBe(true);
    expect(path).toContain("M4 5h1v1h-1zM10 5h1v1h-1z");
  });

  it("gives a longer link a larger code", () => {
    expect(qrPath(`${URI}&methods=wc_sessionPropose`).size).toBeGreaterThan(qrPath("wc:short").size);
  });
});
