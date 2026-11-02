/** Every surface a message can be put on has a place on screen that shows it. */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { NOTICE_SURFACES } from "@/lib/store/state";

const root = join(__dirname);

/** The text of every component that renders a notice or reads `notices`. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    if (!path.endsWith(".tsx")) return [];
    const text = readFileSync(path, "utf8");
    return text.includes("<Notice ") || text.includes("notices") ? [text] : [];
  });
}

describe("notice surfaces", () => {
  const rendering = sources(root).join("\n");

  it.each(NOTICE_SURFACES)("%s is rendered by a component", (surface) => {
    expect(rendering).toMatch(new RegExp(`surface="${surface}"|"${surface}"|notices\\.${surface}\\b`));
  });

  it("is rendered nowhere as a toast or a popover", () => {
    expect(readdirSync(root).filter((name) => /toast/i.test(name))).toEqual([]);
    expect(rendering).not.toMatch(/popover=|showPopover|role="log"/);
  });
});
