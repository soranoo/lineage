import { FakeResolver } from "@/__tests__/_fakes/FakeResolver";
import { FakeShaker } from "@/__tests__/_fakes/FakeShaker";
import { parseSource } from "@/__tests__/utils";
import { IssueCollector } from "@/issues";
import { OxcParser } from "@/parse";
import { BackwardSlicer } from "@/slice";
import { DependencyTracker } from "@/tracker/DependencyTracker";
import type { OffsetRange } from "@/types";
import { expect, test } from "vitest";

const file = "/compiled/page.js";
/** Select the className expressions in these simple tracker fixtures. */
const CLASSNAME_EXPRESSION_PATTERN = /className:([^}]+)/g;

/** Select an exact expression occurrence without searching by variable spelling alone.
 * @param source Original source.
 * @param expression Expression to locate.
 * @param from First permitted offset.
 * @returns Half-open selection.
 */
const range = (source: string, expression: string, from = 0): OffsetRange => {
  const start = source.indexOf(expression, from);
  if (start < 0) {
    throw new Error("Expected expression occurrence");
  }
  return { start, end: start + expression.length };
};

test("reuses an exact computed trace and protects cached nodes, edges and issues from mutation", async () => {
  const source = "const alias=missing;const page={className:alias};";
  const tracker = new DependencyTracker({ virtualFiles: { [file]: source } });
  const request = {
    entryFile: file,
    startPoint: range(source, "alias", source.indexOf("className")),
    shake: false,
  };
  const original = await tracker.track(request);
  const expected = structuredClone(original);
  original.nodes[0]!.range.start = 123;
  original.edges.length = 0;
  original.issues[0]!.message = "mutated";
  expect(await tracker.track(request)).toEqual(expected);
  expect(tracker.getTraceCacheStats()).toMatchObject({ hits: 1, misses: 1 });
});

test("reattaches a repeated binding graph to each new seed with identical cold results", async () => {
  const source =
    "const origin=missing;const alias=origin;const one={className:`one ${alias}`};const two={className:`two ${alias}`};";
  const cached = new DependencyTracker({ virtualFiles: { [file]: source } });
  const cold = new DependencyTracker({
    virtualFiles: { [file]: source },
    traceCache: { maxEntries: 0 },
  });
  const first = range(source, "alias", source.indexOf("className"));
  const second = range(source, "alias", first.end);
  for (const startPoint of [first, second]) {
    const request = { entryFile: file, startPoint, shake: false };
    expect(await cached.track(request)).toEqual(await cold.track(request));
  }
  expect(cached.getTraceCacheStats()).toMatchObject({ bindingHits: 1, hits: 1, misses: 1 });
  expect(cold.getTraceCacheStats()).toMatchObject({ hits: 0, misses: 2, entries: 0 });
});

test.each([
  "function A(){const alias=firstMissing;return {className:alias}}function B(){const alias=secondMissing;return {className:alias}}",
  "function helper(value){return value}const one={className:helper(firstMissing)};const two={className:helper(secondMissing)};",
  "function Page(value){const alias=value;const one={className:alias};const two={className:alias};return [one,two]}",
])("keeps shadowed bindings, calls and parameter-dependent graphs separate: %s", async (source) => {
  const cached = new DependencyTracker({ virtualFiles: { [file]: source } });
  const cold = new DependencyTracker({
    virtualFiles: { [file]: source },
    traceCache: { maxEntries: 0 },
  });
  for (const occurrence of source.matchAll(CLASSNAME_EXPRESSION_PATTERN)) {
    const expression = occurrence[1]!;
    const startPoint = range(source, expression, occurrence.index);
    const request = { entryFile: file, startPoint, shake: false };
    expect(await cached.track(request)).toEqual(await cold.track(request));
  }
  expect(cached.getTraceCacheStats()).toMatchObject({ bindingHits: 0, hits: 0, misses: 2 });
});

test("a changed source snapshot invalidates an exact trace at the same offsets", () => {
  const collector = new IssueCollector();
  const slicer = new BackwardSlicer(
    new OxcParser(),
    new FakeResolver(new Map()),
    new FakeShaker(new Set()),
    collector,
  );
  const first = "const alias=firstMissing;const page={className:alias};";
  const second = "const alias=otherMissing;const page={className:alias};";
  const startPoint = range(first, "alias", first.indexOf("className"));
  const firstResult = slicer.slice(
    file,
    startPoint,
    new Map([[file, parseSource(first, file)]]),
    false,
  );
  collector.clear();
  const secondResult = slicer.slice(
    file,
    startPoint,
    new Map([[file, parseSource(second, file)]]),
    false,
  );
  expect(firstResult.nodes.some((node) => node.label === "firstMissing")).toBe(true);
  expect(secondResult.nodes.some((node) => node.label === "otherMissing")).toBe(true);
  expect(secondResult.nodes.some((node) => node.label === "firstMissing")).toBe(false);
  expect(slicer.getTraceCacheStats()).toMatchObject({ hits: 0, misses: 2 });
});

test("shake mode and output assembly remain independent of cached graph reuse", async () => {
  const source = "const fixed=1;function Page(){const unused=2;return fixed}Page();";
  const cached = new DependencyTracker({ virtualFiles: { [file]: source } });
  const cold = new DependencyTracker({
    virtualFiles: { [file]: source },
    traceCache: { maxEntries: 0 },
  });
  const startPoint = range(source, "fixed", source.indexOf("return"));
  for (const shake of [false, true, false]) {
    const request = {
      entryFile: file,
      startPoint,
      shake,
      output: { mode: "blank" },
    } satisfies Parameters<typeof cached.track>[0];
    const actual = await cached.track(request);
    const expected = await cold.track(request);
    expect(actual.nodes).toEqual(expected.nodes);
    expect(actual.edges).toEqual(expected.edges);
    expect(actual.issues).toEqual(expected.issues);
    expect([...actual.files].map(([name, value]) => [name, value.ms.toString()])).toEqual(
      [...expected.files].map(([name, value]) => [name, value.ms.toString()]),
    );
  }
  expect(cached.getTraceCacheStats()).toMatchObject({ hits: 1, misses: 2 });
});
