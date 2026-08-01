import { describe, expect, it } from "vitest";

import { findRange, readFixtureSource, toFixturePath } from "@/__tests__/utils";
import { DependencyTracker } from "@/index";
import { OxcParser } from "@/parse";

describe("multi-call fixture", () => {
  it("reuses parse cache across repeated calls, isolates issues, and returns independent MagicString instances", async () => {
    const parser = new OxcParser();
    const tracker = new DependencyTracker({}, { parser });

    const unresolvedPath = toFixturePath("unresolved/main.ts");
    const unresolvedSource = readFixtureSource("unresolved/main.ts");
    const firstStart = findRange(unresolvedSource, "unresolvedResult = missingTransform(value)");
    const secondStart = findRange(unresolvedSource, "const value = 2;");

    const firstResult = await tracker.track({ entryFile: unresolvedPath, startPoint: firstStart });
    const secondResult = await tracker.track({
      entryFile: unresolvedPath,
      startPoint: secondStart,
    });

    expect(parser.getCache().size).toBe(1);
    expect(firstResult.issues.some((issue) => issue.kind === "unresolved-dependency")).toBe(true);
    expect(secondResult.issues).toHaveLength(0);

    const firstSlice = firstResult.files.get(unresolvedPath);
    const secondSlice = secondResult.files.get(unresolvedPath);

    if (!firstSlice || !secondSlice) {
      throw new Error("Expected sliced unresolved fixture output in both calls.");
    }

    const secondBefore = secondSlice.ms.toString();
    firstSlice.ms.appendRight(0, "X");

    expect(secondSlice.ms.toString()).toBe(secondBefore);

    const linearPath = toFixturePath("linear-chain/main.ts");
    const linearSource = readFixtureSource("linear-chain/main.ts");
    const thirdStart = findRange(linearSource, "return b(t, e);");

    await tracker.track({ entryFile: linearPath, startPoint: thirdStart });

    expect(parser.getCache().size).toBe(2);
  });
});
