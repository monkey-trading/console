/** Tests for the Positions tab's levels draft: which position it belongs to, and what a save that lands later does to it. */

import { describe, expect, it } from "vitest";

import { fixedFromInt } from "./fixed";
import { dialogAnnouncement, fieldsOf, landedSave, openDraft, positionClosed, sentFrom, type HeldPosition, type LevelsDraft } from "./level-draft";
import { NO_LEVELS } from "./levels";

const OWNER = "0xabc";
const LEVELS = { takeProfit: fixedFromInt(105_000), stopLoss: fixedFromInt(95_000) };
const HELD: HeldPosition = { market: 1, levels: LEVELS };
/** A draft opened on `LEVELS`, its take profit as it opened and its stop loss edited. */
const DRAFT: LevelsDraft = { market: 1, owner: OWNER, base: LEVELS, sent: [], fields: { takeProfit: "105000", stopLoss: "94000" }, instance: 3 };

describe("fieldsOf", () => {
  it("prefills each level as the plain digits it was set with, and a level not set as empty", () => {
    expect(fieldsOf({ takeProfit: fixedFromInt(105_000), stopLoss: null })).toEqual({ takeProfit: "105000", stopLoss: "" });
    expect(fieldsOf(NO_LEVELS)).toEqual({ takeProfit: "", stopLoss: "" });
  });
});

describe("openDraft", () => {
  it("keeps the draft, unchanged, while its account holds a position in its market with the levels it opened with, whatever the position's size or side", () => {
    expect(openDraft(DRAFT, OWNER, [{ ...HELD, market: 2 }, HELD])).toBe(DRAFT);
    expect(openDraft(null, OWNER, [HELD])).toBeNull();
  });

  it("drops it once another account is connected, or none", () => {
    expect(openDraft(DRAFT, "0xdef", [HELD])).toBeNull();
    expect(openDraft(DRAFT, null, [HELD])).toBeNull();
  });

  it("drops it once the account holds no position in its market", () => {
    expect(openDraft(DRAFT, OWNER, [])).toBeNull();
    expect(openDraft(DRAFT, OWNER, [{ ...HELD, market: 2 }])).toBeNull();
  });

  it("takes levels changed by anything but its own save as its base, a field still showing the old level showing the new one and an edited field kept", () => {
    const moved = { takeProfit: fixedFromInt(106_000), stopLoss: fixedFromInt(96_000) };
    expect(openDraft(DRAFT, OWNER, [{ ...HELD, levels: moved }])).toEqual({ ...DRAFT, base: moved, fields: { takeProfit: "106000", stopLoss: "94000" } });
    // A reversal removes the levels: the take profit as it opened goes, and the edited stop loss stays for the check to measure on the new side.
    expect(openDraft(DRAFT, OWNER, [{ ...HELD, levels: NO_LEVELS }])).toEqual({ ...DRAFT, base: NO_LEVELS, fields: { takeProfit: "", stopLoss: "94000" } });
  });

  it("keeps it while the position holds the levels it opened with or those any of its own saves sent, taking the newest the account shows as its base", () => {
    const first = { ...LEVELS, stopLoss: fixedFromInt(94_000) };
    const second = { ...LEVELS, stopLoss: fixedFromInt(93_000) };
    const sending = sentFrom(sentFrom(DRAFT, first), second);
    expect(sending.sent).toEqual([first, second]);
    expect(openDraft(sending, OWNER, [HELD])).toBe(sending);
    expect(openDraft(sending, OWNER, [{ ...HELD, levels: first }])).toEqual({ ...sending, base: first, sent: [second] });
    expect(openDraft(sending, OWNER, [{ ...HELD, levels: second }])).toEqual({ ...sending, base: second, sent: [] });
    // Levels none of its saves sent are a change from elsewhere, which leaves the saves still on their way.
    expect(openDraft(sending, OWNER, [{ ...HELD, levels: NO_LEVELS }])).toEqual({ ...sending, base: NO_LEVELS, fields: { takeProfit: "", stopLoss: "94000" } });
    // Once the account shows a later save's levels, the levels before them are no longer the position's, but a change from elsewhere.
    const shown = openDraft(sending, OWNER, [{ ...HELD, levels: second }]);
    expect(openDraft(shown, OWNER, [HELD])).toEqual({ ...shown, base: LEVELS });
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

describe("positionClosed", () => {
  it("says the position closed only while its account is still connected and holds nothing in its market", () => {
    expect(positionClosed(DRAFT, OWNER, [])).toBe(true);
    expect(positionClosed(DRAFT, OWNER, [{ ...HELD, market: 2 }])).toBe(true);
    expect(positionClosed(DRAFT, OWNER, [HELD])).toBe(false);
    // Another wallet, or none, drops the draft without saying a position closed.
    expect(positionClosed(DRAFT, "0xdef", [])).toBe(false);
    expect(positionClosed(DRAFT, null, [])).toBe(false);
  });
});

describe("dialogAnnouncement", () => {
  const SAID = { text: "The stop loss on your BTC-USD position is now 94,000.00.", instance: 3 };
  it("reads out a save's words in the dialog instance that sent it, and nothing in another or with none open", () => {
    expect(dialogAnnouncement(DRAFT, SAID)).toBe(SAID.text);
    expect(dialogAnnouncement({ ...DRAFT, instance: 4 }, SAID)).toBe("");
    expect(dialogAnnouncement(null, SAID)).toBe("");
    expect(dialogAnnouncement(DRAFT, null)).toBe("");
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
