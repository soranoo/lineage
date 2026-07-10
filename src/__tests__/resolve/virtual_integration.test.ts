import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import type { AbsolutePath, OffsetRange, SourceText, TrackResult } from "@/types";

import { DependencyTracker } from "@/index";

/**
 * Find a required range by source fragment.
 *
 * @param source Source text to search.
 * @param fragment Required fragment that must exist.
 * @returns Range spanning the fragment.
 */
const findRange = (source: SourceText, fragment: SourceText): OffsetRange => {
  const start = source.indexOf(fragment);

  if (start < 0) {
    throw new Error(`Fragment not found: ${fragment}`);
  }

  return { start, end: start + fragment.length };
};

/**
 * Build a map from node ID to file path.
 *
 * @param result Track result containing nodes.
 * @returns Map from node ID to absolute file.
 */
const buildNodeFileMap = (result: TrackResult): Map<SourceText, AbsolutePath> => {
  const map = new Map<SourceText, AbsolutePath>();

  for (const node of result.nodes) {
    map.set(node.id, node.file);
  }

  return map;
};

describe("VirtualAwareResolver integration", () => {
  it("resolves two virtual files with relative imports and produces cross-file edges", async () => {
    const entrySource = [
      "import { add } from './math';",
      "const left = 1;",
      "const right = 2;",
      "export const result = add(left, right);",
    ].join("\n");

    const tracker = new DependencyTracker({
      virtualFiles: {
        "/virtual/main.ts": entrySource,
        "/virtual/math.ts": "export const add = (a: number, b: number): number => a + b;",
      },
    });

    const result = await tracker.track({
      entryFile: "/virtual/main.ts",
      startPoint: findRange(entrySource, "result = add(left, right)"),
    });

    const files = new Set(result.nodes.map((node) => node.file));
    expect(files.has("/virtual/main.ts")).toBe(true);
    expect(files.has("/virtual/math.ts")).toBe(true);
    expect(result.edges.some((edge) => edge.kind === "import")).toBe(true);
  });

  it("resolves virtual imports that target a real disk file", async () => {
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
      startPoint: findRange(entrySource, "result = target"),
    });

    expect(result.nodes.some((node) => node.file === realTargetPath)).toBe(true);
  });

  it("supports mixed mode when a real entry imports a virtual module", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "lineage-virtual-mixed-"));
    const entryFile = path.join(tempDir, "entry.ts");
    const entrySource = [
      "import { sum } from '/virtual/math';",
      "export const result = sum(4, 5);",
    ].join("\n");

    writeFileSync(entryFile, entrySource, "utf8");

    try {
      const tracker = new DependencyTracker({
        virtualFiles: {
          "/virtual/math.ts": "export const sum = (a: number, b: number): number => a + b;",
        },
      });

      const result = await tracker.track({
        entryFile,
        startPoint: findRange(entrySource, "result = sum(4, 5)"),
      });

      expect(result.nodes.some((node) => node.file === entryFile)).toBe(true);
      expect(result.nodes.some((node) => node.file === "/virtual/math.ts")).toBe(true);
      expect(result.edges.some((edge) => edge.kind === "import")).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("emits unresolved-dependency for a bare import with no resolvable package", async () => {
    const entrySource = ["import { map } from 'lodash';", "export const result = map;"].join("\n");

    const tracker = new DependencyTracker({
      virtualFiles: {
        "/virtual/main.ts": entrySource,
      },
    });

    const result = await tracker.track({
      entryFile: "/virtual/main.ts",
      startPoint: findRange(entrySource, "result = map"),
    });

    expect(result.issues.some((issue) => issue.kind === "unresolved-dependency")).toBe(true);
  });

  it("follows a three-file transitive virtual import chain", async () => {
    const entrySource = ["import { doubled } from './mid';", "export const result = doubled;"].join(
      "\n",
    );

    const tracker = new DependencyTracker({
      virtualFiles: {
        "/virtual/main.ts": entrySource,
        "/virtual/mid.ts": "import { base } from './leaf'; export const doubled = base * 2;",
        "/virtual/leaf.ts": "export const base = 21;",
      },
    });

    const result = await tracker.track({
      entryFile: "/virtual/main.ts",
      startPoint: findRange(entrySource, "result = doubled"),
    });

    const files = new Set(result.nodes.map((node) => node.file));
    expect(files.has("/virtual/main.ts")).toBe(true);
    expect(files.has("/virtual/mid.ts")).toBe(true);
    expect(files.has("/virtual/leaf.ts")).toBe(true);
  });

  it("supports parent-directory virtual imports using '../'", async () => {
    const entrySource = [
      "import { sum } from '../shared/math';",
      "export const result = sum(2, 3);",
    ].join("\n");

    const tracker = new DependencyTracker({
      virtualFiles: {
        "/virtual/app/main.ts": entrySource,
        "/virtual/shared/math.ts": "export const sum = (a: number, b: number): number => a + b;",
      },
    });

    const result = await tracker.track({
      entryFile: "/virtual/app/main.ts",
      startPoint: findRange(entrySource, "result = sum(2, 3)"),
    });

    const files = new Set(result.nodes.map((node) => node.file));
    expect(files.has("/virtual/app/main.ts")).toBe(true);
    expect(files.has("/virtual/shared/math.ts")).toBe(true);
    expect(result.edges.some((edge) => edge.kind === "import")).toBe(true);
  });

  it("handles circular virtual imports without throwing and keeps cross-file back-edges", async () => {
    const entrySource = [
      "import { valueB } from './b';",
      "export const valueA = valueB + 1;",
      "export const resultA = valueA;",
    ].join("\n");

    const tracker = new DependencyTracker({
      virtualFiles: {
        "/virtual/a.ts": entrySource,
        "/virtual/b.ts": "import { valueA } from './a'; export const valueB = valueA + 1;",
      },
    });

    const result = await tracker.track({
      entryFile: "/virtual/a.ts",
      startPoint: findRange(entrySource, "resultA = valueA"),
    });

    const nodeFiles = buildNodeFileMap(result);
    const hasAtoB = result.edges.some((edge) => {
      const fromFile = nodeFiles.get(edge.from);
      const toFile = nodeFiles.get(edge.to);

      return fromFile === "/virtual/a.ts" && toFile === "/virtual/b.ts";
    });
    const hasBtoA = result.edges.some((edge) => {
      const fromFile = nodeFiles.get(edge.from);
      const toFile = nodeFiles.get(edge.to);

      return fromFile === "/virtual/b.ts" && toFile === "/virtual/a.ts";
    });

    expect(result.nodes.length).toBeGreaterThan(0);
    expect(hasAtoB).toBe(true);
    expect(hasBtoA).toBe(true);
  });
});
