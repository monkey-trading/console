/**
 * Holds the console's help text to interface-copy's length limits (monkey-trading/console#477): a tooltip says one
 * thing in at most two sentences and 40 words, and a note under a control is at most two sentences. It reads the
 * source for every `tip` and `note`, as a JSX attribute or an object's property, and every constant named `…TIP`,
 * `…TIPS`, `…HELP`, `…NOTE` or `…NOTES`, following each name to the text it holds. Text built at run time is listed
 * in `DYNAMIC` with what it can say, and the help text already over the limits in `OVER_LIMIT`, which only shrinks.
 */

import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { overLimit, type HelpKind } from "@/lib/copy-length";
import { describeSchedule } from "@/lib/fee-words";
import { LAUNCH_CURVE } from "@/lib/holding-fee";
import { describeDetails, describePnl } from "@/lib/pnl-words";
import { formatStamp } from "@/lib/time";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const KEYS = new Map<string, HelpKind>([["tip", "tooltip"], ["note", "note"]]);
const NAMES: [RegExp, HelpKind][] = [[/(^|_)(TIP|TIPS|HELP)$/, "tooltip"], [/(^|_)(NOTE|NOTES)$/, "note"]];

/**
 * Text built at run time where help text shows, by file and expression: what it can say, each branch of its
 * builder, or null for a status, which says why a figure or a control is unavailable and is an error, not help.
 */
const DYNAMIC: Record<string, (() => string[]) | null> = {
  "src/components/PositionsView.tsx: r.details": () => [
    describeDetails({ pnl: describePnl("$120.00", null), noClose: null, noFee: false }),
    describeDetails({ pnl: describePnl("-$80.00", null), noClose: null, noFee: true }),
    describeDetails({ pnl: describePnl("$120.00", "No price is available for this market yet."), noClose: "No price is available for this market yet.", noFee: false }),
    describeDetails({ pnl: describePnl("$120.00", null), noClose: "The trading terms have changed, and the new terms could not be loaded. The app will try again automatically.", noFee: false }),
  ],
  "src/components/PositionsView.tsx: describeSchedule(feeTerms)": () => [describeSchedule({ profitFeeBps: 1_000, profitFeeCurve: LAUNCH_CURVE }), describeSchedule({ profitFeeBps: 1_000, profitFeeCurve: [] })],
  "src/components/house/Stats.tsx: formatStamp(scan.volumeSinceMs)": () => [formatStamp(Date.UTC(2026, 10, 19, 8))],
  "src/components/DashboardPage.tsx: overviewProblem(overview, \"the reserve\")": null,
  "src/components/house/Charts.tsx: feedProblem(monkey, \"the reserve\")": null,
  "src/components/SignGate.tsx: signBlock(attestation, stream, wallet?.readOnly === true)": null,
  "src/components/SignGate.tsx: chainAway(walletChain, deploy.chainId)": null,
  "src/components/SignGate.tsx: action": null,
};

/** Help text over the limits when they were set (monkey-trading/console#477), each to be cut to them and taken off this list. */
const OVER_LIMIT: readonly string[] = [
  "src/components/PositionsView.tsx CLOSEOUT_TIP",
  "src/components/PositionsView.tsx PNL_TIP",
  "src/components/PositionsView.tsx HOLD_TIP",
  "src/components/PositionsView.tsx FEE_USD_TIP",
  "src/components/PositionsView.tsx CLOSE_TIP",
  "src/components/PositionsView.tsx <Term label=\"Details\">",
  "src/components/house/Charts.tsx <SeriesPanel title=\"House value\">",
  "src/components/house/CloseoutMap.tsx <Panel title=\"Close-out map\">",
  "src/components/house/HouseDetails.tsx <Panel title=\"Market limits\">",
  "src/components/house/HouseDetails.tsx <Panel title=\"Trading terms\">",
  "src/components/house/PositionMap.tsx <Panel title=\"Position map\">",
  "src/components/house/Stats.tsx <Row label=\"Distributed\">",
  "src/lib/ledger-cell.ts COLUMN_NOTE",
];

