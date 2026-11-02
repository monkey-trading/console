/**
 * A wallet's provider that has one request outstanding at a time. A wallet over WalletConnect is a
 * phone, and an injected wallet holds a prompt open: the console never asks either a second thing
 * while it has not answered the first, whichever flow (a deposit, a login signature, a claim, a
 * chain read) is asking. A request waits for the one before it to settle, whether it answered or refused.
 */

import type { Eip1193Provider } from "./provider-wallet";

export function serialized(provider: Eip1193Provider): Eip1193Provider {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    request(args) {
      const answer = tail.then(() => provider.request(args));
      tail = answer.then(() => undefined, () => undefined);
      return answer;
    },
  };
}
