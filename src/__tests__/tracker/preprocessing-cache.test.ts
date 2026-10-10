import { DependencyTracker } from "@/tracker/DependencyTracker";
import type { ModuleResolutionPlugin } from "@/types";
import { expect, test } from "vitest";

test("reuses module discovery and file issues while replaying independent issues for each selection", async () => {
  const file = "/cache/page.js";
  const source =
    'import {base} from "./base.js";const value=base[unknownKey];const one=value;const two=value;';
  const sources = { [file]: source, "/cache/base.js": 'export const base={known:"class"};' };
  const tracker = new DependencyTracker({ virtualFiles: sources });
  const cold = new DependencyTracker({
    virtualFiles: sources,
    preprocessingCache: { maxEntries: 0 },
  });
  for (const needle of ["one=value", "two=value", "one=value"]) {
    const start = source.indexOf(needle) + needle.indexOf("=") + 1;
    const request = { entryFile: file, startPoint: { start, end: start + 5 }, shake: false };
    const result = await tracker.track(request);
    expect(result).toEqual(await cold.track(request));
    expect(result.issues.some((issue) => issue.kind === "computed-property")).toBe(true);
    for (const issue of result.issues) {
      issue.message = "mutated";
      issue.range.start = 0;
    }
  }
  expect(tracker.getPreprocessingCacheStats()).toMatchObject({ hits: 4, misses: 2, entries: 2 });
  expect(cold.getPreprocessingCacheStats()).toMatchObject({ hits: 0, misses: 6, entries: 0 });
});

test("caches module plugin decisions and keeps cyclic and failed module boundaries intact", async () => {
  let calls = 0;
  const plugin: ModuleResolutionPlugin = {
    name: "fixture",
    tryResolve: ({ calleeText }) => {
      calls++;
      return calleeText === "load" ? { specifier: "./dependency.js" } : null;
    },
  };
  const file = "/cache/entry.js";
  const source = 'import "./missing.js";const dependency=load(1);const selected=dependency.value;';
  const tracker = new DependencyTracker({
    virtualFiles: {
      [file]: source,
      "/cache/dependency.js": 'import "./entry.js";export const value="class";',
    },
    moduleResolutionPlugins: [plugin],
  });
  const start = source.indexOf("dependency.value");
  const request = {
    entryFile: file,
    startPoint: { start, end: start + "dependency.value".length },
    shake: false,
  };
  const first = await tracker.track(request);
  const previousCalls = calls;
  expect(previousCalls).toBeGreaterThan(0);
  expect(await tracker.track(request)).toEqual(first);
  expect(calls).toBe(previousCalls);
});

test("bounded preprocessing retention evicts old files and keeps results correct", async () => {
  const source = 'import {value} from "./other.js";const selected=value;';
  const file = "/cache/main.js";
  const tracker = new DependencyTracker({
    virtualFiles: {
      [file]: source,
      "/cache/other.js": 'export const value="known";',
    },
    preprocessingCache: { maxEntries: 1 },
  });
  const start = source.lastIndexOf("value");
  const request = { entryFile: file, startPoint: { start, end: start + 5 }, shake: false };
  expect(await tracker.track(request)).toEqual(await tracker.track(request));
  expect(tracker.getPreprocessingCacheStats()).toMatchObject({ entries: 1, evictions: 3 });
});
