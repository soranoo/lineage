import { describe, expect, it } from "vitest";

import { ImportGraph } from "@/project/ImportGraph";
import type { AbsolutePath, ExportedName, LocalAlias } from "@/types";

const sourceFile: AbsolutePath = "/project/source.ts";
const exportedName: ExportedName = "value";

const importer = (
  importerFile: AbsolutePath,
  localAlias: LocalAlias,
  importedExport: ExportedName = exportedName,
) => ({
  kind: "import",
  importerFile,
  exportedName: importedExport,
  localAlias,
});

describe("ImportGraph", () => {
  it("records and queries a direct importer", () => {
    const graph = new ImportGraph();

    graph.addImport("/project/consumer.ts", exportedName, sourceFile, "alias");

    expect(graph.findImporters(sourceFile, exportedName)).toEqual([
      importer("/project/consumer.ts", "alias"),
    ]);
  });

  it("returns all importers of one export", () => {
    const graph = new ImportGraph();

    graph.addImport("/project/one.ts", exportedName, sourceFile, "one");
    graph.addImport("/project/two.ts", exportedName, sourceFile, "two");

    expect(graph.findImporters(sourceFile, exportedName)).toEqual([
      importer("/project/one.ts", "one"),
      importer("/project/two.ts", "two"),
    ]);
  });

  it("returns an empty array for an export with no importers", () => {
    expect(new ImportGraph().findImporters(sourceFile, exportedName)).toEqual([]);
  });

  it("preserves separate aliases for default imports", () => {
    const graph = new ImportGraph();

    graph.addImport("/project/one.ts", "default", sourceFile, "firstName");
    graph.addImport("/project/two.ts", "default", sourceFile, "secondName");

    expect(graph.findImporters(sourceFile, "default")).toEqual([
      importer("/project/one.ts", "firstName", "default"),
      importer("/project/two.ts", "secondName", "default"),
    ]);
  });

  it("follows export-star entries to eventual importers", () => {
    const graph = new ImportGraph();
    const barrelFile: AbsolutePath = "/project/barrel.ts";
    const finalFile: AbsolutePath = "/project/final.ts";

    graph.addReExport(barrelFile, sourceFile, "*", "*", "export-all");
    graph.addImport(finalFile, exportedName, barrelFile, "renamed");

    expect(graph.findImporters(sourceFile, exportedName)).toEqual([
      importer(barrelFile, exportedName),
      importer(finalFile, "renamed"),
    ]);
  });

  it("terminates when re-exports form a cycle", () => {
    const graph = new ImportGraph();
    const firstFile: AbsolutePath = "/project/a.ts";
    const secondFile: AbsolutePath = "/project/b.ts";

    graph.addReExport(firstFile, secondFile, "value", "value", "named");
    graph.addReExport(secondFile, firstFile, "value", "value", "named");

    expect(graph.findImporters(firstFile, exportedName)).toEqual([
      importer(secondFile, "value"),
      importer(firstFile, "value"),
    ]);
    expect(graph.findReExports(firstFile, exportedName)).toHaveLength(1);
  });

  it("can be used without parser or resolver dependencies", () => {
    const graph = new ImportGraph();

    graph.addImport("/project/consumer.ts", "value", sourceFile, "value");

    expect(graph.findImporters(sourceFile, "value")).toHaveLength(1);
  });
});
