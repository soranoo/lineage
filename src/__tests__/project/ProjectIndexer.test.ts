import path from "node:path";

import { describe, expect, it } from "vitest";

import { OxcParser } from "@/parse/OxcParser";
import { ImportGraph } from "@/project/ImportGraph";
import { ProjectIndexer } from "@/project/ProjectIndexer";
import { IgnoreFilter } from "@/resolve/IgnoreFilter";
import { OxcResolver } from "@/resolve/OxcResolver";
import { ProjectFileScanner } from "@/resolve/ProjectFileScanner";
import { VirtualAwareResolver } from "@/resolve/VirtualAwareResolver";
import type { AbsolutePath, ImporterEntry, SourceText, UsageTrackerConfig } from "@/types";

const fixtureRoot: AbsolutePath = path.resolve("src/__tests__/_fixtures/usage/fanout");

const createIndexer = (ignorePatterns: UsageTrackerConfig["ignorePatterns"] = []) => {
  const parser = new OxcParser();
  const ignoreFilter = new IgnoreFilter(ignorePatterns ?? []);
  const resolver = new OxcResolver(ignoreFilter, {
    extensions: [".ts", ".tsx", ".js", ".jsx"],
  });
  const scanner = new ProjectFileScanner();
  const indexer = new ProjectIndexer(parser, resolver, scanner);

  return { indexer, parser };
};

const projectImporter = (entries: ImporterEntry[], fileName: string): ImporterEntry | undefined =>
  entries.find((entry) => entry.importerFile.endsWith(fileName));

describe("ProjectIndexer", () => {
  it("indexes fan-out imports with their local aliases", () => {
    const { indexer } = createIndexer();
    const graph = indexer.index({ projectRoot: fixtureRoot });
    const importers = graph.findImporters(path.join(fixtureRoot, "a.ts"), "x");

    expect(projectImporter(importers, "one.ts")?.localAlias).toBe("first");
    expect(projectImporter(importers, "two.ts")?.localAlias).toBe("second");
    expect(projectImporter(importers, "c.ts")?.localAlias).toBe("x");
    expect(projectImporter(importers, "b.ts")?.localAlias).toBe("x");
  });

  it("records a re-export chain through the ultimate source", () => {
    const { indexer } = createIndexer();
    const graph = indexer.index({ projectRoot: fixtureRoot });
    const reExports = graph
      .findReExports(path.join(fixtureRoot, "a.ts"), "x")
      .find((entry) => entry.reExporterFile.endsWith("b.ts"));
    const importers = graph.findImporters(path.join(fixtureRoot, "a.ts"), "x");

    expect(reExports).toEqual(
      expect.objectContaining({
        importedName: "x",
        exportedName: "x",
        kind: "named",
      }),
    );
    expect(projectImporter(importers, "c.ts")?.localAlias).toBe("x");
  });

  it("parses ignored files but excludes them as visible importer results", () => {
    const { indexer, parser } = createIndexer(["ignored-barrel.ts"]);
    const graph = indexer.index({
      projectRoot: fixtureRoot,
      ignorePatterns: ["ignored-barrel.ts"],
    });
    const importers = graph.findImporters(path.join(fixtureRoot, "a.ts"), "x");

    expect(importers.map((entry) => entry.importerFile)).toEqual(
      expect.arrayContaining([expect.stringContaining("after-ignored.ts")]),
    );
    expect(importers.some((entry) => entry.importerFile.endsWith("ignored-barrel.ts"))).toBe(false);
    expect(importers.some((entry) => entry.importerFile.endsWith("after-ignored.ts"))).toBe(true);
    expect(
      [...parser.getCache().keys()].some((filePath) => filePath.endsWith("ignored-barrel.ts")),
    ).toBe(true);
  });

  it("indexes a virtual-only project without disk files", () => {
    const virtualFiles: Record<AbsolutePath, SourceText> = {
      "/virtual/a.ts": "export const value = 1;",
      "/virtual/b.ts": "import { value as alias } from './a'; export const result = alias;",
    };
    const parser = new OxcParser();
    const ignoreFilter = new IgnoreFilter([]);
    const resolver = new VirtualAwareResolver(
      virtualFiles,
      ignoreFilter,
      new OxcResolver(ignoreFilter),
    );
    const indexer = new ProjectIndexer(parser, resolver, new ProjectFileScanner());
    const graph = indexer.index({ virtualFiles });

    expect(graph.findImporters("/virtual/a.ts", "value")).toEqual([
      expect.objectContaining({
        importerFile: "/virtual/b.ts",
        localAlias: "alias",
      }),
    ]);
  });

  it("indexes CommonJS destructured imports and namespace requires", () => {
    const virtualFiles: Record<AbsolutePath, SourceText> = {
      "/virtual/source.ts": "module.exports = { value, other }; const value = 1; const other = 2;",
      "/virtual/consumer.ts":
        "const { value: alias } = require('./source'); const namespace = require('./source');",
    };
    const parser = new OxcParser();
    const ignoreFilter = new IgnoreFilter([]);
    const resolver = new VirtualAwareResolver(
      virtualFiles,
      ignoreFilter,
      new OxcResolver(ignoreFilter),
    );
    const indexer = new ProjectIndexer(parser, resolver, new ProjectFileScanner());

    const graph = indexer.index({ virtualFiles });
    const importers = graph.findImporters("/virtual/source.ts", "value");

    expect(importers).toEqual([
      expect.objectContaining({
        importerFile: "/virtual/consumer.ts",
        localAlias: "alias",
      }),
      expect.objectContaining({
        importerFile: "/virtual/consumer.ts",
        localAlias: "namespace",
      }),
    ]);
  });

  it("reuses parser cache and returns an equivalent graph on repeated indexing", () => {
    const { indexer, parser } = createIndexer();

    const first = indexer.index({ projectRoot: fixtureRoot });
    const cacheSize = parser.getCache().size;
    const second = indexer.index({ projectRoot: fixtureRoot });

    expect(parser.getCache().size).toBe(cacheSize);
    expect(second.findImporters(path.join(fixtureRoot, "a.ts"), "x")).toEqual(
      first.findImporters(path.join(fixtureRoot, "a.ts"), "x"),
    );
  });
});
