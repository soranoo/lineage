import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type {
  AbsolutePath,
  IssueKind,
  OffsetRange,
  SourceText,
  TrackResult,
  TrackerIssue,
} from "@/types";

import { DependencyTracker } from "@/index";

/**
 * Absolute path to the fixture root folder.
 */
const fixturesRoot: AbsolutePath = path.resolve(process.cwd(), "src/__tests__/_fixtures");

/**
 * Build an absolute path for a fixture file.
 *
 * @param relativePath Relative fixture file path under the fixture root.
 * @returns Absolute fixture file path.
 */
const toFixturePath = (relativePath: SourceText): AbsolutePath =>
  path.resolve(fixturesRoot, relativePath);

/**
 * Read fixture source text from disk.
 *
 * @param relativePath Relative fixture file path under the fixture root.
 * @returns UTF-8 fixture source text.
 */
const readFixtureSource = (relativePath: SourceText): SourceText =>
  readFileSync(toFixturePath(relativePath), "utf8");

/**
 * Find an offset range for a required source fragment.
 *
 * @param source Source text to search.
 * @param fragment Required fragment that must exist in the source.
 * @returns Offset range spanning the first match of the fragment.
 * @throws {Error} When the fragment cannot be found.
 */
const rangeForFragment = (source: SourceText, fragment: SourceText): OffsetRange => {
  const start = source.indexOf(fragment);

  if (start < 0) {
    throw new Error(`Fragment not found: ${fragment}`);
  }

  return { start, end: start + fragment.length };
};

/**
 * Run dependency tracking for a fixture file and fragment start point.
 *
 * @param relativePath Relative fixture path.
 * @param fragment Source fragment to use for start-point lookup.
 * @param ignorePatterns Optional ignore pattern list.
 * @returns Track result for the fixture run.
 */
const trackFixture = async (
  relativePath: SourceText,
  fragment: SourceText,
  ignorePatterns?: Array<SourceText | RegExp>,
): Promise<TrackResult> => {
  const entryFile = toFixturePath(relativePath);
  const source = readFixtureSource(relativePath);
  const startPoint = rangeForFragment(source, fragment);
  const tracker = new DependencyTracker({ ignorePatterns });

  return tracker.track({ entryFile, startPoint });
};

/**
 * Resolve the first issue of a specific kind.
 *
 * @param issues Tracker issues to scan.
 * @param kind Issue kind to find.
 * @returns First matching issue, or undefined when absent.
 */
const findIssue = (issues: TrackerIssue[], kind: IssueKind): TrackerIssue | undefined =>
  issues.find((issue) => issue.kind === kind);

/**
 * Check whether any node label includes the provided fragment.
 *
 * @param result Track result containing nodes.
 * @param fragment Label fragment to search for.
 * @returns True when at least one node label includes the fragment.
 */
const hasNodeLabel = (result: TrackResult, fragment: SourceText): boolean =>
  result.nodes.some((node) => node.label.includes(fragment));

/**
 * Find the first node whose label includes a fragment.
 *
 * @param result Track result containing nodes.
 * @param fragment Label fragment to search for.
 * @returns First matching node, or undefined when absent.
 */
const findNodeByLabel = (result: TrackResult, fragment: SourceText) =>
  result.nodes.find((node) => node.label.includes(fragment));

/**
 * Build a map from node ID to absolute file path.
 *
 * @param result Track result containing dependency nodes.
 * @returns Node ID to file map.
 */
const buildNodeFileMap = (result: TrackResult): Map<SourceText, AbsolutePath> => {
  const map = new Map<SourceText, AbsolutePath>();

  for (const node of result.nodes) {
    map.set(node.id, node.file);
  }

  return map;
};

