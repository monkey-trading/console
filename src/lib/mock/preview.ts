/** The mock node's `GET /v1/accounts/{address}/preview` (V84): what a market order of an exact size would do now. */

import { EngineError } from "../engine/client";
import type { OrderPreviewRequest, OrderPreviewWire } from "../engine/portfolio-types";
import type { MockState } from "./state";

/** The order's verdict; the mock does not yet model the route, so it answers as a node that predates it. */
export async function previewOrder(state: MockState, request: OrderPreviewRequest): Promise<OrderPreviewWire> {
  void state;
  void request;
  throw new EngineError(404, "not found");
}
