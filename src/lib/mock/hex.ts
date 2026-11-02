/** The mock's stand-in hex values. */

const HEX = "0123456789abcdef";

/** A deterministic hex string of `bytes` bytes derived from `seed`, for the mock's fixed fields. */
export function mockHex(seed: string, bytes: number): string {
  let h = 2166136261;
  let out = "";
  for (let i = 0; i < bytes * 2; i++) {
    h = Math.imul(h ^ (seed.charCodeAt(i % seed.length) + i), 16777619) >>> 0;
    out += HEX[h % 16];
  }
  return out;
}
