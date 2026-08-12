import type { IProjectIndex } from "@/project";
import type { AbsolutePath, ExportedName, ImporterEntry, SourceText } from "@/types";

/** Deterministic reverse-import index for forward-slicer unit tests. */
export class FakeProjectIndex implements IProjectIndex {
  private readonly entries: ReadonlyMap<SourceText, ImporterEntry[]>;

  /**
   * Create a fake project index.
   *
   * @param entries Importer entries keyed by `sourceFile:exportedName`.
   */
  constructor(entries: ReadonlyMap<SourceText, ImporterEntry[]> = new Map()) {
    this.entries = entries;
  }

  /**
   * Return configured importer entries for one source export.
   *
   * @param sourceFile Absolute path of the source module.
   * @param exportedName Exported binding to query.
   * @returns A copy of the configured importer list.
   */
  readonly findImporters = (
    sourceFile: AbsolutePath,
    exportedName: ExportedName,
  ): ImporterEntry[] =>
    [...(this.entries.get(`${sourceFile}:${exportedName}`) ?? [])];
}