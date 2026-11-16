/**
 * The signer floor a visit holds every node to (monkey-trading/console#373, #374, #377): the highest signer any signed route a client of
 * the visit read named, heard from each client as each of its reads ends, whether that client is the node in use, a node tried, or a node
 * the console has moved away from.
 */

import type { EngineClient } from "./client";
import { lagging, raised, type SignerFloor } from "./operator-follow-status";
import type { NamedSigner } from "./signer-naming";
import type { OperatorRoute } from "./stats-types";

export class SignerFloorWatch {
  private floor: SignerFloor | null = null;
  /** The word that last moved the floor, at its epoch. */
  private word: Readonly<NamedSigner> | null = null;
  /** Each client heard, for the rest of the visit: a node moved away from, or a trial dropped, still ends the reads it began. */
  private readonly clients = new WeakSet<EngineClient>();

  /** `current` reads the client of the node in use, which a rise of the floor is put to. */
  constructor(private readonly current: () => EngineClient | null) {}

  /** Raises the floor by what `client`'s signed routes have named, and from now by what each of its reads names as that read ends. */
  hear(client: EngineClient): void {
    if (!this.clients.has(client)) {
      this.clients.add(client);
      // Never unsubscribed: the listener goes with the client once nothing holds it.
      client.watch((event) => {
        if (event.type === "signer") this.heard(client);
      });
    }
    this.heard(client);
  }

  /**
   * `client` is the node in use from now: the floor is held to it, so a check of a new key on a node that states no signer is judged
   * against the floor, while the enclave its own check judged keeps its verdict (monkey-trading/console#376).
   */
  inUse(client: EngineClient): void {
    if (this.word !== null) client.holdSigner(this.word);
  }

  /** Why a node whose route is `route` is not taken under the floor (`lagging`), or null. */
  lags(route: OperatorRoute | null, vaultRead: boolean): string | null {
    return lagging(this.floor, route, vaultRead);
  }

  /** Raises the floor by the highest signer `client` named, which is put to the node in use when it moves the floor and came from another node: its verdict ends if that names another key. */
  private heard(client: EngineClient): void {
    const named = client.signerNamed();
    const floor = raised(this.floor, named);
    if (named === null || floor === this.floor) return;
    this.floor = floor;
    this.word = named;
    const current = this.current();
    // The node in use judged its own word as it read it.
    if (current !== client) current?.heedSigner(named);
  }
}
