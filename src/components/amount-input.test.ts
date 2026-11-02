/** Every amount field stays out of reach of password managers. */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { AMOUNT_INPUT } from "./amount-input";

const FIELDS = { "WithdrawForm.tsx": 1, "DepositForm.tsx": 1, "DealTicket.tsx": 2, "monkey/AmountForm.tsx": 1 };

describe("AMOUNT_INPUT", () => {
  it("asks browsers and the password managers not to treat the field as a credential", () => {
    expect(AMOUNT_INPUT).toMatchObject({ autoComplete: "off", "data-lpignore": "true", "data-1p-ignore": "true", "data-bwignore": "true" });
  });

  it.each(Object.entries(FIELDS))("is on every decimal field in %s", (file, count) => {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    const inputs = (source.match(/<input [\s\S]*?\/>/g) ?? []).filter((input) => input.includes('inputMode="decimal"'));
    expect(inputs).toHaveLength(count);
    for (const input of inputs) expect(input).toContain("{...AMOUNT_INPUT}");
  });
});
