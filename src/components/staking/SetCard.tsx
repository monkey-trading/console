"use client";

/**
 * The Rotation tab's two operator group cards (monkey-trading/console#280): the rotation set turns are
 * drawn from now and the next one waiting to take effect, each with a line on when it runs, its members,
 * the weight each was drawn by and its expected share of turns, and a mark on a member whose hostname
 * this build does not list.
 */

import type { ReactNode } from "react";

import { withAddress } from "@/lib/staking/operator-cells";
import type { RotationSet } from "@/lib/staking/rotation";
import { formatMonkey, formatRate } from "@/lib/format";

import { Card } from "../monkey/Card";

const TH = "px-1 py-1 text-left text-label font-normal tracking-caps text-fg-3 uppercase";
const TD = "px-1 py-1.5 align-top";

interface Props {
  id: string;
  title: string;
  /** The set, null when the node mirrors none. */
  set: RotationSet | null;
  /** What the card says above the members: when the set runs, or why there is none. */
  line: string;
  /** The longest line the card is likely to show, laid out unseen so the line landing moves nothing below it. */
  reserve: string;
  nameOf: (address: string) => string;
  /** Whether this build would have to be updated to connect to the member's registered hostname. */
  needsUpdate: (address: string) => boolean;
  /** Extra lines under the set's, such as the signer the vault names. */
  children?: ReactNode;
}

/** One set's card. */
export function SetCard({ id, title, set, line, reserve, nameOf, needsUpdate, children }: Props) {
  return (
    <Card id={id} title={title}>
      {/* The line and the members' viewport hold one size in every state — reading, empty, or any set — so nothing below them moves when the set lands. */}
      <p className="grid text-caption text-fg-2">
        <span aria-hidden="true" className="invisible col-start-1 row-start-1">{reserve}</span>
        <span className="col-start-1 row-start-1">{line}</span>
      </p>
      <div role="region" aria-label={`${title}: members`} tabIndex={0} className="-mx-1 h-32 overflow-auto outline-none focus-visible:outline-2 focus-visible:outline-glow">
        {set !== null && (
          <table className="w-full min-w-[26rem] text-label sm:text-caption">
            <caption className="sr-only">{title}: each operator, its weight in the draw for each turn and its expected share of turns. Amounts are in MONKEY.</caption>
            <thead className="sticky top-0 bg-ink-1">
              <tr>
                <th scope="col" className={TH}>Operator</th>
                <th scope="col" className={`${TH} text-right`}>Weight</th>
                <th scope="col" className={`${TH} text-right`}>Share of turns</th>
              </tr>
            </thead>
            <tbody>
              {set.members.map((member) => (
                <tr key={member.address} className="border-t border-line">
                  <td className={`${TD} break-all text-fg`}>
                    <span title={member.address}>{withAddress(nameOf(member.address), member.address)}</span>
                    {needsUpdate(member.address) && <span className="mt-1 block text-label text-amber">Needs an app update to connect to this operator</span>}
                  </td>
                  <td className={`${TD} whitespace-nowrap text-right text-fg-2`}>{formatMonkey(member.weight)}</td>
                  <td className={`${TD} whitespace-nowrap text-right text-fg`}>{formatRate(member.turnShareBps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {children}
    </Card>
  );
}
