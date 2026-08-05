import { readFileSync } from "node:fs";

import { assertNever } from "assert-never";

import { collectExports, collectImports, collectSpecifiers } from "@/helpers/module-boundary";
import type { IParser } from "@/parse";
import { ImportGraph } from "@/project/ImportGraph";
import type { IResolver } from "@/resolve";
import { IgnoreFilter } from "@/resolve/IgnoreFilter";
import type { ProjectFileScanner } from "@/resolve/ProjectFileScanner";
import type {
  AbsolutePath,
  ExportedBinding,
  ExportedName,
  ModuleBoundaryImport,
  ParsedFile,
  ProjectScanConfig,
  SourceText,
  UsageTrackerConfig,
} from "@/types";

/**
 * Builds a cacheable reverse-import graph from a bounded project file set.
 *
 * Parsing and resolution are injected so the indexer remains usable with real
 * files, virtual files, or deterministic test doubles.
 */
export class ProjectIndexer {
  private readonly parser: IParser;
  private readonly resolver: IResolver;
  private readonly scanner: ProjectFileScanner;
  private readonly graphCache: Map<SourceText, ImportGraph>;

  /**
   * Create a project indexer with parser, resolver, and file-scanner services.
   *
   * @param parser Parser used to parse each candidate file.
   * @param resolver Resolver used for ESM module specifiers.
   * @param scanner Scanner used to enumerate bounded project files.
   */
  constructor(parser: IParser, resolver: IResolver, scanner: ProjectFileScanner) {
    this.parser = parser;
    this.resolver = resolver;
    this.scanner = scanner;
    this.graphCache = new Map();
  }

  /**
   * Index all configured project files and return the reverse-import graph.
   *
   * @param config Usage configuration containing project bounds and virtual sources.
   * @returns A cached or newly built reverse-import graph.
   */
  readonly index = (config: UsageTrackerConfig): ImportGraph => {
    const scanConfig: ProjectScanConfig = {
      projectRoot: config.projectRoot,
      projectFiles: config.projectFiles,
      virtualFiles: config.virtualFiles,
    };
    const files = this.scanner.scanAll(scanConfig);
    const cacheKey = this.createCacheKey(files, config.virtualFiles);
    const cached = this.graphCache.get(cacheKey);

    if (cached !== undefined) {
      return cached;
    }

    const graph = new ImportGraph();
    const ignoreFilter = new IgnoreFilter(config.ignorePatterns ?? []);
    const parsedFiles = new Map<AbsolutePath, ParsedFile>();
    const exportsByFile = new Map<AbsolutePath, ExportedBinding[]>();

    for (const filePath of files) {
      const parsedFile = this.parseFile(filePath, config.virtualFiles);
      parsedFiles.set(filePath, parsedFile);
      exportsByFile.set(filePath, collectExports(parsedFile.ast));
    }

    for (const [filePath, parsedFile] of parsedFiles) {
      const visible = ignoreFilter.match(filePath) === null;
      this.indexModule(parsedFile, visible, graph, exportsByFile);
    }

    this.graphCache.set(cacheKey, graph);
    return graph;
  };

  /** Parse a virtual source or read and parse a real file. */
  private readonly parseFile = (
    filePath: AbsolutePath,
    virtualFiles?: Record<AbsolutePath, SourceText>,
  ): ParsedFile => {
    const virtualSource = virtualFiles?.[filePath];
    const source = virtualSource ?? readFileSync(filePath, "utf8");
    return this.parser.parse(filePath, source);
  };

  /** Index the module-boundary statements in one parsed file. */
  private readonly indexModule = (
    parsedFile: ParsedFile,
    visible: boolean,
    graph: ImportGraph,
    exportsByFile: ReadonlyMap<AbsolutePath, ExportedBinding[]>,
  ): void => {
    const imports = collectImports(parsedFile.ast);
    for (const specifier of collectSpecifiers(parsedFile.ast)) {
      const resolution = this.resolver.resolve(specifier, parsedFile.absolutePath);
      const matchingImports = imports.filter((entry) => entry.specifier === specifier);

      switch (resolution.kind) {
        case "resolved":
        case "ignored":
          for (const entry of matchingImports) {
            switch (entry.kind) {
              case "import":
                this.addImportEntries(
                  parsedFile.absolutePath,
                  entry,
                  resolution.absolutePath,
                  visible,
                  graph,
                  exportsByFile,
                );
                break;
              case "re-export":
                this.addReExportEntry(
                  parsedFile.absolutePath,
                  entry,
                  resolution.absolutePath,
                  visible,
                  graph,
                );
                break;
              default:
                assertNever(entry.kind);
            }
          }
          break;
        case "failed":
          break;
        default:
          assertNever(resolution);
      }
    }
  };

  /** Index an ordinary import, expanding known namespace exports. */
  private readonly addImportEntries = (
    importerFile: AbsolutePath,
    entry: ModuleBoundaryImport,
    sourceFile: AbsolutePath,
    visible: boolean,
    graph: ImportGraph,
    exportsByFile: ReadonlyMap<AbsolutePath, ExportedBinding[]>,
  ): void => {
    const exportedNames =
      entry.importedName === "*"
        ? this.namespaceExportNames(sourceFile, exportsByFile)
        : [entry.importedName];

    for (const exportedName of exportedNames) {
      graph.addImport(importerFile, exportedName, sourceFile, entry.localAlias, visible);
    }
  };

  /** Index one re-export that points at another module. */
  private readonly addReExportEntry = (
    reExporterFile: AbsolutePath,
    entry: ModuleBoundaryImport,
    sourceFile: AbsolutePath,
    visible: boolean,
    graph: ImportGraph,
  ): void => {
    if (entry.exportedName === undefined || entry.reExportKind === undefined) {
      return;
    }

    graph.addReExport(
      reExporterFile,
      sourceFile,
      entry.importedName,
      entry.exportedName,
      entry.reExportKind,
      visible,
    );
  };

  /** Resolve known names for a namespace import, or preserve its wildcard. */
  private readonly namespaceExportNames = (
    sourceFile: AbsolutePath,
    exportsByFile: ReadonlyMap<AbsolutePath, ExportedBinding[]>,
  ): ExportedName[] => {
    const names = (exportsByFile.get(sourceFile) ?? [])
      .filter((binding) => binding.source === undefined && binding.exportedName !== "*")
      .map((binding) => binding.exportedName);
    return names.length > 0 ? [...new Set(names)] : ["*"];
  };

  /** Build a stable key from the scanned paths and virtual source contents. */
  private readonly createCacheKey = (
    files: AbsolutePath[],
    virtualFiles?: Record<AbsolutePath, SourceText>,
  ): SourceText =>
    JSON.stringify({ files, virtualFiles: Object.entries(virtualFiles ?? {}).sort() });
}
