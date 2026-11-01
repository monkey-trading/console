/** Tests for reading the size field: the order's exact quantity, in contracts. */

import { describe, expect, it } from "vitest";

import { fixedFromInt } from "./fixed";
import { contractUnit, parseSize, truncateToStep } from "./ticket";
import { btc, q } from "./ticket-fixtures";

describe("parseSize", () => {
  it("reads a size exactly as typed, to six decimal places", () => {
    expect(parseSize("0.5")).toEqual({ kind: "qty", qty: q("0.5") });
    expect(parseSize(" 12 ")).toEqual({ kind: "qty", qty: fixedFromInt(12) });
    expect(parseSize("0.123457")).toEqual({ kind: "qty", qty: 123_457_000n });
    expect(parseSize("0.000001")).toEqual({ kind: "qty", qty: 1_000n });
  });

  it("is empty for blank text, and passes trailing zeros past the step, which change no value", () => {
    expect(parseSize("")).toEqual({ kind: "empty" });
    expect(parseSize("   ")).toEqual({ kind: "empty" });
    expect(parseSize("0.5000000")).toEqual({ kind: "qty", qty: q("0.5") });
  });

  it("refuses more than six decimal places, saying so, rather than rounding", () => {
    expect(parseSize("0.0000001")).toEqual({ kind: "refused", message: "A size has at most 6 decimal places." });
    expect(parseSize("1.23456789")).toEqual({ kind: "refused", message: "A size has at most 6 decimal places." });
    expect(parseSize("0.12345678901234")).toEqual({ kind: "refused", message: "A size has at most 6 decimal places." });
  });

  it("refuses text that is not a plain decimal", () => {
    for (const text of ["abc", "-1", "+1", "1e3", "1,5", ".5", "1.", "0x10", "1 2"]) {
      expect(parseSize(text), text).toEqual({ kind: "refused", message: "Enter the size in digits, such as 0.5 or 2.25." });
    }
  });
});

describe("contractUnit", () => {
  it("names the base asset of a pair, and the instrument itself when it has no pair", async () => {
    const market = await btc();
    expect(contractUnit(market)).toBe("BTC");
    expect(contractUnit({ ...market, symbol: "US500" })).toBe("US500 unit");
  });
});

describe("truncateToStep", () => {
  it("cuts a nine-place quantity down to the size field's step, so what it names can be typed", () => {
    expect(truncateToStep(25_773_195_876n)).toBe(25_773_195_000n);
    expect(truncateToStep(q("0.12886"))).toBe(q("0.12886"));
    expect(truncateToStep(999n)).toBe(0n);
    const typed = parseSize("25.773195");
    expect(typed).toEqual({ kind: "qty", qty: truncateToStep(25_773_195_876n) });
  });
});
