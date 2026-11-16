/** The operator of a turn as the Rotation tab's turn tables name it (monkey-trading/console#435): its server and address, and the operator key the turn names. */

import { shortHex } from "@/lib/format";
import { withAddress } from "@/lib/staking/operator-cells";

/** `candidate` named by `nameOf`, with `adminKey` beneath. */
export function TurnOperator({ candidate, adminKey, nameOf }: { candidate: string; adminKey: string; nameOf: (address: string) => string }) {
  return (
    <>
      <span title={candidate} className="block">{withAddress(nameOf(candidate), candidate)}</span>
      <span title={adminKey} className="block text-fg-3">Operator key {shortHex(adminKey)}</span>
    </>
  );
}
