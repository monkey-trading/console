/** Tests that the sign gate holds a control while the wallet is on another chain, and says to switch back (monkey-trading/console#289). */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ConsoleState } from "@/lib/store/state";

import { ConsoleProvider, useSession } from "./ConsoleProvider";
import { useSignGate } from "./SignGate";

/** A button behind the gate, with the console's state as `state` sets it. */
function Gated({ state }: { state: Partial<ConsoleState> }) {
  const { store } = useSession();
  store.patch(state);
  const gate = useSignGate("gate");
  return createElement("div", null, createElement("button", { "aria-disabled": gate.blocked, "aria-describedby": gate.describedBy }, "Sign"), gate.note);
}

const render = (state: Partial<ConsoleState>) => renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Gated, { state })));

describe("the sign gate", () => {
  it("holds the control and asks to switch back while the wallet is on another chain, and lets it go once back", () => {
    const away = render({ walletChain: 1, attestation: { kind: "mock" }, stream: "live" });
    expect(away).toContain('aria-disabled="true" aria-describedby="gate"');
    expect(away).toMatch(/Your wallet is on Ethereum, not [^.]+\. Switch it back to [^.]+ to continue\./);
    const back = render({ walletChain: null, attestation: { kind: "mock" }, stream: "live" });
    expect(back).toContain('aria-disabled="false"');
    expect(back).not.toContain("Your wallet is on");
  });
});
