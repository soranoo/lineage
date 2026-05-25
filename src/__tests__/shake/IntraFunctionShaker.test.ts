import { assertNever } from "assert-never";
import { Visitor } from "oxc-parser";
import type { VisitorObject } from "oxc-parser";
import type { Statement } from "@oxc-project/types";
import { describe, expect, it } from "vitest";

import type { AbsolutePath, FunctionNode, OffsetRange, SourceText } from "@/types";

import { OxcParser } from "@/parse/OxcParser";
import { IntraFunctionShaker } from "@/shake/IntraFunctionShaker";

const file: AbsolutePath = "/project/src/shake.ts";

/**
 * Parse the source and return the first function node found.
 *
 * @param source Source text containing a function.
 * @returns First FunctionNode found in the parsed AST.
 * @throws {Error} When no function node is found.
 */
const parseFunction = (source: SourceText): FunctionNode => {
  const parser = new OxcParser();
  const parsed = parser.parse(file, source);
  let found: FunctionNode | null = null;

  const visitor: VisitorObject = {
    FunctionDeclaration: (node) => {
      if (found === null) {
        found = node;
      }
    },
    FunctionExpression: (node) => {
      if (found === null) {
        found = node;
      }
    },
    ArrowFunctionExpression: (node) => {
      if (found === null) {
        found = node;
      }
    },
  };

  const walker = new Visitor(visitor);
  walker.visit(parsed.ast);

  if (found === null) {
    throw new Error("Expected a function node.");
  }

  return found;
};

/**
 * Extract statements from a function body.
 *
 * @param fn Function node to inspect.
 * @returns Statements from the function body, or an empty list for expression bodies.
 * @throws {Error} When an unexpected function node type is encountered.
 */
const getFunctionStatements = (fn: FunctionNode): Statement[] => {
  switch (fn.type) {
    case "ArrowFunctionExpression":
      if (fn.body.type === "BlockStatement") {
        return fn.body.body;
      }
      return [];
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "TSDeclareFunction":
    case "TSEmptyBodyFunctionExpression":
      return fn.body?.body ?? [];
    default:
      return assertNever(fn);
  }
};

/**
 * Build a stable key from a range for set comparisons.
 *
 * @param range Offset range to convert.
 * @returns Range key string in "start:end" form.
 */
const rangeKey = (range: OffsetRange): string => `${range.start}:${range.end}`;

/**
 * Assert that two sets of ranges match by value.
 *
 * @param actual Actual shaken ranges.
 * @param expected Expected shaken ranges.
 */
const expectShakenRanges = (actual: Set<OffsetRange>, expected: OffsetRange[]): void => {
  const actualKeys = [...actual].map(rangeKey).sort();
  const expectedKeys = expected.map(rangeKey).sort();

  expect(actualKeys).toEqual(expectedKeys);
};

describe("IntraFunctionShaker", () => {
  it("returns no shaken ranges for a single return", () => {
    const fn = parseFunction("function sample(x) { return x; }");
    const shaker = new IntraFunctionShaker();

    const shaken = shaker.shake(fn, "function sample(x) { return x; }");

    expect(shaken.size).toBe(0);
  });

  it("shakes statements that do not feed the return", () => {
    const source = "function sample(x) { const log = 'x'; console.log(log); return x; }";
    const fn = parseFunction(source);
    const statements = getFunctionStatements(fn);
    const shaker = new IntraFunctionShaker();

    const shaken = shaker.shake(fn, source);
    const expected = statements.slice(0, 2).map((statement) => ({
      start: statement.start,
      end: statement.end,
    }));

    expectShakenRanges(shaken, expected);
  });

  it("keeps both branches of return paths and shakes unrelated statements", () => {
    const source =
      "function sample(flag, a, b) { const unused = 1; if (flag) { return a; } else { return b; } }";
    const fn = parseFunction(source);
    const statements = getFunctionStatements(fn);
    const shaker = new IntraFunctionShaker();

    const shaken = shaker.shake(fn, source);
    const expected = [
      {
        start: statements[0]?.start ?? 0,
        end: statements[0]?.end ?? 0,
      },
    ];

    expectShakenRanges(shaken, expected);
  });

  it("keeps a linear dependency chain", () => {
    const source = "function sample() { const a = 1; const b = a + 1; return b; }";
    const fn = parseFunction(source);
    const shaker = new IntraFunctionShaker();

    const shaken = shaker.shake(fn, source);

    expect(shaken.size).toBe(0);
  });

  it("shakes declarations that are not used by the return", () => {
    const source = "function sample() { const a = 1; const b = 2; return a; }";
    const fn = parseFunction(source);
    const statements = getFunctionStatements(fn);
    const shaker = new IntraFunctionShaker();

    const shaken = shaker.shake(fn, source);
    const expected = [
      {
        start: statements[1]?.start ?? 0,
        end: statements[1]?.end ?? 0,
      },
    ];

    expectShakenRanges(shaken, expected);
  });

  it("never shakes arrow function expression bodies", () => {
    const source = "const double = (x) => x * 2;";
    const fn = parseFunction(source);
    const shaker = new IntraFunctionShaker();

    const shaken = shaker.shake(fn, source);

    expect(shaken.size).toBe(0);
  });

  it("treats yield statements as return sinks", () => {
    const source = "function* gen(a) { const unused = 1; yield a; }";
    const fn = parseFunction(source);
    const statements = getFunctionStatements(fn);
    const shaker = new IntraFunctionShaker();

    const shaken = shaker.shake(fn, source);
    const expected = [
      {
        start: statements[0]?.start ?? 0,
        end: statements[0]?.end ?? 0,
      },
    ];

    expectShakenRanges(shaken, expected);
  });

  it("keeps awaited values that feed a return", () => {
    const source = "async function loadValue() { const value = await load(); return value; }";
    const fn = parseFunction(source);
    const shaker = new IntraFunctionShaker();

    const shaken = shaker.shake(fn, source);

    expect(shaken.size).toBe(0);
  });

  it("returns an empty set for empty function bodies", () => {
    const source = "function empty() {}";
    const fn = parseFunction(source);
    const shaker = new IntraFunctionShaker();

    const shaken = shaker.shake(fn, source);

    expect(shaken.size).toBe(0);
  });
});
