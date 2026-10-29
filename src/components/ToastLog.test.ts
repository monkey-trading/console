/** Tests for the announcement log's markup. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ToastLog } from "./ToastLog";

const render = (texts: string[]) => renderToStaticMarkup(createElement(ToastLog, { toasts: texts.map((text, i) => ({ id: i + 1, tone: "ok" as const, text })) }));

describe("ToastLog", () => {
  it("is a polite log holding every message as its own node, so an older one is not announced again when the newest goes", () => {
    const html = render(["First", "Second"]);
    expect(html).toContain('role="log"');
    expect(html).toContain('aria-live="polite"');
    expect(html.match(/<p>/g)).toHaveLength(2);
    expect(html).toContain("<p>First</p><p>Second</p>");
    expect(render(["First"])).toContain("<p>First</p>");
  });

  it("holds a repeated message as a node of its own", () => {
    expect(render(["Filled", "Filled"]).match(/<p>Filled<\/p>/g)).toHaveLength(2);
  });

  it("is empty with no messages", () => {
    expect(render([])).not.toContain("<p>");
  });
});