interface Site {
  id: string;
  kind: HelpKind;
  texts: string[];
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

/** Every help text site in the source, the run-time text it reaches that `DYNAMIC` does not list, and the entries it used. */
function scan(): { sites: Site[]; unlisted: string[]; used: Set<string> } {
  const program = ts.createProgram(sources(SRC), { noResolve: true, noLib: true, types: [], jsx: ts.JsxEmit.ReactJSX, moduleResolution: ts.ModuleResolutionKind.Bundler, paths: { "@/*": [`${SRC}/*`] } });
  const checker = program.getTypeChecker();
  const sites: Site[] = [];
  const unlisted: string[] = [];
  const used = new Set<string>();

  const declarationOf = (node: ts.Node): ts.Declaration | undefined => {
    let symbol = ts.isShorthandPropertyAssignment(node.parent) ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
    if (symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  };
  const unwrap = (node: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) ? unwrap(node.expression) : node);
  const kindOf = (declaration: ts.Node | undefined) => (declaration !== undefined && ts.isVariableDeclaration(declaration) ? NAMES.find(([pattern]) => pattern.test(declaration.name.getText()))?.[1] : undefined);
  const named = (declaration: ts.Node | undefined) => kindOf(declaration) !== undefined;
  // The text a property read such as `TIPS.share` names in the object a constant holds, if any.
  const memberOf = (node: ts.PropertyAccessExpression): ts.Expression | undefined => {
    const holder = declarationOf(node.expression);
    const value = holder !== undefined && ts.isVariableDeclaration(holder) && holder.initializer !== undefined ? unwrap(holder.initializer) : undefined;
    const member = value !== undefined && ts.isObjectLiteralExpression(value) ? value.properties.find((p) => p.name?.getText() === node.name.text) : undefined;
    return member !== undefined && ts.isPropertyAssignment(member) ? member.initializer : undefined;
  };
  const combine = (parts: string[][]): string[] => parts.reduce((heads, part) => heads.flatMap((head) => part.map((tail) => head + tail)), [""]);

  /** Each text `node` can be, a status or an unlisted run-time value adding none. */
  const evaluate = (input: ts.Expression): string[] => {
    const node = unwrap(input);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isNumericLiteral(node)) return [node.text];
    if (node.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(node) && node.text === "undefined")) return [];
    // A tip or note read from an object is checked where the object is written.
    if (ts.isPropertyAccessExpression(node) && KEYS.has(node.name.text)) return [];
    if (ts.isConditionalExpression(node)) return [...evaluate(node.whenTrue), ...evaluate(node.whenFalse)];
    if (ts.isTemplateExpression(node)) return combine([[node.head.text], ...node.templateSpans.flatMap((span) => [evaluate(span.expression), [span.literal.text]])]);
    // A figure worked out in a sentence reads as one word.
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.SlashToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.MinusToken].includes(node.operatorToken.kind)) return ["3"];
    if (ts.isJsxElement(node)) return combine(node.children.map((child) => (ts.isJsxText(child) ? [child.text.replace(/\s+/g, " ")] : ts.isJsxExpression(child) && child.expression !== undefined ? evaluate(child.expression) : ts.isJsxElement(child) ? evaluate(child) : [""])));
    const declaration = ts.isIdentifier(node) ? declarationOf(node) : undefined;
    if (declaration !== undefined && ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) return evaluate(declaration.initializer);
    const member = ts.isPropertyAccessExpression(node) ? memberOf(node) : undefined;
    if (member !== undefined) return evaluate(member);
    const key = `${relative(ROOT, node.getSourceFile().fileName)}: ${node.getText().replace(/\s+/g, " ")}`;
    used.add(key);
    const listed = DYNAMIC[key];
    if (listed === undefined) unlisted.push(key);
    return listed?.() ?? [];
  };

  /** A site's texts, or none where its text is a parameter, a constant or a property checked where it is written. */
  const siteTexts = (input: ts.Expression): string[] => {
    const node = unwrap(input);
    const declaration = ts.isIdentifier(node) ? declarationOf(node) : undefined;
    if (declaration !== undefined && (ts.isParameter(declaration) || (ts.isBindingElement(declaration) && ts.isParameter(ts.walkUpBindingElementsAndPatterns(declaration))) || named(declaration))) return [];
    if (ts.isPropertyAccessExpression(node) && named(declarationOf(node.expression))) return [];
    return evaluate(node);
  };

  const label = (attributes: readonly ts.ObjectLiteralElementLike[] | readonly ts.JsxAttributeLike[]): string => {
    for (const attribute of attributes) {
      const value = ts.isJsxAttribute(attribute) ? attribute.initializer : ts.isPropertyAssignment(attribute) ? attribute.initializer : undefined;
      const name = attribute.name?.getText() ?? "";
      if (["label", "title", "legend"].includes(name) && value !== undefined && ts.isStringLiteral(value)) return ` ${name}=${JSON.stringify(value.text)}`;
    }
    return "";
  };

  for (const file of program.getSourceFiles()) {
    const path = relative(ROOT, file.fileName);
    const add = (name: string, kind: HelpKind, texts: string[]) => sites.push({ id: `${path} ${name}`, kind, texts });
    const visit = (node: ts.Node) => {
      const key = ts.isJsxAttribute(node) || ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) ? KEYS.get(node.name.getText()) : undefined;
      if (key !== undefined && ts.isJsxAttribute(node) && node.initializer !== undefined) {
        const value = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer;
        const element = node.parent.parent;
        if (value !== undefined) add(`<${element.tagName.getText()}${label(node.parent.properties)}>`, key, siteTexts(value));
      } else if (key !== undefined && (ts.isShorthandPropertyAssignment(node) || (ts.isPropertyAssignment(node) && !ts.isObjectLiteralExpression(unwrap(node.initializer))))) {
        const holder = node.parent.parent;
        const where = label(node.parent.properties) || (ts.isVariableDeclaration(holder) ? ` in ${holder.name.getText()}` : "");
        add(`{${where} ${node.name.getText()} }`, key, siteTexts(ts.isPropertyAssignment(node) ? node.initializer : node.name));
      } else if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
        const kind = kindOf(node);
        const value = unwrap(node.initializer);
        // An object of help texts, such as `TIPS`, holds one per member.
        const members = ts.isObjectLiteralExpression(value) ? value.properties.filter(ts.isPropertyAssignment).map((member) => [`${node.name.getText()}.${member.name.getText()}`, member.initializer] as const) : [[node.name.getText(), value] as const];
        if (kind !== undefined) for (const [name, text] of members) add(name, kind, evaluate(text));
      }
      ts.forEachChild(node, visit);
    };
    if (file.fileName.startsWith(SRC)) visit(file);
  }
  return { sites, unlisted, used };
}

