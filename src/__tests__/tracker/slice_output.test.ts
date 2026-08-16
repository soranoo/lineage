import { describe, expect, it } from "vitest";

import { buildParsedFiles, findRange } from "@/__tests__/utils";
import { assembleSlicedOutput, DependencyTracker } from "@/index";
import type {
  AbsolutePath,
  DependencyNode,
  NodeId,
  OffsetRange,
  ParsedFile,
  SourceText,
  UsageNode,
} from "@/types";

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
});
