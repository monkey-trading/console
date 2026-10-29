// Fails the build when the verifier's .wasm is not the one `src/lib/engine/wasm-pin.json` pins.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import process from "node:process";
import { URL } from "node:url";

const pin = JSON.parse(readFileSync(new URL("../src/lib/engine/wasm-pin.json", import.meta.url), "utf8"));
const wasm = readFileSync(new URL("../public/engine-verify/engine_verify_bg.wasm", import.meta.url));
const actual = createHash("sha256").update(wasm).digest("hex");
if (actual !== pin.sha256) {
  process.stderr.write(`public/engine-verify/engine_verify_bg.wasm is ${actual}, but wasm-pin.json pins ${pin.sha256}\n`);
  process.exit(1);
}
