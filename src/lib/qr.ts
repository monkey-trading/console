/** A QR code as SVG path data, so a component can draw it with one `<path>`. */

import { encode } from "uqr";

/** The light margin QR readers need around the code, in modules (ISO/IEC 18004). */
export const QUIET_ZONE = 4;

export interface QrPath {
  /** Width and height in modules, quiet zone included: the view box is `0 0 size size`. */
  size: number;
  /** One unit-high rectangle per horizontal run of dark modules. */
  path: string;
}

/** The QR code of `text` at error correction level M, its dark modules as one path. */
export function qrPath(text: string): QrPath {
  const { data, size } = encode(text, { ecc: "M", border: QUIET_ZONE });
  const runs: string[] = [];
  data.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (row[x]) x += 1;
      runs.push(`M${start} ${y}h${x - start}v1h-${x - start}z`);
    }
  });
  return { size, path: runs.join("") };
}
