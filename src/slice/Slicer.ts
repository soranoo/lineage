import type { AbsolutePath, OffsetRange, ParsedFile, SliceResult } from "@/types";

/**
 * Runs a backward slice over parsed files.
 */
export interface ISlicer {
  /**
   * Slice dependencies backward from the provided start point.
   *
   * @param entryFile Absolute path to the entry file containing the start point.
   * @param startPoint Character offset range of the start-point node.
   * @param parsedFiles Parsed file map indexed by absolute path.
   * @returns Slice result containing dependency nodes, edges, and visited IDs.
   */
  readonly slice: (
    entryFile: AbsolutePath,
    startPoint: OffsetRange,
    parsedFiles: Map<AbsolutePath, ParsedFile>,
  ) => SliceResult;
}
