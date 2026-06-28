import { describe, expect, it } from "vitest";

import type { ISlicer } from "@/slice/Slicer";
import type { AbsolutePath, OffsetRange, ParsedFile, SliceResult } from "@/types";

/**
 * Minimal slicer implementation used for interface checks.
 */
class ValidSlicer implements ISlicer {
  /**
   * Returns an empty slice result for tests.
   *
   * @param _entryFile Entry file path.
   * @param _startPoint Start point range.
   * @param _parsedFiles Parsed file map.
   * @returns Empty slice result.
   */
  readonly slice = (
    _entryFile: AbsolutePath,
    _startPoint: OffsetRange,
    _parsedFiles: Map<AbsolutePath, ParsedFile>,
  ): SliceResult => ({
    nodes: [],
    edges: [],
    visitedRanges: new Set(),
  });
}

/**
 * Slicer missing slice method for compile-time checks.
 */
// @ts-expect-error Missing slice method.
class MissingSlice implements ISlicer {}

describe("ISlicer", () => {
  it("accepts a valid implementation", () => {
    const slicer = new ValidSlicer();
    const result = slicer.slice("/project/src/entry.ts", { start: 0, end: 0 }, new Map());

    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(result.visitedRanges.size).toBe(0);
  });
});
