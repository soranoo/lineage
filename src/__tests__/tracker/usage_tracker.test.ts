import path from "node:path";

import { describe, expect, it } from "vitest";

import { ProjectContext, UsageTracker } from "@/index";
import { findRange, readFixtureSource, toFixturePath } from "@/__tests__/utils";
import type { AbsolutePath, SourceText, UsageTrackerConfig } from "@/types";
import { StartPointNotFoundError } from "@/types";

const entryFile: AbsolutePath = "/virtual/entry.ts";
const source: SourceText = "export const value = 1; console.log(value);";

const createConfig = (entrySource: SourceText = source): UsageTrackerConfig => ({
  virtualFiles: {
    [entryFile]: entrySource,
  },
});

describe("UsageTracker", () => {
  it("indexes a bounded project root during construction", () => {
    const entryFile = toFixturePath("usage/fanout/a.ts");
    const entrySource = readFixtureSource("usage/fanout/a.ts");
    const tracker = new UsageTracker({
      projectRoot: path.dirname(entryFile),
    });

    const result = tracker.track({
      entryFile,
      startPoint: findRange(entrySource, "const x = 1"),
    });

    expect(result.nodes.some((node) => node.kind === "start-point")).toBe(true);
  });

  it("tracks virtual files without reading from disk", () => {
    const config = createConfig();
    const tracker = new UsageTracker(config);
    const result = tracker.track({
      entryFile,
      startPoint: findRange(source, "const value = 1"),
    });

    expect(result.nodes.some((node) => node.kind === "read-reference")).toBe(true);
    expect(result.files).toEqual(new Map());
  });

  it("reuses the parser cache across track calls", () => {
    const config = createConfig();
    const context = new ProjectContext(config);
    const tracker = new UsageTracker(config, context);
    const request = {
      entryFile,
      startPoint: findRange(source, "const value = 1"),
    };

    tracker.track(request);
    const cacheSize = context.getParser().getCache().size;
    tracker.track(request);

    expect(context.getParser().getCache().size).toBe(cacheSize);
  });

  it("threads maxUsageNodes through to the forward slicer", () => {
    const config = createConfig("export const value = 1; console.log(value); console.log(value);");
    const tracker = new UsageTracker({ ...config, maxUsageNodes: 1 });
    const result = tracker.track({
      entryFile,
      startPoint: findRange(config.virtualFiles?.[entryFile] ?? "", "const value = 1"),
    });

    expect(result.issues).toEqual([
      expect.objectContaining({ kind: "usage-cap-reached", resolution: "leaf" }),
    ]);
  });

  it("propagates StartPointNotFoundError unchanged", () => {
    const tracker = new UsageTracker(createConfig());

    expect(() =>
      tracker.track({
        entryFile,
        startPoint: { start: 999, end: 1000 },
      }),
    ).toThrow(StartPointNotFoundError);
  });

  it("assembles files only when output is requested", () => {
    const tracker = new UsageTracker(createConfig());
    const result = tracker.track({
      entryFile,
      startPoint: findRange(source, "const value = 1"),
      output: { mode: "blank" },
    });

    expect(result.files.has(entryFile)).toBe(true);
  });

  it("uses the same node id format as the backward tracker", async () => {
    const config = createConfig();
    const context = new ProjectContext(config);
    const usageTracker = new UsageTracker(config, context);
    const dependencyTracker = new (await import("@/index")).DependencyTracker(config, context);
    const startPoint = findRange(source, "const value = 1");

    const usageResult = usageTracker.track({ entryFile, startPoint });
    const dependencyResult = await dependencyTracker.track({ entryFile, startPoint });

    expect(usageResult.nodes.some((node) => dependencyResult.nodes.some((other) => other.id === node.id))).toBe(
      true,
    );
  });
});