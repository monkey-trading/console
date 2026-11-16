/**
 * Guards the font's fallback (monkey-trading/console#338): next/font's default fallback for Geist Mono is
 * Arial scaled to its average width, so the shell's lines wrapped differently before and after the font
 * loaded, and a cold load at 360 px shifted by about 0.24. The fallback is a face with the same 0.6 em
 * advance, which wraps every line the same way.
 */

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./layout.tsx", import.meta.url), "utf8");

describe("the root layout's font", () => {
  it("falls back to monospace faces of the same advance, not to next/font's scaled Arial", () => {
    expect(source).toContain("adjustFontFallback: false");
    expect(source).toMatch(/fallback: \["Courier New", "Menlo", "Liberation Mono", "ui-monospace", "monospace"\]/);
  });

  // monkey-trading/console#383: a failed Google Fonts download rendered every page in Courier New, so the font ships with the console.
  it("serves Geist Mono from files in the repository, with its licence, and reaches no font host", () => {
    expect(source).toContain('from "next/font/local"');
    expect(source).not.toMatch(/next\/font\/google|fonts\.googleapis|fonts\.gstatic/);
    expect(existsSync(new URL("./fonts/GeistMono-Variable.woff2", import.meta.url))).toBe(true);
    expect(readFileSync(new URL("./fonts/OFL.txt", import.meta.url), "utf8")).toContain("SIL Open Font License, Version 1.1");
  });
});
