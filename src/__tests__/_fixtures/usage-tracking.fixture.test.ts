import path from "node:path";

import { describe, expect, it } from "vitest";

import type { AbsolutePath, OffsetRange, SourceText, UsageNode } from "@/types";

import { findRange, readFixtureSource, toFixturePath } from "@/__tests__/utils";
import { DependencyTracker, UsageTracker } from "@/index";

const createFixtureTracker = (relativeEntryFile: SourceText): UsageTracker =>
  new UsageTracker({
    projectRoot: path.dirname(toFixturePath(relativeEntryFile)),
    resolver: { extensions: [".ts", ".tsx", ".js", ".jsx"] },
  });

const readNodes = (nodes: UsageNode[], kind: UsageNode["kind"]): UsageNode[] =>
  nodes.filter((node) => node.kind === kind);

describe("UsageTracker fixture integration", () => {
  it("tracks every fan-out importer and each local alias usage", () => {
    const relativeEntryFile = "usage/fanout/a.ts";
    const entryFile = toFixturePath(relativeEntryFile);
    const entrySource = readFixtureSource(relativeEntryFile);
    const result = createFixtureTracker(relativeEntryFile).track({
      entryFile,
      startPoint: findRange(entrySource, "const x = 1"),
    });

    const importFileNames = readNodes(result.nodes, "import-usage").map((node) =>
      path.basename(node.file),
    );
    expect(importFileNames).toEqual(
      expect.arrayContaining(["b.ts", "c.ts", "one.ts", "two.ts"]),
    );
    expect(result.nodes.some((node) => path.basename(node.file) === "one.ts" && node.label === "first")).toBe(true);
    expect(result.nodes.some((node) => path.basename(node.file) === "two.ts" && node.label === "second")).toBe(true);
    expect(result.nodes.some((node) => path.basename(node.file) === "c.ts" && node.label === "x")).toBe(true);
  });

  it("reports a callback capture as an ordinary read reference", () => {
    const relativeEntryFile = "usage/closure-capture/main.ts";
    const entryFile = toFixturePath(relativeEntryFile);
    const source = readFixtureSource(relativeEntryFile);
    const result = createFixtureTracker(relativeEntryFile).track({
      entryFile,
      startPoint: findRange(source, "const multiplier = 2"),
    });

    expect(readNodes(result.nodes, "read-reference")).toEqual([
      expect.objectContaining({ file: entryFile, label: "multiplier" }),
    ]);
  });

  it("keeps parameter and return continuations isolated per tracked binding", () => {
    const relativeEntryFile = "usage/param-return-isolation/main.ts";
    const entryFile = toFixturePath(relativeEntryFile);
    const source = readFixtureSource(relativeEntryFile);
    const tracker = createFixtureTracker(relativeEntryFile);

    const aResult = tracker.track({ entryFile, startPoint: findRange(source, "let a = 1") });
    const optionsResult = tracker.track({ entryFile, startPoint: findRange(source, "options") });
    const bResult = tracker.track({ entryFile, startPoint: findRange(source, "const b = options") });

    expect(readNodes(aResult.nodes, "untraced-continuation")).toEqual([
      expect.objectContaining({ continuation: expect.objectContaining({ reason: "call-argument" }) }),
    ]);
    expect(readNodes(optionsResult.nodes, "untraced-continuation")).toEqual([
      expect.objectContaining({ continuation: expect.objectContaining({ reason: "reassignment" }) }),
    ]);
    expect(readNodes(bResult.nodes, "untraced-continuation")).toEqual([
      expect.objectContaining({ continuation: expect.objectContaining({ reason: "return-value" }) }),
    ]);
    expect(aResult.nodes).toHaveLength(3);
    expect(optionsResult.nodes).toHaveLength(2);
    expect(bResult.nodes).toHaveLength(2);
  });

  it("finds closure reassignment in addition to a call-argument continuation", () => {
    const relativeEntryFile = "usage/closure-reassignment/main.ts";
    const entryFile = toFixturePath(relativeEntryFile);
    const source = readFixtureSource(relativeEntryFile);
    const result = createFixtureTracker(relativeEntryFile).track({
      entryFile,
      startPoint: findRange(source, "let a = 1"),
    });

    expect(result.nodes).toHaveLength(4);
    expect(readNodes(result.nodes, "untraced-continuation")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ continuation: expect.objectContaining({ reason: "call-argument" }) }),
        expect.objectContaining({ continuation: expect.objectContaining({ reason: "reassignment" }) }),
      ]),
    );
  });

  it("follows a three-file re-export chain to its final importer", () => {
    const relativeEntryFile = "usage/reexport-chain/source.ts";
    const entryFile = toFixturePath(relativeEntryFile);
    const source = readFixtureSource(relativeEntryFile);
    const result = createFixtureTracker(relativeEntryFile).track({
      entryFile,
      startPoint: findRange(source, "const value = 1"),
    });

    expect(
      result.nodes.some(
        (node) =>
          path.basename(node.file) === "consumer.ts" &&
          node.kind === "read-reference" &&
          node.label === "value",
      ),
    ).toBe(true);
  });

  it("stops at an opaque property-write sink", () => {
    const relativeEntryFile = "usage/opaque-sink/main.ts";
    const entryFile = toFixturePath(relativeEntryFile);
    const source = readFixtureSource(relativeEntryFile);
    const result = createFixtureTracker(relativeEntryFile).track({
      entryFile,
      startPoint: findRange(source, "options:"),
    });

    expect(readNodes(result.nodes, "untraced-continuation")).toEqual([
      expect.objectContaining({
        continuation: expect.objectContaining({ reason: "property-write", opaque: true }),
      }),
    ]);
    expect(result.nodes.some((node) => node.label === "registerCache")).toBe(false);
  });

  it("tracks CommonJS exports through require aliases", () => {
    const relativeEntryFile = "usage/commonjs/source.js";
    const entryFile = toFixturePath(relativeEntryFile);
    const source = readFixtureSource(relativeEntryFile);
    const result = createFixtureTracker(relativeEntryFile).track({
      entryFile,
      startPoint: findRange(source, "const answer = 42"),
    });

    expect(result.nodes.some((node) => node.kind === "export-boundary")).toBe(true);
    expect(
      result.nodes.some(
        (node) => path.basename(node.file) === "consumer.js" && node.kind === "import-usage",
      ),
    ).toBe(true);
    expect(
      result.nodes.some(
        (node) =>
          path.basename(node.file) === "consumer.js" &&
          node.kind === "read-reference" &&
          node.label === "localAnswer",
      ),
    ).toBe(true);
  });

  it("agrees with backward tracking about a final call-site range", async () => {
    const relativeEntryFile = "linear-chain/main.ts";
    const entryFile = toFixturePath(relativeEntryFile);
    const source = readFixtureSource(relativeEntryFile);
    const finalCallStart = source.lastIndexOf("c(5, 6)");
    const finalCallRange: OffsetRange = { start: finalCallStart, end: finalCallStart + 1 };
    const dependencyResult = await new DependencyTracker().track({
      entryFile,
      startPoint: finalCallRange,
    });
    const cDeclaration = dependencyResult.nodes.find((node) => node.label.startsWith("function c("));

    expect(cDeclaration).toBeDefined();

    const usageResult = createFixtureTracker(relativeEntryFile).track({
      entryFile,
      startPoint: cDeclaration?.range ?? finalCallRange,
    });
    expect(usageResult.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: entryFile,
          range: finalCallRange,
          kind: "untraced-continuation",
        }),
      ]),
    );
  });

  it("assembles blank and compact virtual-file output", () => {
    const entryFile: AbsolutePath = "/virtual/entry.ts";
    const source: SourceText = "const value = 1; console.log(value); const unused = 2;";
    const tracker = new UsageTracker({ virtualFiles: { [entryFile]: source } });
    const request = { entryFile, startPoint: findRange(source, "const value = 1") };

    const blank = tracker.track({ ...request, output: { mode: "blank" } });
    const compact = tracker.track({ ...request, output: { mode: "compact" } });

    expect(blank.files.get(entryFile)?.ms.toString()).toContain("const value = 1");
    expect(blank.files.get(entryFile)?.ms.toString()).not.toContain("const unused = 2");
    expect(compact.files.get(entryFile)?.ms.toString()).toContain("console.log(value)");
    expect(compact.files.get(entryFile)?.ms.toString()).not.toContain("const unused = 2");
  });
});