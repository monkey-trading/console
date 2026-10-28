/** A wallet that lives in the page: it connects, "signs" and deposits against the mock node. */

import type { Wallet, WalletConnector, WalletOption, SignRequest } from "../engine/wallet";
import type { Fixed } from "../fixed";
import { mockHex } from "./client";
import type { MockControls } from "./controls";

const OPTIONS: readonly WalletOption[] = [
  { id: "browser", label: "Browser wallet", detail: "Mock account, no extension needed" },
  { id: "walletconnect", label: "WalletConnect", detail: "Mock account, no QR code" },
];

export class MockWalletConnector implements WalletConnector {
  readonly options = OPTIONS;

  constructor(private readonly controls: MockControls) {}

  async connect(optionId: string): Promise<Wallet> {
    const option = OPTIONS.find((o) => o.id === optionId);
    if (!option) throw new Error(`unknown wallet option: ${optionId}`);
    const address = `0x${mockHex(`account-${optionId}`, 20)}`;
    const controls = this.controls;
    return {
      address,
      label: option.label,
      async sign(request: SignRequest) {
        // Not a cryptographic signature: the mock node only checks its shape.
        return `0x${mockHex(JSON.stringify(request), 65)}`;
      },
      async deposit(amount: Fixed) {
        controls.deposit(address, amount);
        return `0x${mockHex(`tx-${amount}-${address}`, 32)}`;
      },
    };
  }
}
