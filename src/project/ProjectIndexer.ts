import { readFileSync } from "node:fs";

import type {
  ExportNamedDeclaration,
  ExportSpecifier,
  ImportDeclarationSpecifier,
  ModuleExportName,
} from "@oxc-project/types";
import { assertNever } from "assert-never";

import type { IParser } from "@/parse";
import { ImportGraph } from "@/project/ImportGraph";
import type { IResolver } from "@/resolve";
import { IgnoreFilter } from "@/resolve/IgnoreFilter";
import type { ProjectFileScanner } from "@/resolve/ProjectFileScanner";
import type {
  AbsolutePath,
  ExportedName,
  ImporterEntry,
  ModuleSpecifier,
  ParsedFile,
  ProjectScanConfig,
  ReExportKind,
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

    for (const filePath of files) {
      const parsedFile = this.parseFile(filePath, config.virtualFiles);
      const visible = ignoreFilter.match(filePath) === null;
      this.indexModule(parsedFile, visible, graph);
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
  ): void => {
    for (const statement of parsedFile.ast.body) {
      switch (statement.type) {
        case "ImportDeclaration":
          this.indexImport(statement, parsedFile.absolutePath, visible, graph);
          break;
        case "ExportNamedDeclaration":
          this.indexNamedExport(statement, parsedFile.absolutePath, visible, graph);
          break;
        case "ExportAllDeclaration":
          this.indexExportAll(statement, parsedFile.absolutePath, visible, graph);
          break;
        default:
          break;
      }
    }
  };

  /** Index each local binding introduced by an import declaration. */
  private readonly indexImport = (
    statement: Extract<ParsedFile["ast"]["body"][number], { type: "ImportDeclaration" }>,
    importerFile: AbsolutePath,
    visible: boolean,
    graph: ImportGraph,
  ): void => {
    for (const specifier of statement.specifiers) {
      const importedName = this.importedName(specifier);
      this.addResolvedImport(
        statement.source.value,
        importerFile,
        importedName,
        specifier.local.name,
        visible,
        graph,
      );
    }
  };

  /** Index named re-exports that point at another module. */
  private readonly indexNamedExport = (
    statement: ExportNamedDeclaration,
    reExporterFile: AbsolutePath,
    visible: boolean,
    graph: ImportGraph,
  ): void => {
    if (statement.source === null) {
      return;
    }

    for (const specifier of statement.specifiers) {
      const importedName = this.moduleExportName(specifier.local);
      const exportedName = this.moduleExportName(specifier.exported);
      const kind: ReExportKind =
        importedName === "default" || exportedName === "default" ? "default" : "named";
      this.addResolvedReExport(
        statement.source.value,
        reExporterFile,
        importedName,
        exportedName,
        kind,
        visible,
        graph,
      );
    }
  };

  /** Index plain and namespace export-star declarations. */
  private readonly indexExportAll = (
    statement: Extract<ParsedFile["ast"]["body"][number], { type: "ExportAllDeclaration" }>,
    reExporterFile: AbsolutePath,
    visible: boolean,
    graph: ImportGraph,
  ): void => {
    const exportedName =
      statement.exported === null ? "*" : this.moduleExportName(statement.exported);
    const kind: ReExportKind = statement.exported === null ? "export-all" : "namespace";
    this.addResolvedReExport(
      statement.source.value,
      reExporterFile,
      "*",
      exportedName,
      kind,
      visible,
      graph,
    );
  };

  /** Resolve and add an ordinary import edge. */
  private readonly addResolvedImport = (
    specifier: ModuleSpecifier,
    importerFile: AbsolutePath,
    exportedName: ExportedName,
    localAlias: SourceText,
    visible: boolean,
    graph: ImportGraph,
  ): void => {
    const resolution = this.resolver.resolve(specifier, importerFile);

    switch (resolution.kind) {
      case "resolved":
        graph.addImport(importerFile, exportedName, resolution.absolutePath, localAlias, visible);
        break;
      case "ignored":
        graph.addImport(importerFile, exportedName, resolution.absolutePath, localAlias, visible);
        break;
      case "failed":
        break;
      default:
        assertNever(resolution);
    }
  };

  /** Resolve and add a re-export edge. */
  private readonly addResolvedReExport = (
    specifier: ModuleSpecifier,
    reExporterFile: AbsolutePath,
    importedName: ExportedName,
    exportedName: ExportedName,
    kind: ReExportKind,
    visible: boolean,
    graph: ImportGraph,
  ): void => {
    const resolution = this.resolver.resolve(specifier, reExporterFile);

    switch (resolution.kind) {
      case "resolved":
        graph.addReExport(
          reExporterFile,
          resolution.absolutePath,
          importedName,
          exportedName,
          kind,
          visible,
        );
        break;
      case "ignored":
        graph.addReExport(
          reExporterFile,
          resolution.absolutePath,
          importedName,
          exportedName,
          kind,
          visible,
        );
        break;
      case "failed":
        break;
      default:
        assertNever(resolution);
    }
  };

  /** Return the exported name requested by one import specifier. */
  private readonly importedName = (specifier: ImportDeclarationSpecifier): ExportedName => {
    switch (specifier.type) {
      case "ImportSpecifier":
        return this.moduleExportName(specifier.imported);
      case "ImportDefaultSpecifier":
        return "default";
      case "ImportNamespaceSpecifier":
        return "*";
      default:
        return assertNever(specifier);
    }
  };

  /** Convert an OXC module export name into its string key. */
  private readonly moduleExportName = (name: ModuleExportName): ExportedName => {
    switch (name.type) {
      case "Identifier":
        return name.name;
      case "Literal":
        if (typeof name.value === "string") {
          return name.value;
        }
        throw new TypeError("Module export name literal must be a string.");
      default:
        return assertNever(name);
    }
  };

  /** Build a stable key from the scanned paths and virtual source contents. */
  private readonly createCacheKey = (
    files: AbsolutePath[],
    virtualFiles?: Record<AbsolutePath, SourceText>,
  ): SourceText =>
    JSON.stringify({ files, virtualFiles: Object.entries(virtualFiles ?? {}).sort() });
}
