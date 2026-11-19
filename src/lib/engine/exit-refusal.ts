/** Why the vault's exit verifier refused a check, in plain words, from the error it reverted with (monkey-trading/console#482). */

import { toFunctionSelector } from "viem";

import { texts } from "./claim-refusal";

/** The verifier's errors a wallet's check can end in, each with what it says of the proof, written to end a sentence. */
const ERRORS = ([
  ["InvalidAccountProof()", "the vault's snapshot does not confirm the proof's balance, positions or unconfirmed deposits"],
  ["UnvaluedPosition(uint32)", "the vault cannot value one of your positions, because the snapshot holds no exchange rate for the market's currency"],
] as const).map(([signature, text]) => ({ name: signature.slice(0, signature.indexOf("(")), text, selector: toFunctionSelector(`function ${signature}`).slice(2).toLowerCase() }));

/** A revert's data as a wallet passes it on: a custom error's selector and its whole-word arguments. */
const REVERT_DATA = /^0x([0-9a-f]{8})(?:[0-9a-f]{64})*$/;

/**
 * Why the verifier reverted the check of the proof's `what`, from `error`, the revert a wallet reported.
 * An error this app does not know is named by its selector, so the reason is never lost.
 */
export function verifierRefusal(what: string, error: unknown): string {
  const found = texts(error).map((text) => text.toLowerCase());
  const carried = found.join(" ");
  const known = ERRORS.find(({ name, selector }) => carried.includes(selector) || carried.includes(name.toLowerCase()));
  if (known !== undefined) return known.text;
  const selector = found.map((text) => REVERT_DATA.exec(text)?.[1]).find((held) => held !== undefined);
  if (selector !== undefined) return `the vault rejected the check of the proof's ${what} with an error code that this app does not recognise (0x${selector})`;
  return `the vault rejected the check of the proof's ${what} without giving a reason, which can mean that this version of the app does not match the vault's contracts`;
}
