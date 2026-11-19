/** Tests for the Positions tab's levels draft: which position it belongs to, and what a save that lands later does to it. */

import { describe, expect, it } from "vitest";

import { fixedFromInt } from "./fixed";
import { landedSave, openDraft, sentFrom, type HeldPosition, type LevelsDraft } from "./level-draft";
import { NO_LEVELS } from "./levels";

const OWNER = "0xabc";
const LEVELS = { takeProfit: fixedFromInt(105_000), stopLoss: fixedFromInt(95_000) };
const HELD: HeldPosition = { market: 1, long: true, entry: fixedFromInt(100_000), opened: 1_000, levels: LEVELS };
const DRAFT: LevelsDraft = { market: 1, owner: OWNER, long: true, entry: HELD.entry, opened: 1_000, base: LEVELS, sent: [], fields: { takeProfit: "105000", stopLoss: "94000" }, instance: 3 };

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

  it("keeps it while the position holds the levels it opened with or those any of its own saves sent, taking the newest the account shows as its base", () => {
    const first = { ...LEVELS, stopLoss: fixedFromInt(94_000) };
    const second = { ...LEVELS, stopLoss: fixedFromInt(93_000) };
    const sending = sentFrom(sentFrom(DRAFT, first), second);
    expect(sending.sent).toEqual([first, second]);
    expect(openDraft(sending, OWNER, [HELD])).toBe(sending);
    expect(openDraft(sending, OWNER, [{ ...HELD, levels: first }])).toEqual({ ...sending, base: first, sent: [second] });
    expect(openDraft(sending, OWNER, [{ ...HELD, levels: second }])).toEqual({ ...sending, base: second, sent: [] });
    expect(openDraft(sending, OWNER, [{ ...HELD, levels: NO_LEVELS }])).toBeNull();
    // Once the account shows a later save's levels, the levels before them are no longer the position's.
    const shown = openDraft(sending, OWNER, [{ ...HELD, levels: second }]);
    expect(openDraft(shown, OWNER, [HELD])).toBeNull();
  });

  it("keeps newer fields typed while a save was on its way when the save lands but its account read fails", () => {
    const sent = { ...LEVELS, stopLoss: fixedFromInt(94_000) };
    const typed = { ...sentFrom(DRAFT, sent), fields: { takeProfit: "106000", stopLoss: "94000" } };
    // The save lands with other fields open, so it is announced and leaves the draft as it is.
    expect(landedSave(typed, 3, DRAFT.fields)).toBe("announce");
    // The account read after it failed, so the account still shows the levels the editor opened with.
    expect(openDraft(typed, OWNER, [HELD])).toBe(typed);
    // The next read shows the save's levels, which become the base, the fields typed still open.
    expect(openDraft(typed, OWNER, [{ ...HELD, levels: sent }])).toEqual({ ...typed, base: sent, sent: [] });
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
