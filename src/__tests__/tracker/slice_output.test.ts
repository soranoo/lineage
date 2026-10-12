import { describe, expect, it } from "vitest";

import type {
  AbsolutePath,
  DependencyNode,
  NodeId,
  OffsetRange,
  ParsedFile,
  SourceText,
  UsageNode,
} from "@/types";
import { buildParsedFiles, findRange } from "@/__tests__/utils";
import { assembleSlicedOutput, DependencyTracker } from "@/index";

const entryFile: AbsolutePath = "/project/entry.ts";
const dependencyFile: AbsolutePath = "/project/dependency.ts";

const toNodeId = (file: AbsolutePath, range: OffsetRange): NodeId =>
  `${file}:${range.start}:${range.end}`;

const dependencyNode = (
  file: AbsolutePath,
  source: SourceText,
  fragment: SourceText,
  kind: DependencyNode["kind"],
): DependencyNode => {
  const range = findRange(source, fragment);

  return {
    id: toNodeId(file, range),
    file,
    range,
    label: fragment,
    kind,
    shaken: false,
  };
};

const usageNode = (
  file: AbsolutePath,
  source: SourceText,
  fragment: SourceText,
  kind: UsageNode["kind"],
): UsageNode => {
  const range = findRange(source, fragment);

  return {
    id: toNodeId(file, range),
    file,
    range,
    label: fragment,
    kind,
  };
};

const parseSources = (
  entries: Array<{ file: AbsolutePath; source: SourceText }>,
): Map<AbsolutePath, ParsedFile> => buildParsedFiles(entries);

const keepAllNodes = (): boolean => true;