describe("pipeline fixtures", () => {
  it("Ex. 1 linear chain emits expected kinds and no issues", async () => {
    const result = await trackFixture("linear-chain/main.ts", "return b(t, e);");

    expect(result.nodes.length).toBeGreaterThanOrEqual(7);
    expect(result.issues).toHaveLength(0);
    expect(result.nodes.some((node) => node.kind === "start-point")).toBe(true);
    expect(result.nodes.some((node) => node.kind === "function")).toBe(true);
    expect(result.nodes.some((node) => node.kind === "variable")).toBe(true);
    expect(result.nodes.some((node) => node.kind === "parameter")).toBe(true);
    expect(result.nodes.some((node) => node.kind === "global")).toBe(true);
    expect(result.edges.some((edge) => edge.kind === "call")).toBe(true);
    expect(result.edges.some((edge) => edge.kind === "param-bind")).toBe(true);
    expect(result.edges.some((edge) => edge.kind === "data-flow")).toBe(true);
  });

  it("Ex. 2 intra-function shaking marks three shaken and three unshaken nodes", async () => {
    const result = await trackFixture("intra-shake/main.ts", "return doubled;");

    const shakenCount = result.nodes.filter((node) => node.shaken).length;
    const unshakenCount = result.nodes.filter((node) => !node.shaken).length;

    expect(shakenCount).toBe(3);
    expect(unshakenCount).toBe(3);
  });

  it("Ex. 3 variable declaration includes base and multiplier while excluding unrelated", async () => {
    const result = await trackFixture(
      "linear-chain/variable-declaration.ts",
      "result = base * multiplier",
    );

    expect(hasNodeLabel(result, "base = 10")).toBe(true);
    expect(hasNodeLabel(result, "multiplier = 3")).toBe(true);
    expect(hasNodeLabel(result, "unrelated = 99")).toBe(false);
  });

  it("Ex. 4 sub-expression start emits unresolved-dependency issue", async () => {
    const result = await trackFixture("unresolved/main.ts", "transform(c)");

    const unresolvedIssue = findIssue(result.issues, "unresolved-dependency");

    expect(unresolvedIssue).toBeDefined();
  });

  it("Ex. 5 cross-file import includes nodes in two files and import edges", async () => {
    const result = await trackFixture("cross-file/main.ts", "result = add(x, y)");

    const fileSet = new Set(result.nodes.map((node) => node.file));

    expect(fileSet.size).toBeGreaterThanOrEqual(2);
    expect(result.edges.some((edge) => edge.kind === "import")).toBe(true);
  });

  it("Ex. 6 re-export chain includes re-export node and ultimate util function", async () => {
    const result = await trackFixture("cross-file/main.ts", "label = format(\"hello\")");

    expect(result.nodes.some((node) => node.kind === "re-export")).toBe(true);
    expect(hasNodeLabel(result, "format = (value: string): string => value.trim().toUpperCase()"))
      .toBe(true);
  });

  it("Ex. 7 ignored path emits ignored-path issue with matching custom pattern", async () => {
    const generatedPattern = /generated/;
    const result = await trackFixture(
      "ignored-path/main.ts",
      "parsed = schemaValue + input",
      [generatedPattern],
    );

    const ignoredIssue = findIssue(result.issues, "ignored-path");

    expect(ignoredIssue).toBeDefined();
    expect(ignoredIssue?.matchedPattern).toBe(generatedPattern);
  });

  it("Ex. 8 node_modules import emits ignored-path with implicit node_modules pattern", async () => {
    const result = await trackFixture("ignored-path/main.ts", "external = externalValue");

    const ignoredIssue = findIssue(result.issues, "ignored-path");

    expect(ignoredIssue).toBeDefined();
    expect(ignoredIssue?.matchedPattern).toBe("node_modules");
  });

  it("Ex. 9 unresolved dependency emits unresolved leaf and issue", async () => {
    const result = await trackFixture("unresolved/main.ts", "unresolvedResult = missingTransform(value)");

    expect(findIssue(result.issues, "unresolved-dependency")).toBeDefined();
    expect(result.nodes.some((node) => node.kind === "unresolved-leaf")).toBe(true);
  });

  it("Ex. 10 closure fixture includes a closure edge", async () => {
    const result = await trackFixture("closures-conditionals/main.ts", "tax = taxer(100)");

    expect(result.edges.some((edge) => edge.kind === "closure")).toBe(true);
  });

  it("Ex. 11 conditional fixture includes both branches and excludes unused", async () => {
    const result = await trackFixture("closures-conditionals/main.ts", "picked = choose(true)");

    expect(hasNodeLabel(result, "valueA = 10")).toBe(true);
    expect(hasNodeLabel(result, "valueB = 20")).toBe(true);
    expect(hasNodeLabel(result, "unusedConditional = 999")).toBe(false);
  });

  it("Ex. 12 dynamic import emits dynamic-import issue", async () => {
    const result = await trackFixture(
      "dynamic-patterns/dynamic-import.ts",
      "dynamicImportResult = import(\"./module.ts\")",
    );

    expect(findIssue(result.issues, "dynamic-import")).toBeDefined();
  });

  it("Ex. 13 computed property emits computed-property issue", async () => {
    const result = await trackFixture("dynamic-patterns/computed.ts", "computedResult = obj[key]");

    expect(findIssue(result.issues, "computed-property")).toBeDefined();
  });

  it("Ex. 14 indirect call emits indirect-call issue", async () => {
    const result = await trackFixture(
      "dynamic-patterns/indirect-call.ts",
      "indirectResult = f()",
    );

    expect(findIssue(result.issues, "indirect-call")).toBeDefined();
  });

  it("Ex. 15 eval emits eval issue and keeps enclosing scope node", async () => {
    const result = await trackFixture("dynamic-patterns/eval.ts", "evalResult = runEval(2)");

    expect(findIssue(result.issues, "eval")).toBeDefined();
    expect(hasNodeLabel(result, "const local = input + 1;")).toBe(true);
  });

  it("Ex. 16 arguments object emits issue and includes call-site args", async () => {
    const result = await trackFixture(
      "dynamic-patterns/arguments.ts",
      "argumentsResult = pickFirst(first, second)",
    );

    expect(findIssue(result.issues, "arguments-object")).toBeDefined();
    expect(hasNodeLabel(result, "first = 1")).toBe(true);
    expect(hasNodeLabel(result, "second = 2")).toBe(true);
  });

  it("Ex. 17 class method fixture emits this-call and includes constructor/add nodes", async () => {
    const result = await trackFixture("class-async-circular/class.ts", "classResult = calculator.add(2)");

    expect(findIssue(result.issues, "this-call")).toBeDefined();
    expect(hasNodeLabel(result, "constructor(start: number)")).toBe(true);
    expect(hasNodeLabel(result, "add(value: number): number")).toBe(true);
  });

  it("Ex. 18 async await fixture emits data-flow edge into awaited variable", async () => {
    const result = await trackFixture("class-async-circular/async.ts", "return data;");

    const awaitedVariableNode = findNodeByLabel(result, "data = await fetchRemote()");

    if (!awaitedVariableNode) {
      throw new Error("Expected awaited variable node in async fixture slice.");
    }

    expect(
      result.edges.some((edge) => edge.kind === "data-flow" && edge.to === awaitedVariableNode.id),
    ).toBe(true);
  });

  it("Ex. 19 circular imports complete without throwing and include cross-file back-edges", async () => {
    const entryPath = "class-async-circular/circular-a.ts";
    const source = readFixtureSource(entryPath);
    const startPoint = rangeForFragment(source, "circularResultA = valueA");
    const tracker = new DependencyTracker();
    const result = await tracker.track({ entryFile: toFixturePath(entryPath), startPoint });

    const circularAPath = toFixturePath("class-async-circular/circular-a.ts");
    const circularBPath = toFixturePath("class-async-circular/circular-b.ts");
    const nodeFileMap = buildNodeFileMap(result);

    const hasAtoB = result.edges.some((edge) => {
      const fromFile = nodeFileMap.get(edge.from);
      const toFile = nodeFileMap.get(edge.to);

      return fromFile === circularAPath && toFile === circularBPath;
    });

    const hasBtoA = result.edges.some((edge) => {
      const fromFile = nodeFileMap.get(edge.from);
      const toFile = nodeFileMap.get(edge.to);

      return fromFile === circularBPath && toFile === circularAPath;
    });

    expect(result.nodes.length).toBeGreaterThan(0);
    expect(hasAtoB).toBe(true);
    expect(hasBtoA).toBe(true);
  });
});
