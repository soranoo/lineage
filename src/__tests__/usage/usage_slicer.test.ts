import { describe, expect, it } from "vitest";

import type { AbsolutePath, ParsedFile, UsageSliceResult } from "@/types";
import type { IUsageSlicer } from "@/usage/UsageSlicer";

describe("IUsageSlicer", () => {
  it("requires the forward slice contract", () => {
    const slicer: IUsageSlicer = {
      slice: (
        _entryFile: AbsolutePath,
        _startPoint,
        _parsedFiles: Map<AbsolutePath, ParsedFile>,
      ): UsageSliceResult => ({ nodes: [], edges: [], issues: [] }),
    };

    expect(slicer.slice("/project/entry.ts", { start: 0, end: 1 }, new Map()).nodes).toEqual([]);
  });

  it("rejects an implementation that omits the slice method", () => {
    // @ts-expect-error IUsageSlicer must expose slice.
    const invalid: IUsageSlicer = {};
    expect(invalid).toEqual({});
  });
});