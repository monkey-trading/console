/**
 * Tests for the operators card's editors and slot that the settle rules and the answer order
 * govern: the typed Delegate and Take back submits while the chain's read settles
 * (monkey-trading/console#330), and the typed-address way's slot when the node's first list answers
 * after the chain's read (monkey-trading/console#331).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LOADING, ready } from "@/lib/monkey/figures";
import type { OperatorsState } from "@/lib/monkey/operators";
import { amountKey, NO_EDITING, type DelegateEditing } from "@/lib/staking/delegation-form";

import { ALPHA, chain, panel, render, startPanel, stopPanelKit, VERIFIED, view } from "./operators-panel-kit";

beforeAll(startPanel);
afterAll(stopPanelKit);

describe("the operators card's editors and slot", () => {
  describe("the editors' own submits while the chain's read settles (monkey-trading/console#330)", () => {
    const mixed = "0x52908400098527886E0F7030069857D2E4169EE7";
    const operators = { route: LOADING, list: ready(view), held: null } as OperatorsState;
    /** The typed-address editor with a valid destination and 10 typed, and a Take back editor with 10 typed. */
    const typed: DelegateEditing = { ...NO_EDITING, typedOpen: true, typedTo: mixed, amounts: { [amountKey("delegate", "typed")]: "10" } };
    const takeBack: DelegateEditing = { ...NO_EDITING, editing: { candidate: ALPHA, mode: "undelegate" }, amounts: { [amountKey("undelegate", ALPHA)]: "10" } };
    const submit = (html: string, action: string) => html.match(new RegExp(`type="submit" aria-disabled="(true|false)"[^>]*>${action}<`))?.[1];

    it("keeps the typed Delegate and the Take back submits shut while the chain read settles", () => {
      expect(submit(render({ state: VERIFIED, operators, read: chain(true), editing: typed }), "Delegate")).toBe("true");
      expect(submit(render({ state: VERIFIED, operators, read: chain(true), editing: takeBack }), "Take back")).toBe("true");
    });

    it("opens both submits on the chain's read alone while the panel's own proof still settles", async () => {
      let done = () => {};
      const pending = panel.settle(new Promise<void>((resolve) => { done = resolve; }));
      expect(panel.getSnapshot().settling).toBe(true);
      expect(submit(render({ state: VERIFIED, operators, read: chain(false), editing: typed }), "Delegate")).toBe("false");
      expect(submit(render({ state: VERIFIED, operators, read: chain(false), editing: takeBack }), "Take back")).toBe("false");
      done();
      await pending;
    });
  });

  describe("the typed-address way's slot (monkey-trading/console#331)", () => {
    const slot = /<div aria-hidden="true" inert="" class="invisible"><span class="[^"]*inline-block">Delegate to an address<\/span><\/div>/;
    const current = { route: LOADING, list: ready(view), held: null } as OperatorsState;

    it("chain first: offered while the first list loads, and kept as an unseen slot of the same size once the current list withdraws it", () => {
      const first = render({ state: VERIFIED, operators: { route: LOADING, list: LOADING, held: null }, read: chain() });
      expect(first).toContain("Delegate to an address");
      expect(first).not.toMatch(slot);
      const later = render({ state: VERIFIED, operators: current, read: chain(), typedSlot: true });
      expect(later).toMatch(slot);
      expect(later).not.toMatch(/aria-controls="[^"]*-editor"/);
      // The slot is the button's own box: the same classes, so the same height.
      const button = first.match(/<button type="button" aria-expanded="false" aria-controls="[^"]*-editor" class="([^"]*)">Delegate to an address/)?.[1];
      expect(button).toBeDefined();
      expect(later).toContain(`class="${button} inline-block">Delegate to an address`);
    });

    it("list first: nothing was ever offered, so nothing is kept", () => {
      const html = render({ state: VERIFIED, operators: current, read: chain() });
      expect(html).not.toContain("Delegate to an address");
    });

    it("keeps no slot for a visitor who cannot vote", () => {
      const html = render({ state: { ...VERIFIED, wallet: null }, operators: current, read: { account: null, read: LOADING, settling: false }, typedSlot: true });
      expect(html).not.toContain("Delegate to an address");
    });
  });

});
