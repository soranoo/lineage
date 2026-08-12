import type { AbsolutePath, OffsetRange, ParsedFile, UsageSliceResult } from "@/types";

/** Runs a direct-reference forward scan over parsed project files. */
export interface IUsageSlicer {
  /**
   * Scan usages from a declaration without following data-flow continuations.
   *
   * @param entryFile Absolute path containing the declaration.
   * @param startPoint Character range identifying the declaration.
   * @param parsedFiles Parsed files available to the scan.
   * @returns Usage graph nodes, edges, and issues.
   */
  readonly slice: (
    entryFile: AbsolutePath,
    startPoint: OffsetRange,
    parsedFiles: Map<AbsolutePath, ParsedFile>,
  ) => UsageSliceResult;
}
