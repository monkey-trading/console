/** Several wallet connectors offered as one: their options in order, each connecting through its own. */

import type { Wallet, WalletConnector, WalletOption } from "./wallet";

export class MultiConnector implements WalletConnector {
  readonly options: readonly WalletOption[];

  constructor(private readonly connectors: readonly WalletConnector[]) {
    this.options = connectors.flatMap((c) => c.options);
  }

  /**
   * Error cases:
   * - no connector offers `optionId`
   */
  connect(optionId: string): Promise<Wallet> {
    const connector = this.connectors.find((c) => c.options.some((o) => o.id === optionId));
    if (!connector) return Promise.reject(new Error(`unknown wallet option: ${optionId}`));
    return connector.connect(optionId);
  }
}
