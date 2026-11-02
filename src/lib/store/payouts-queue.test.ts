import { describe, expect, it } from "vitest";

import { settle } from "../engine/test-kit";
import { checkPaid } from "./payouts";
import { connected } from "./live-kit";

describe("checkPaid", () => {
  it("asks the vault's provider only after the wallet's earlier queued work, so the MONKEY page's reads and the payout read never overlap", async () => {
    const { store, wallet } = await connected();
    const asked: number[] = [];
    wallet.claimed = async (nonce: number) => { asked.push(nonce); return true; };
    store.patch({ approvals: [{ type: "withdrawal_approved", account: wallet.address, nonce: 3, cursor: "9:0", ts: 1 } as never] });
    let finish: () => void = () => {};
    void store.monkeySession.walletWork.work(wallet, () => new Promise<void>((resolve) => { finish = resolve; }));
    void checkPaid(store);
    await settle();
    expect(asked).toEqual([]);
    finish();
    await settle();
    expect(asked).toEqual([3]);
  });
});