describe("assembleSlicedOutput", () => {
  it("blanks non-kept ranges while preserving offsets", () => {
    const source = ["const kept = 1;", "const dropped = 2;"].join("\n");
    const parsedFiles = parseSources([{ file: entryFile, source }]);
    const nodes = [dependencyNode(entryFile, source, "const kept = 1;", "variable")];

    const files = assembleSlicedOutput(nodes, parsedFiles, "blank", keepAllNodes);
    const output = files.get(entryFile)?.ms.toString();

    expect(output?.startsWith("const kept = 1;")).toBe(true);
    expect(output?.slice("const kept = 1;".length).trim()).toBe("");
    expect(output?.length).toBe(source.length);
  });

  it("excises non-kept ranges in compact mode", () => {
    const source = ["const kept = 1;", "const dropped = 2;"].join("\n");
    const parsedFiles = parseSources([{ file: entryFile, source }]);
    const nodes = [dependencyNode(entryFile, source, "const kept = 1;", "variable")];

    const files = assembleSlicedOutput(nodes, parsedFiles, "compact", keepAllNodes);
    const output = files.get(entryFile)?.ms.toString();

    expect(output).toBe("const kept = 1;");
  });

  it("merges dependency and usage nodes from separate calls per file", () => {
    const entrySource = ["const retained = 1;", "const entryDrop = 2;"].join("\n");
    const dependencySource = ["const imported = 3;", "const dependencyDrop = 4;"].join("\n");
    const parsedFiles = parseSources([
      { file: entryFile, source: entrySource },
      { file: dependencyFile, source: dependencySource },
    ]);
    const nodes = [
      dependencyNode(entryFile, entrySource, "const retained = 1;", "variable"),
      usageNode(dependencyFile, dependencySource, "const imported = 3;", "read-reference"),
    ];

    const files = assembleSlicedOutput(nodes, parsedFiles, "blank", keepAllNodes);

    const entryOutput = files.get(entryFile)?.ms.toString();
    const dependencyOutput = files.get(dependencyFile)?.ms.toString();

    expect(entryOutput?.startsWith("const retained = 1;")).toBe(true);
    expect(entryOutput?.slice("const retained = 1;".length).trim()).toBe("");
    expect(dependencyOutput?.startsWith("const imported = 3;")).toBe(true);
    expect(dependencyOutput?.slice("const imported = 3;".length).trim()).toBe("");
  });

  it("emits output for a file containing only an import-usage node", () => {
    const source = 'import { value } from "./dependency";';
    const parsedFiles = parseSources([{ file: entryFile, source }]);
    const nodes = [usageNode(entryFile, source, source, "import-usage")];

    const files = assembleSlicedOutput(nodes, parsedFiles, "blank", keepAllNodes);

    expect(files.get(entryFile)?.ms.toString()).toBe(source);
  });

  it("skips output assembly when DependencyTracker output is absent", async () => {
    const source = "export const value = 1;";
    const tracker = new DependencyTracker({ virtualFiles: { [entryFile]: source } });
    const startPoint = findRange(source, "value = 1");

    const result = await tracker.track({ entryFile, startPoint });

    expect(result.files).toEqual(new Map());
  });

  it("keeps a selected nested function as the backward start point", async () => {
    const source = [
      "(() => {",
      "  var bundle = {};",
      "  bundle.modules = {",
      "    1: (module, exports, require) => {",
      "      function selected() { return require(2); }",
      "      exports.selected = selected;",
      "    },",
      "    2: () => { const unrelated = 3; },",
      "  };",
      "})();",
    ].join("\n");
    const startPoint = findRange(source, "function selected() { return require(2); }");
    const tracker = new DependencyTracker({ virtualFiles: { [entryFile]: source } });

    const result = await tracker.track({ entryFile, startPoint });

    expect(result.nodes.find((node) => node.kind === "start-point")?.range).toEqual(startPoint);
  });

  it.each(["blank", "compact"] as const)(
    "omits unrelated module properties in %s output while retaining valid syntax",
    async (mode) => {
      const source = [
        "(() => {",
        "  var bundle = {};",
        "  bundle.modules = {",
        "    1: (module, exports, require) => {",
        "      function selected() { return 1; }",
        "      exports.selected = selected;",
        "    },",
        "    2: () => { const unrelated = 3; },",
        "  };",
        "})();",
      ].join("\n");
      const parsedFiles = parseSources([{ file: entryFile, source }]);
      const nodes = [
        dependencyNode(entryFile, source, "function selected() { return 1; }", "start-point"),
      ];

      const files = assembleSlicedOutput(nodes, parsedFiles, mode, keepAllNodes);
      const output = files.get(entryFile)?.ms.toString();

      expect(output).toContain("function selected() { return 1; }");
      expect(output).toContain("1: (module, exports, require) => {");
      expect(output).not.toContain("unrelated");
      expect(output).not.toContain("2: ()");
      if (mode === "blank") {
        expect(output?.length).toBe(source.length);
      }
      expect(output).toBeDefined();
      if (output !== undefined) {
        expect(
          parseSources([{ file: entryFile, source: output }]).get(entryFile)?.ast,
        ).toBeDefined();
      }
    },
  );

  it("reports precision loss when an object table has an unsafe property", () => {
    const source =
      "bundle.modules = { 1: () => { function selected() {} }, [key()]: sideEffect() };";
    const parsedFiles = parseSources([{ file: entryFile, source }]);
    const nodes = [dependencyNode(entryFile, source, "function selected() {}", "start-point")];

    const files = assembleSlicedOutput(nodes, parsedFiles, "compact", keepAllNodes);
    const file = files.get(entryFile);

    expect(file?.ms.toString()).toContain("[key()]: sideEffect()");
    expect(file?.precisionLosses).toEqual([findRange(source, source)]);
  });

  it("retains a whole selected assignment when it overlaps a nested selection", () => {
    const source = "bundle.modules = { 1: () => { function selected() {} }, 2: () => 2 };";
    const parsedFiles = parseSources([{ file: entryFile, source }]);
    const nodes = [
      dependencyNode(entryFile, source, "function selected() {}", "start-point"),
      dependencyNode(entryFile, source, source, "variable"),
    ];

    const file = assembleSlicedOutput(nodes, parsedFiles, "compact", keepAllNodes).get(entryFile);

    expect(file?.ms.toString()).toBe(source);
    expect(file?.precisionLosses).toEqual([findRange(source, source)]);
  });

  it("tracks and assembles a nested module selection through the public API", async () => {
    const source = [
      "const bundle = {};",
      "bundle.modules = {",
      "  1: () => { function selected() { return 1; } },",
      "  2: () => { const unrelated = 3; },",
      "};",
    ].join("\n");
    const startPoint = findRange(source, "function selected() { return 1; }");
    const tracker = new DependencyTracker({ virtualFiles: { [entryFile]: source } });

    const result = await tracker.track({ entryFile, startPoint, output: { mode: "compact" } });
    const output = result.files.get(entryFile)?.ms.toString();

    expect(result.nodes.find((node) => node.kind === "start-point")?.range).toEqual(startPoint);
    expect(output).toContain("1: () => { function selected() { return 1; } }");
    expect(output).not.toContain("unrelated");
    expect(result.files.get(entryFile)?.precisionLosses).toEqual([]);
    expect(output).toBeDefined();
    if (output !== undefined) {
      expect(parseSources([{ file: entryFile, source: output }]).get(entryFile)?.ast).toBeDefined();
    }
  });
});