const { sites, unlisted, used } = scan();
const over = sites.flatMap((site) => site.texts.flatMap((text) => {
  const counted = overLimit(site.kind, text);
  return counted === null ? [] : [{ id: site.id, kind: site.kind, counted, text }];
}));

describe("the console's help text", () => {
  it("is read from every tooltip and note, the level fields' and the House page's among them", () => {
    const ids = sites.map((site) => site.id);
    expect(ids).toEqual(expect.arrayContaining(["src/lib/level-words.ts LEVELS_HELP", "src/lib/level-words.ts TICKET_LEVELS_NOTES.rests", "src/components/house/Stats.tsx <Row label=\"House funds\">", "src/components/PreferencesCard.tsx <Choice legend=\"Default size\">", "src/lib/house/monkey-figures.ts { label=\"Earned so far\" tip }"]));
    expect(sites.find((site) => site.id === "src/lib/level-words.ts LEVELS_HELP")?.texts).toEqual([expect.stringMatching(/^A take profit or stop loss closes your entire position/)]);
  });

  it("lists every text built at run time with what it can say", () => {
    expect(unlisted).toEqual([]);
  });

  it("lists only run-time text the source still holds", () => {
    expect(Object.keys(DYNAMIC).filter((key) => !used.has(key))).toEqual([]);
  });

  it("holds each tooltip to two sentences and 40 words, and each note to two sentences, but those listed as over", () => {
    expect(over.filter((entry) => !OVER_LIMIT.includes(entry.id)).map((entry) => `${entry.id}, a ${entry.kind} of ${entry.counted}: ${entry.text}`)).toEqual([]);
  });

  it("lists only help text still over the limits", () => {
    expect(OVER_LIMIT.filter((id) => !over.some((entry) => entry.id === id))).toEqual([]);
  });
});
