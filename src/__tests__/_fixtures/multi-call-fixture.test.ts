import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { AbsolutePath, OffsetRange, SourceText } from "@/types";

import { DependencyTracker } from "@/index";
import { OxcParser } from "@/parse/OxcParser";

/**
 * Absolute path to the fixture root folder.
 */
const fixturesRoot: AbsolutePath = path.resolve(process.cwd(), "src/__tests__/_fixtures");

/**
 * Build an absolute path for a fixture file.
 *
 * @param relativePath Relative fixture file path under the fixture root.
 * @returns Absolute fixture file path.
 */
const toFixturePath = (relativePath: SourceText): AbsolutePath =>
  path.resolve(fixturesRoot, relativePath);

/**
 * Read fixture source text from disk.
 *
 * @param relativePath Relative fixture file path under the fixture root.
 * @returns UTF-8 fixture source text.
 */
const readFixtureSource = (relativePath: SourceText): SourceText =>
  readFileSync(toFixturePath(relativePath), "utf8");

/**
 * Find an offset range for a required source fragment.
 *
 * @param source Source text to search.
 * @param fragment Required fragment that must exist in the source.
 * @returns Offset range spanning the first match of the fragment.
 * @throws {Error} When the fragment cannot be found.
 */
const rangeForFragment = (source: SourceText, fragment: SourceText): OffsetRange => {
  const start = source.indexOf(fragment);

  if (start < 0) {
    throw new Error(`Fragment not found: ${fragment}`);
  }

  return { start, end: start + fragment.length };
};

describe("multi-call fixture", () => {
  it("reuses parse cache across repeated calls, isolates issues, and returns independent MagicString instances", async () => {
    const parser = new OxcParser();
    const tracker = new DependencyTracker({}, { parser });

    const unresolvedPath = toFixturePath("unresolved/main.ts");
    const unresolvedSource = readFixtureSource("unresolved/main.ts");
    const firstStart = rangeForFragment(
      unresolvedSource,
      "unresolvedResult = missingTransform(value)",
    );
    const secondStart = rangeForFragment(unresolvedSource, "const value = 2;");

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
    const thirdStart = rangeForFragment(linearSource, "return b(t, e);");

    await tracker.track({ entryFile: linearPath, startPoint: thirdStart });

    expect(parser.getCache().size).toBe(2);
  });
});
