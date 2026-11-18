/** Tests for the Positions tab's levels draft: which position it belongs to, and what a save that lands later does to it. */

import { describe, expect, it } from "vitest";

import { fixedFromInt } from "./fixed";
import { landedSave, openDraft, type HeldPosition, type LevelsDraft } from "./level-draft";
import { NO_LEVELS } from "./levels";

const OWNER = "0xabc";
const LEVELS = { takeProfit: fixedFromInt(105_000), stopLoss: fixedFromInt(95_000) };
const HELD: HeldPosition = { market: 1, long: true, entry: fixedFromInt(100_000), opened: 1_000, levels: LEVELS };
const DRAFT: LevelsDraft = { market: 1, owner: OWNER, long: true, entry: HELD.entry, opened: 1_000, base: LEVELS, sent: null, fields: { takeProfit: "105000", stopLoss: "94000" }, instance: 3 };

describe("openDraft", () => {
  it("keeps the draft while its account holds the position it was opened for, unchanged", () => {
    expect(openDraft(DRAFT, OWNER, [{ ...HELD, market: 2 }, HELD])).toBe(DRAFT);
    expect(openDraft(null, OWNER, [HELD])).toBeNull();
  });

  it("drops it once another account is connected, or none", () => {
    expect(openDraft(DRAFT, "0xdef", [HELD])).toBeNull();
    expect(openDraft(DRAFT, null, [HELD])).toBeNull();
  });

  it("drops it once the position is closed, reversed, or closed and opened again", () => {
    expect(openDraft(DRAFT, OWNER, [])).toBeNull();
    expect(openDraft(DRAFT, OWNER, [{ ...HELD, long: false }])).toBeNull();
    // A position closed and opened again on the same side in one moment differs in its entry or its open time.
    expect(openDraft(DRAFT, OWNER, [{ ...HELD, entry: fixedFromInt(101_000) }])).toBeNull();
    expect(openDraft(DRAFT, OWNER, [{ ...HELD, opened: 2_000 }])).toBeNull();
  });

  it("drops it once the position's levels are changed by anything but its own save", () => {
    expect(openDraft(DRAFT, OWNER, [{ ...HELD, levels: NO_LEVELS }])).toBeNull();
    expect(openDraft(DRAFT, OWNER, [{ ...HELD, levels: { ...LEVELS, stopLoss: fixedFromInt(96_000) } }])).toBeNull();
  });

  it("keeps it while the position holds the levels its own save sent, which the account can show before the answer lands", () => {
    const sent = { ...LEVELS, stopLoss: fixedFromInt(94_000) };
    const sending = { ...DRAFT, sent };
    expect(openDraft(sending, OWNER, [{ ...HELD, levels: sent }])).toBe(sending);
    expect(openDraft(sending, OWNER, [HELD])).toBe(sending);
    expect(openDraft(sending, OWNER, [{ ...HELD, levels: NO_LEVELS }])).toBeNull();
  });
});

describe("landedSave", () => {
  it("closes the editor the save was sent from while it still holds the fields sent", () => {
    expect(landedSave(DRAFT, 3, DRAFT.fields)).toBe("close");
  });

  it("only says what was saved while fields typed since are open", () => {
    expect(landedSave({ ...DRAFT, fields: { takeProfit: "106000", stopLoss: "94000" } }, 3, DRAFT.fields)).toBe("announce");
  });

  it("does nothing to an editor closed, or closed and opened again, since it was sent", () => {
    expect(landedSave(null, 3, DRAFT.fields)).toBe("ignore");
    expect(landedSave({ ...DRAFT, instance: 4 }, 3, DRAFT.fields)).toBe("ignore");
  });
});
