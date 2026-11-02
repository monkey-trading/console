/**
 * A wallet's provider that has one request outstanding at a time. A wallet over WalletConnect is a
 * phone, and an injected wallet holds a prompt open: the console never asks either a second thing
 * while it has not answered the first, whichever flow (a deposit, a login signature, a claim, a
 * chain read) is asking. A request waits for the one before it to settle, whether it answered or refused.
 * The queue belongs to the provider, not to a wallet object made over it: a connector makes one and
 * every wallet it returns for that provider shares it, so a reconnect cannot overlap an earlier request.
 */

import type { Eip1193Provider } from "./provider-wallet";

class SerializedProvider implements Eip1193Provider {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly provider: Eip1193Provider) {}

  request(args: Parameters<Eip1193Provider["request"]>[0]): Promise<unknown> {
    const answer = this.tail.then(() => this.provider.request(args));
    this.tail = answer.then(() => undefined, () => undefined);
    return answer;
  }
}

/** `provider` asked one request at a time; one already so is returned as it is, so wrapping twice adds no second queue. */
export function serialized(provider: Eip1193Provider): Eip1193Provider {
  return provider instanceof SerializedProvider ? provider : new SerializedProvider(provider);
}
