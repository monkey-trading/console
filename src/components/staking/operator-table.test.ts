/**
 * Tests for the operator table's per-row actions (monkey-trading/console#309): Delegate on each
 * listed row, Move and Take back on each row the account delegates to, each named from its visible
 * word and opening its editor under the row, with the preview's words before the wallet is asked.
 * Both the card and the table layouts render in the markup, one hidden by CSS, so each control
 * appears twice.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { StakeDelegations } from "@/lib/engine/staking";
import { MONKEY_UNIT } from "@/lib/format";
import type { MonkeyPanel } from "@/lib/monkey/panel";
import { setup } from "@/lib/monkey/panel-kit";
import { amountKey, NO_EDITING, openRowEditor, setAmount, type DelegateEditing } from "@/lib/staking/delegation-form";
import { operatorsView, yoursRows, type OperatorRow } from "@/lib/staking/operator-table";

import { ConsoleProvider } from "../ConsoleProvider";
import { MonkeyPanelProvider } from "../monkey/use-monkey";
import { OperatorTable } from "./OperatorTable";

const ALPHA = "0x00000000000000000000000000000000000000a1";
const BRAVO = "0x00000000000000000000000000000000000000b2";
const OUTSIDER = "0x0000000000000000000000000000000000000fff";
const RELEASE = `0x${"ab".repeat(32)}`;

/** A list the node once served: two candidates, read at block 4,321. */
const view = operatorsView({
  block: { number: 4_321, hash: `0x${"cd".repeat(32)}`, time_ms: 1_793_000_000_000 }, registry: ALPHA, lens: ALPHA, rotation_enabled: true,
  parameters: { epoch_length_secs: 60, min_term_secs: 0, finality_margin_secs: 60, margin_bps: 1_000, eligibility_bps: 500, quorum_bps: 2_000, max_candidates: 100, min_self_bond: "1", liveness_timeout_secs: 60 },
  open_epoch: 1, open_epoch_start_ms: 0, total_staked: "1000", operator_in_effect: { candidate: ALPHA, admin_key: ALPHA, release: RELEASE, since_ms: 0 },
  named_operator: { candidate: ALPHA, admin_key: ALPHA, release: RELEASE, since_ms: 0 }, pending_election: null, pending_promotion: false,
  candidates: [ALPHA, BRAVO].map((address, registration) => ({ address, admin_key: address, enclave: address, self_bond: "1", release: RELEASE, registration, api_hostname: registration === 0 ? "alpha.example" : "bravo.example", handover_endpoint: "", votes: "0", eligible: true, role: registration === 0 ? "operator" as const : "candidate" as const })),
});

const unit = (n: number) => BigInt(n) * MONKEY_UNIT;
/** The chain's word on the demo wallet: 1,000 staked, 300 of it delegated to alpha. */
const chain: StakeDelegations = { staked: unit(1000), delegated: unit(300), delegations: [{ candidate: ALPHA, amount: unit(300) }] };
const nameOf = (address: string) => (address === ALPHA ? "alpha.example (0x000000…00a1)" : address === BRAVO ? "bravo.example (0x000000…00b2)" : "0x0000…0fff");
const heldFn = (address: string) => chain.delegations.find((delegation) => delegation.candidate === address)?.amount ?? 0n;

/** The panel the AmountForms in open editors need. */
let panel: MonkeyPanel;
let stopPanel = () => {};
beforeAll(async () => {
  const kit = await setup();
  panel = kit.panel;
  stopPanel = kit.stop;
});
afterAll(() => stopPanel());

function render(rows: readonly OperatorRow[], editing: DelegateEditing, over: Partial<Parameters<typeof OperatorTable>[0]> = {}) {
  const props = {
    rows, sort: "role" as const, held: heldFn, chain, canVote: true, disabled: false,
    reachable: () => true, listed: view.rows.filter((row) => row.listed), source: { kind: "current" as const },
    editing, onEdit: () => undefined, nameOf, send: () => Promise.resolve(),
    ...over,
  };
  return renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(MonkeyPanelProvider, { value: panel }, createElement(OperatorTable, props))));
}

const open = (candidate: string, mode: "delegate" | "move" | "undelegate", amount = ""): DelegateEditing =>
  setAmount(openRowEditor(NO_EDITING, { candidate, mode }), amountKey(mode, candidate), amount);

