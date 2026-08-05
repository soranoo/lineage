import { assertNever } from "assert-never";

import type {
  AbsolutePath,
  ExportedName,
  ImporterEntry,
  LocalAlias,
  ReExportEntry,
  ReExportKind,
} from "@/types";

const EXPORT_ALL: ExportedName = "*";

const canonicalPath = (filePath: AbsolutePath): AbsolutePath => {
  if (filePath.length > 1 && filePath[1] === ":") {
    return `${filePath[0]?.toUpperCase() ?? ""}${filePath.slice(1)}`;
  }

  return filePath;
};

/**
 * Plain reverse-import data structure for project-wide usage queries.
 *
 * This class deliberately has no parser or resolver dependency. Callers add
 * resolved edges, then query direct and transitive importers by source export.
 */
export class ImportGraph {
  private readonly imports: Map<AbsolutePath, Map<ExportedName, ImporterEntry[]>>;
  private readonly reExports: Map<AbsolutePath, ReExportEntry[]>;
  private readonly hiddenImports: Set<string>;
  private readonly hiddenReExports: Set<string>;

  /** Create an empty reverse-import graph. */
  constructor() {
    this.imports = new Map();
    this.reExports = new Map();
    this.hiddenImports = new Set();
    this.hiddenReExports = new Set();
  }

  /**
   * Record a direct import of one exported binding.
   *
   * @param importerFile Absolute path of the importing file.
   * @param exportedName Name requested from the source module.
   * @param sourceFile Absolute path of the source module.
   * @param localAlias Local binding introduced by the import.
   * @param visible Whether this importer should appear in query results.
   */
  readonly addImport = (
    importerFile: AbsolutePath,
    exportedName: ExportedName,
    sourceFile: AbsolutePath,
    localAlias: LocalAlias,
    visible = true,
  ): void => {
    const canonicalImporter = canonicalPath(importerFile);
    const canonicalSource = canonicalPath(sourceFile);
    const byExport = this.imports.get(canonicalSource) ?? new Map<ExportedName, ImporterEntry[]>();
    const entries = byExport.get(exportedName) ?? [];
    const entry: ImporterEntry = {
      kind: "import",
      importerFile: canonicalImporter,
      exportedName,
      localAlias,
    };

    if (!entries.some((existing) => this.sameImport(existing, entry))) {
      entries.push(entry);
    }

    byExport.set(exportedName, entries);
    this.imports.set(canonicalSource, byExport);

    if (!visible) {
      this.hiddenImports.add(this.importKey(canonicalSource, entry));
    }
  };

  /**
   * Record a direct re-export edge.
   *
   * @param reExporterFile Absolute path of the exposing module.
   * @param sourceFile Absolute path of the source module.
   * @param importedName Name requested from the source, or `*` for export-all.
   * @param exportedName Name exposed by the re-exporting module.
   * @param kind Re-export syntax classification.
   * @param visible Whether the re-exporting file should appear in results.
   */
  readonly addReExport = (
    reExporterFile: AbsolutePath,
    sourceFile: AbsolutePath,
    importedName: ExportedName,
    exportedName: ExportedName,
    kind: ReExportKind,
    visible = true,
  ): void => {
    const canonicalReExporter = canonicalPath(reExporterFile);
    const canonicalSource = canonicalPath(sourceFile);
    const entries = this.reExports.get(canonicalSource) ?? [];
    const entry: ReExportEntry = {
      kind,
      reExporterFile: canonicalReExporter,
      sourceFile: canonicalSource,
      importedName,
      exportedName,
    };

    if (!entries.some((existing) => this.sameReExport(existing, entry))) {
      entries.push(entry);
    }

    this.reExports.set(canonicalSource, entries);

    if (!visible) {
      this.hiddenReExports.add(this.reExportKey(entry));
    }
  };

  /**
   * Find direct and transitive importers of an exported binding.
   *
   * Re-exporting modules are included as intermediate importer entries. A
   * visited source/export key prevents re-export cycles from recursing forever.
   *
   * @param sourceFile Absolute path of the source module.
   * @param exportedName Exported binding to query.
   * @returns Importers in graph insertion/traversal order.
   */
  readonly findImporters = (
    sourceFile: AbsolutePath,
    exportedName: ExportedName,
  ): ImporterEntry[] => {
    const result: ImporterEntry[] = [];
    const seenQueries = new Set<string>();
    const seenEntries = new Set<string>();
    this.collectImporters(
      canonicalPath(sourceFile),
      exportedName,
      seenQueries,
      seenEntries,
      result,
    );
    return result;
  };

