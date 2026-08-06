import { describe, expect, it } from "vitest";

import { DependencyTracker } from "@/index";
import { OxcParser } from "@/parse";
import type { AbsolutePath, SourceText, TrackRequest, TrackResult } from "@/types";

const entryFile: AbsolutePath = "/project/main.js";
const source: SourceText = [
  "function compute(x) {",
  "  const log = `computing ${x}`;",
  "  console.log(log);",
  "  const doubled = x * 2;",
  "  const tripled = x * 3;",
  "  return doubled;",
  "}",
  "const result = compute(2);",
].join("\n");

const startPoint = (): TrackRequest["startPoint"] => {
  const start = source.indexOf("return doubled");

  if (start < 0) {
    throw new Error("Test start point was not found.");
  }

  return { start, end: start + "return doubled".length };
};

const createTracker = (): DependencyTracker =>
  new DependencyTracker({ virtualFiles: { [entryFile]: source } });

const track = async (request: Partial<TrackRequest>): Promise<TrackResult> => {
  const tracker = createTracker();
  return tracker.track({
    entryFile,
    startPoint: startPoint(),
    output: { mode: "blank" },
    ...request,
  });
};

const outputText = (result: TrackResult): SourceText => {
  const file = result.files.get(entryFile);

  if (file === undefined) {
    throw new Error("Expected an output file.");
  }

  return file.ms.toString();
};

describe("DependencyTracker shake opt-out", () => {
  it("keeps every statement in touched functions when shake is false", async () => {
    const result = await track({ shake: false });
    const output = outputText(result);

    expect(result.nodes.every((node) => node.shaken === false)).toBe(true);
    expect(output).toContain("const log = `computing ${x}`;");
    expect(output).toContain("console.log(log);");
    expect(output).toContain("const tripled = x * 3;");
  });

  it("preserves current behavior when shake is omitted or true", async () => {
    const omitted = await track({});
    const explicit = await track({ shake: true });

    expect(omitted.nodes).toEqual(explicit.nodes);
    expect(omitted.edges).toEqual(explicit.edges);
    expect(omitted.issues).toEqual(explicit.issues);
    expect(outputText(omitted)).toBe(outputText(explicit));
  });

  it("keeps compact output syntactically valid when shake is false", async () => {
    const result = await track({ shake: false, output: { mode: "compact" } });
    const output = outputText(result);
    const parser = new OxcParser();

    expect(() => parser.parse(entryFile, output)).not.toThrow();
  });
});