describe("the operator table's rows", () => {
  it("offers Delegate on each listed row, named from its visible word, and Move and Take back on the row the account delegates to", () => {
    const html = render(view.rows, NO_EDITING);
    expect(html.match(/Delegate<span class="sr-only"> to /g)).toHaveLength(4);
    expect(html).toContain("Delegate<span class=\"sr-only\"> to alpha.example (0x000000…00a1)</span>");
    expect(html).toContain("Move<span class=\"sr-only\"> part of your delegation to alpha.example (0x000000…00a1)</span>");
    expect(html).toContain("Take back<span class=\"sr-only\"> part of your delegation to alpha.example (0x000000…00a1)</span>");
    // Bravo holds none of the account's stake: Delegate, no more.
    expect(html.match(/Move<span class="sr-only"> part of your delegation to bravo/g)).toBeNull();
  });

  it("shows nothing to a visitor who cannot vote, and everything shut while a landed change settles", () => {
    expect(render(view.rows, NO_EDITING, { canVote: false })).not.toContain("Delegate<span class=\"sr-only\"> to ");
    const html = render(view.rows, NO_EDITING, { disabled: true });
    expect(html.match(/aria-disabled="true"[^>]*>Delegate/g)).toHaveLength(4);
    expect(html.match(/aria-disabled="true"[^>]*>Move/g)).toHaveLength(2);
  });

  it("keeps a delegation to an address neither list names as a row named by its address, with Move and Take back, and no Delegate", () => {
    const delegations = [...chain.delegations, { candidate: OUTSIDER, amount: unit(50) }];
    const held = (address: string) => delegations.find((delegation) => delegation.candidate === address)?.amount ?? 0n;
    const html = render(yoursRows(view.rows, delegations), NO_EDITING, { held });
    expect(html).toContain("Move<span class=\"sr-only\"> part of your delegation to 0x0000…0fff</span>");
    expect(html).not.toContain("Delegate<span class=\"sr-only\"> to 0x0000…0fff</span>");
  });
});

describe("the row editors", () => {
  it("opens under its row: the button names the editor it controls, and says it is expanded", () => {
    const html = render(view.rows, open(ALPHA, "delegate"));
    const button = /<button[^>]*aria-expanded="true"[^>]*>Delegate<span/.exec(html)?.[0] ?? "";
    expect(button).not.toBe("");
    const controls = /aria-controls="([^"]+)"/.exec(button)?.[1] ?? "";
    expect(controls).toContain(`${ALPHA}-delegate`);
    expect(html).toContain(`id="${controls}"`);
    expect(html).toContain("Amount to delegate");
    // One editor at a time: bravo's Delegate buttons stay closed, in both layouts.
    expect(html.match(/aria-expanded="false"[^>]*>Delegate/g) ?? []).toHaveLength(2);
  });

  it("says what a Delegate amount would change before the wallet is asked", () => {
    const html = render(view.rows, open(ALPHA, "delegate", "10"));
    expect(html).toContain("Undelegated 700 MONKEY → 690 MONKEY. Your delegation to alpha.example (0x000000…00a1) 300 MONKEY → 310 MONKEY.");
  });

  it("chooses a Move's destination from the listed candidates other than its row, and says what the move changes", () => {
    const chosen = { ...open(ALPHA, "move", "100"), moveTo: BRAVO };
    const html = render(view.rows, chosen);
    expect(html).toContain("Move to");
    expect(html.match(/<span class="truncate">bravo\.example \(0x000000…00b2\)<\/span>/g)).toHaveLength(2);
    expect(html).toContain("Your delegation to alpha.example (0x000000…00a1) 300 MONKEY → 200 MONKEY, and to bravo.example (0x000000…00b2) 0 MONKEY → 100 MONKEY. Your undelegated stake stays 700 MONKEY.");
  });

  it("chooses nothing where the chosen destination is the row itself", () => {
    const ownRow = { ...open(ALPHA, "move"), moveTo: ALPHA };
    const html = render(view.rows, ownRow);
    expect(html.match(/<span class="truncate">Choose a candidate<\/span>/g)).toHaveLength(2);
  });

  it("offers a typed address under a Move while the list in hand is not the node's current one", () => {
    const editing = { ...open(ALPHA, "move"), typedMove: "0x1234" };
    const html = render(view.rows, editing, { source: { kind: "held", verifiedAtMs: 1_793_000_000_000, block: 4_321, why: "unverified" } });
    expect(html).toContain("Or a candidate&#x27;s address");
    expect(html).toContain("An address typed here is checked only by the chain");
  });

  it("says what a Take back would change, from the delegation and the undelegated stake", () => {
    const html = render(view.rows, open(ALPHA, "undelegate", "100"));
    expect(html).toContain("Your delegation to alpha.example (0x000000…00a1) 300 MONKEY → 200 MONKEY. Undelegated 700 MONKEY → 800 MONKEY.");
  });

  it("does not carry what another row's editor holds: opening a row starts it with no amount and no destination", () => {
    const moved = { ...open(ALPHA, "move", "100"), moveTo: BRAVO };
    const editing = openRowEditor(moved, { candidate: BRAVO, mode: "delegate" });
    const html = render(view.rows, editing);
    expect(html).not.toContain("→ 200 MONKEY");
    expect(html).toContain("Amount to delegate");
  });
});

describe("the row's Yours cell", () => {
  it("shows what the account delegates to the row, and a dash where it delegates nothing", () => {
    const html = render(view.rows, NO_EDITING);
    const cells = html.match(/<dt class="text-label text-fg-3">Yours<\/dt><dd[^>]*>([^<]*)<\/dd>/g) ?? [];
    expect(cells).toHaveLength(2);
    expect(cells[0]).toContain("300 MONKEY");
    expect(cells[1]).toContain("—");
  });
});