  /**
   * Find direct re-export edges that expose a source export.
   *
   * @param sourceFile Absolute path of the source module.
   * @param exportedName Exported binding to query.
   * @returns Matching re-export entries.
   */
  readonly findReExports = (
    sourceFile: AbsolutePath,
    exportedName: ExportedName,
  ): ReExportEntry[] => {
    return (this.reExports.get(canonicalPath(sourceFile)) ?? []).filter((entry) =>
      this.reExportMatches(entry, exportedName),
    );
  };

  /** Collect importer entries recursively through re-export edges. */
  private readonly collectImporters = (
    sourceFile: AbsolutePath,
    exportedName: ExportedName,
    seenQueries: Set<string>,
    seenEntries: Set<string>,
    result: ImporterEntry[],
  ): void => {
    const queryKey = `${sourceFile}\u0000${exportedName}`;
    if (seenQueries.has(queryKey)) {
      return;
    }
    seenQueries.add(queryKey);

    const directEntries = [
      ...(this.imports.get(sourceFile)?.get(exportedName) ?? []),
      ...(this.imports.get(sourceFile)?.get(EXPORT_ALL) ?? []),
    ];
    for (const entry of directEntries) {
      if (!this.hiddenImports.has(this.importKey(sourceFile, entry))) {
        this.appendImporter(entry, seenEntries, result);
      }
    }

    for (const reExport of this.findReExports(sourceFile, exportedName)) {
      const nextName = this.reExportedName(reExport, exportedName);
      const intermediate: ImporterEntry = {
        kind: "import",
        importerFile: reExport.reExporterFile,
        exportedName: nextName,
        localAlias: nextName,
      };
      if (!this.hiddenReExports.has(this.reExportKey(reExport))) {
        this.appendImporter(intermediate, seenEntries, result);
      }
      this.collectImporters(reExport.reExporterFile, nextName, seenQueries, seenEntries, result);
    }
  };

  /** Append a result entry once while preserving insertion order. */
  private readonly appendImporter = (
    entry: ImporterEntry,
    seenEntries: Set<string>,
    result: ImporterEntry[],
  ): void => {
    const key = `${entry.importerFile}\u0000${entry.exportedName}\u0000${entry.localAlias}`;
    if (!seenEntries.has(key)) {
      seenEntries.add(key);
      result.push(entry);
    }
  };

  /** Determine whether a re-export applies to a queried source export. */
  private readonly reExportMatches = (
    entry: ReExportEntry,
    exportedName: ExportedName,
  ): boolean => {
    switch (entry.kind) {
      case "named":
      case "default":
        return entry.importedName === exportedName;
      case "namespace":
        return entry.importedName === exportedName || entry.importedName === EXPORT_ALL;
      case "export-all":
        return true;
      default:
        return assertNever(entry.kind);
    }
  };

  /** Resolve the name exposed by a matching re-export edge. */
  private readonly reExportedName = (
    entry: ReExportEntry,
    queriedName: ExportedName,
  ): ExportedName => {
    switch (entry.kind) {
      case "named":
      case "default":
      case "namespace":
        return entry.exportedName;
      case "export-all":
        return queriedName;
      default:
        return assertNever(entry.kind);
    }
  };

  /** Compare direct importer entries by their complete identity. */
  private readonly sameImport = (left: ImporterEntry, right: ImporterEntry): boolean =>
    left.importerFile === right.importerFile &&
    left.exportedName === right.exportedName &&
    left.localAlias === right.localAlias;

  /** Compare re-export entries by their complete identity. */
  private readonly sameReExport = (left: ReExportEntry, right: ReExportEntry): boolean =>
    left.kind === right.kind &&
    left.reExporterFile === right.reExporterFile &&
    left.sourceFile === right.sourceFile &&
    left.importedName === right.importedName &&
    left.exportedName === right.exportedName;

  /** Build a stable identity for a direct importer edge. */
  private readonly importKey = (sourceFile: AbsolutePath, entry: ImporterEntry): string =>
    `${sourceFile}\u0000${entry.importerFile}\u0000${entry.exportedName}\u0000${entry.localAlias}`;

  /** Build a stable identity for a re-export edge. */
  private readonly reExportKey = (entry: ReExportEntry): string =>
    `${entry.sourceFile}\u0000${entry.reExporterFile}\u0000${entry.kind}\u0000${entry.importedName}\u0000${entry.exportedName}`;
}
