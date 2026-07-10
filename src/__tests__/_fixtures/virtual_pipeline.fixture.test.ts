import path from "node:path";

import { describe, expect, it } from "vitest";

import type { AbsolutePath, OffsetRange, SourceText } from "@/types";

import { DependencyTracker } from "@/index";

/**
 * Build an offset range for a required source fragment.
 *
 * @param source Source text to search.
 * @param fragment Required fragment text.
 * @returns Offset range spanning the fragment.
 */
const rangeForFragment = (source: SourceText, fragment: SourceText): OffsetRange => {
  const start = source.indexOf(fragment);

  if (start < 0) {
    throw new Error(`Fragment not found: ${fragment}`);
  }

  return { start, end: start + fragment.length };
};

describe("virtual pipeline fixtures", () => {
  it("matches linear chain behavior in virtual mode", async () => {
    const entrySource = [
      "const globalA = 0;",
      "export const a = (b: number, c: number): number => c + 2 * b + globalA;",
      "export const b = (c: number, d: number): number => a(c, d);",
      "export const c = (d: number, e: number): number => {",
      "  const t = d + 5;",
      "  return b(t, e);",
      "};",
      "export const result = c(5, 6);",
    ].join("\n");

    const tracker = new DependencyTracker({
      virtualFiles: {
        "/virtual/main.ts": entrySource,
      },
    });

    const result = await tracker.track({
      entryFile: "/virtual/main.ts",
      startPoint: rangeForFragment(entrySource, "return b(t, e);"),
    });

    expect(result.nodes.length).toBeGreaterThanOrEqual(7);
    expect(result.edges.some((edge) => edge.kind === "call")).toBe(true);
    expect(result.edges.some((edge) => edge.kind === "param-bind")).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("preserves intra-function shaking behavior in virtual mode", async () => {
    const entrySource = [
      "const base = 4;",
      "export const compute = (x: number): number => {",
      "  const doubled = x * 2;",
      "  const log = 'debug';",
      "  console.log(log);",
      "  const tripled = x * 3;",
      "  return doubled + base;",
      "};",
      "export const result = compute(10);",
    ].join("\n");

    const tracker = new DependencyTracker({
      virtualFiles: {
        "/virtual/main.ts": entrySource,
      },
    });

    const result = await tracker.track({
      entryFile: "/virtual/main.ts",
      startPoint: rangeForFragment(entrySource, "result = compute(10)"),
    });

    const shakenCount = result.nodes.filter((node) => node.shaken).length;
    expect(shakenCount).toBe(3);
  });

  it("supports cross-virtual imports and re-export chains", async () => {
    const entrySource = "import { format } from './index'; export const result = format(' hello ');";

    const tracker = new DependencyTracker({
      virtualFiles: {
        "/virtual/main.ts": entrySource,
        "/virtual/index.ts": "export { format } from './utils';",
        "/virtual/utils.ts":
          "export const format = (value: string): string => value.trim().toUpperCase();",
      },
    });

    const result = await tracker.track({
      entryFile: "/virtual/main.ts",
      startPoint: rangeForFragment(entrySource, "result = format(' hello ')"),
    });

    expect(result.nodes.some((node) => node.kind === "re-export")).toBe(true);
    expect(result.edges.some((edge) => edge.kind === "import")).toBe(true);
    expect(result.nodes.some((node) => node.file === "/virtual/utils.ts")).toBe(true);
  });

  it("combines virtual entry files with real disk imports", async () => {
    const realTargetPath: AbsolutePath = path.resolve(
      process.cwd(),
      "src/__tests__/_fixtures/resolve/target.ts",
    );
    const realTargetSpecifier = realTargetPath.replaceAll("\\", "/");
    const entrySource = [
      `import { target } from '${realTargetSpecifier}';`,
      "export const result = target;",
    ].join("\n");

    const tracker = new DependencyTracker({
      virtualFiles: {
        "/virtual/main.ts": entrySource,
      },
    });

    const result = await tracker.track({
      entryFile: "/virtual/main.ts",
      startPoint: rangeForFragment(entrySource, "result = target"),
    });

    expect(result.nodes.some((node) => node.file === "/virtual/main.ts")).toBe(true);
    expect(result.nodes.some((node) => node.file === realTargetPath)).toBe(true);
  });

  it("produces correct blank and compact slices for virtual entries", async () => {
    const entrySource = [
      "const used = 1;",
      "const dropped = 2;",
      "export const result = used;",
    ].join("\n");

    const tracker = new DependencyTracker({
      virtualFiles: {
        "/virtual/main.ts": entrySource,
      },
    });
    const startPoint = rangeForFragment(entrySource, "result = used");

    const blankResult = await tracker.track({
      entryFile: "/virtual/main.ts",
      startPoint,
      output: { mode: "blank" },
    });
    const compactResult = await tracker.track({
      entryFile: "/virtual/main.ts",
      startPoint,
      output: { mode: "compact" },
    });

    const blankOutput = blankResult.files.get("/virtual/main.ts")?.ms.toString();
    const compactOutput = compactResult.files.get("/virtual/main.ts")?.ms.toString();

    if (blankOutput === undefined || compactOutput === undefined) {
      throw new Error("Expected virtual entry output for both modes.");
    }

    expect(blankOutput.length).toBe(entrySource.length);
    expect(compactOutput.length).toBeLessThan(entrySource.length);
  });
});