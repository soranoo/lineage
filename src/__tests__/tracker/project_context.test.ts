import { describe, expect, it } from "vitest";

import { DependencyTracker, ProjectContext, UsageTracker } from "@/index";
import { findRange } from "@/__tests__/utils";
import type { AbsolutePath, SourceText, UsageTrackerConfig } from "@/types";

const entryFile: AbsolutePath = "/virtual/entry.ts";
const dependencyFile: AbsolutePath = "/virtual/dependency.ts";
const consumerFile: AbsolutePath = "/virtual/consumer.ts";

const virtualFiles: Record<AbsolutePath, SourceText> = {
  [entryFile]: "import { value } from './dependency'; export const result = value;",
  [dependencyFile]: "export const value = 1;",
  [consumerFile]: "import { value } from './dependency'; console.log(value);",
};

const usageConfig: UsageTrackerConfig = {
  virtualFiles,
};

describe("ProjectContext", () => {
  it("shares parser cache between dependency and usage trackers", async () => {
    const context = new ProjectContext(usageConfig);
    const dependencyTracker = new DependencyTracker(usageConfig, context);
    const usageTracker = new UsageTracker(usageConfig, context);
    const entrySource = virtualFiles[entryFile];

    if (entrySource === undefined) {
      throw new Error("Missing virtual entry source.");
    }

    await dependencyTracker.track({
      entryFile,
      startPoint: findRange(entrySource, "result = value"),
    });
    const cacheSizeAfterDependency = context.getParser().getCache().size;

    usageTracker.track({
      entryFile: dependencyFile,
      startPoint: findRange(virtualFiles[dependencyFile] ?? "", "value = 1"),
    });

    expect(cacheSizeAfterDependency).toBe(3);
    expect(context.getParser().getCache().size).toBe(3);
  });

  it("reuses one import graph for trackers sharing a context", () => {
    const context = new ProjectContext(usageConfig);
    const firstTracker = new UsageTracker(usageConfig, context);
    const secondTracker = new UsageTracker(usageConfig, context);

    expect(firstTracker).toBeInstanceOf(UsageTracker);
    expect(secondTracker).toBeInstanceOf(UsageTracker);
    expect(context.getProjectIndex(usageConfig)).toBe(context.getProjectIndex(usageConfig));
  });

  it("keeps parser caches isolated across different contexts", () => {
    const firstContext = new ProjectContext(usageConfig);
    const secondContext = new ProjectContext(usageConfig);

    new UsageTracker(usageConfig, firstContext);

    expect(firstContext.getParser().getCache().size).toBeGreaterThan(0);
    expect(secondContext.getParser().getCache().size).toBe(virtualFileCount(usageConfig));
  });

  it("supports constructing trackers without an explicit context", async () => {
    const tracker = new DependencyTracker(usageConfig);
    const source = virtualFiles[entryFile];

    if (source === undefined) {
      throw new Error("Missing virtual entry source.");
    }

    const result = await tracker.track({
      entryFile,
      startPoint: findRange(source, "result = value"),
    });

    expect(result.nodes.length).toBeGreaterThan(0);
  });
});

const virtualFileCount = (config: UsageTrackerConfig): number =>
  Object.keys(config.virtualFiles ?? {}).length;