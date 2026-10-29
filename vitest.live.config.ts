/** Vitest configuration for the dev scenario, which needs a running engine node: `scripts/dev-live-client.sh`. */

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["scripts/live/*.live.test.ts"],
    environment: "node",
    testTimeout: 60_000,
  },
});
