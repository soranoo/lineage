import { describe, expect, it } from "vitest";

import { findRange, readFixtureSource, toFixturePath } from "@/__tests__/utils";
import { DependencyTracker } from "@/index";
import type { AbsolutePath, OutputMode, SourceText, TrackResult } from "@/types";

/**
 * Create a whitespace-only string of the same length as the input.
 *
 * @param value Source text to normalize to spaces.
 * @returns String containing only spaces with the same length as value.
 */
const toSpaceMask = (value: SourceText): SourceText => " ".repeat(value.length);

/**
 * Run dependency tracking for a fixture file and return the sliced output.
 *
 * @param relativePath Relative fixture file path.
 * @param fragment Source fragment used for start-point lookup.
 * @param mode Output mode for the tracker.
 * @returns Track result and sliced string for entry file.
 * @throws {Error} When the entry file is missing in the tracker output.
 */
const trackOutput = async (
  relativePath: SourceText,
  fragment: SourceText,
  mode: OutputMode,
): Promise<{
  result: TrackResult;
  source: SourceText;
  output: SourceText;
  entryFile: AbsolutePath;
}> => {
  const entryFile = toFixturePath(relativePath);
  const source = readFixtureSource(relativePath);
  const startPoint = findRange(source, fragment);
  const tracker = new DependencyTracker();
  const result = await tracker.track({
    entryFile,
    startPoint,
    output: { mode },
  });

  const sliced = result.files.get(entryFile);

  if (!sliced) {
    throw new Error(`Missing sliced output for ${entryFile}`);
  }

  return { result, source, output: sliced.ms.toString(), entryFile };
};

describe("slice output fixtures", () => {
  it("Ex. 1 blank mode blanks result assignment, keeps dependency lines, and preserves length", async () => {
    const tracked = await trackOutput("linear-chain/main.ts", "return b(t, e);", "blank");

    expect(tracked.output.length).toBe(tracked.source.length);

    const resultLine = "const result = c(5, 6);";
    expect(tracked.output).toContain(toSpaceMask(resultLine));
    expect(tracked.output).toContain("const globalA = 0;");
    expect(tracked.output).toContain("return b(t, e);");
  });

  it("Ex. 2 blank mode blanks log, console.log, and tripled while keeping doubled and return", async () => {
    const tracked = await trackOutput("intra-shake/main.ts", "return doubled;", "blank");

    const logLine = "  const log = `computing ${x}`;";
    const consoleLine = "  console.log(log);";
    const tripledLine = "  const tripled = x * 3;";

    expect(tracked.output).toContain(toSpaceMask(logLine));
    expect(tracked.output).toContain(toSpaceMask(consoleLine));
    expect(tracked.output).toContain(toSpaceMask(tripledLine));
    expect(tracked.output).toContain("  const doubled = x * 2;");
    expect(tracked.output).toContain("  return doubled;");
  });

  it("Ex. 3 blank mode blanks unrelated declaration", async () => {
    const tracked = await trackOutput(
      "linear-chain/variable-declaration.ts",
      "result = base * multiplier",
      "blank",
    );

    const unrelatedLine = "const unrelated = 99;";

    expect(tracked.output).toContain(toSpaceMask(unrelatedLine));
    expect(tracked.output).toContain("const base = 10;");
    expect(tracked.output).toContain("const multiplier = 3;");
  });

  it("Ex. 5 blank mode blanks multiply in math.ts for add-only slice", async () => {
    const tracked = await trackOutput("cross-file/main.ts", "result = add(x, y)", "blank");
    const mathPath = toFixturePath("cross-file/math.ts");
    const mathSlice = tracked.result.files.get(mathPath);

    if (!mathSlice) {
      throw new Error("Expected cross-file math.ts output to exist.");
    }

    const mathOutput = mathSlice.ms.toString();
    const multiplyLine = "export const multiply = (a: number, b: number): number => a * b;";

    expect(mathOutput).toContain(toSpaceMask(multiplyLine));
    expect(mathOutput).toContain("export const add = (a: number, b: number): number => a + b;");
  });

  it("Ex. 1 compact mode is shorter and avoids large blank-line gaps", async () => {
    const tracked = await trackOutput("linear-chain/main.ts", "return b(t, e);", "compact");

    expect(tracked.output.length).toBeLessThan(tracked.source.length);
    expect(tracked.output).toContain("const globalA = 0;");
    expect(tracked.output).toContain("return b(t, e);");
    expect(tracked.output).not.toMatch(/\n{3,}/);
  });
});
