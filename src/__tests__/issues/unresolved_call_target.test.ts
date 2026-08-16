import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { toFixturePath } from "@/__tests__/utils";
import { DependencyTracker } from "@/index";
import type { AbsolutePath, ModuleResolutionPlugin, OffsetRange, SourceText } from "@/types";

const entryFile: AbsolutePath = "/virtual/entry.ts";

const source: SourceText = ["function execute(loader) {", "  return loader(9355);", "}"].join("\n");

const callRange: OffsetRange = {
  start: source.indexOf("loader(9355)"),
  end: source.indexOf("loader(9355)") + "loader(9355)".length,
};

describe("unresolved call targets", () => {
  it("reports a call whose callee resolves to an untraceable parameter", async () => {
    const tracker = new DependencyTracker({
      virtualFiles: { [entryFile]: source },
    });

    const result = await tracker.track({
      entryFile,
      startPoint: callRange,
      output: { mode: "blank" },
    });

    expect(
      result.issues.filter(
        (issue) => issue.kind === "unresolved-call-target" && issue.file === entryFile,
      ),
    ).toEqual([
      expect.objectContaining({
        range: callRange,
        resolution: "leaf",
      }),
    ]);
  });

  it("does not report an unresolved target when a parameter is only read", async () => {
    const loggerSource: SourceText = [
      "function execute(logger) {",
      "  console.log(logger);",
      "  return 42;",
      "}",
    ].join("\n");
    const loggerFile: AbsolutePath = "/virtual/logger.ts";
    const tracker = new DependencyTracker({
      virtualFiles: { [loggerFile]: loggerSource },
    });

    const result = await tracker.track({
      entryFile: loggerFile,
      startPoint: {
        start: loggerSource.indexOf("return 42"),
        end: loggerSource.indexOf("return 42") + "return 42".length,
      },
      output: { mode: "blank" },
    });

    expect(result.issues.some((issue) => issue.kind === "unresolved-call-target")).toBe(false);
  });

  it("lets a plugin resolve the call into a virtual module", async () => {
    const targetFile: AbsolutePath = "/virtual/module.ts";
    const targetSource: SourceText = "export const value = 1;";
    const seen: Array<[SourceText, readonly (string | number | boolean)[], AbsolutePath]> = [];
    const plugin: ModuleResolutionPlugin = {
      name: "numeric-loader",
      tryResolve: ({ calleeText, args, file }) => {
        seen.push([calleeText, args, file]);
        return args[0] === 9355 ? { specifier: targetFile } : null;
      },
    };
    const tracker = new DependencyTracker({
      virtualFiles: { [entryFile]: source, [targetFile]: targetSource },
      moduleResolutionPlugins: [plugin],
    });

    const result = await tracker.track({
      entryFile,
      startPoint: callRange,
      output: { mode: "blank" },
    });

    expect(seen).toEqual([["loader", [9355], entryFile]]);
    expect(result.issues.some((issue) => issue.kind === "unresolved-call-target")).toBe(false);
    expect(
      result.nodes.some((node) => node.file === targetFile && node.label.includes("value")),
    ).toBe(true);
  });

  it("tries plugins in order when earlier plugins decline", async () => {
    const calls: SourceText[] = [];
    const first: ModuleResolutionPlugin = {
      name: "first",
      tryResolve: () => {
        calls.push("first");
        return null;
      },
    };
    const second: ModuleResolutionPlugin = {
      name: "second",
      tryResolve: () => {
        calls.push("second");
        return null;
      },
    };
    const tracker = new DependencyTracker({
      virtualFiles: { [entryFile]: source },
      moduleResolutionPlugins: [first, second],
    });

    await tracker.track({ entryFile, startPoint: callRange });

    expect(calls).toEqual(["first", "second"]);
  });

  it("does not report resolvable or indirect call targets as unresolved", async () => {
    const resolvableFile: AbsolutePath = "/virtual/resolvable.ts";
    const resolvableSource: SourceText = [
      "function helper(value) {",
      "  return value + 1;",
      "}",
      "helper(5);",
    ].join("\n");
    const indirectSource: SourceText = "const factory = makeThing(); factory();";
    const resolvableTracker = new DependencyTracker({
      virtualFiles: { [resolvableFile]: resolvableSource },
    });
    const indirectFile: AbsolutePath = "/virtual/indirect.ts";
    const indirectTracker = new DependencyTracker({
      virtualFiles: { [indirectFile]: indirectSource },
    });

    const resolvableResult = await resolvableTracker.track({
      entryFile: resolvableFile,
      startPoint: {
        start: resolvableSource.indexOf("helper(5)"),
        end: resolvableSource.indexOf("helper(5)") + "helper(5)".length,
      },
    });
    const indirectResult = await indirectTracker.track({
      entryFile: indirectFile,
      startPoint: {
        start: indirectSource.indexOf("factory()"),
        end: indirectSource.indexOf("factory()") + "factory()".length,
      },
    });

    expect(resolvableResult.issues.some((issue) => issue.kind === "unresolved-call-target")).toBe(
      false,
    );
    expect(indirectResult.issues.filter((issue) => issue.kind === "indirect-call")).toHaveLength(1);
    expect(indirectResult.issues.some((issue) => issue.kind === "unresolved-call-target")).toBe(
      false,
    );
  });

  it("reproduces the trimmed webpack bundle dead-end and plugin escape", async () => {
    const pageFile: AbsolutePath = "/virtual/webpack-bundle-real/app/_not-found/page.js";
    const runtimeFile: AbsolutePath = "/virtual/webpack-bundle-real/webpack-runtime.js";
    const chunkFile: AbsolutePath = "/virtual/webpack-bundle-real/chunks/500.js";
    const pageSource = readFileSync(
      toFixturePath("usage/webpack-bundle-real/app/_not-found/page.js"),
      "utf8",
    );
    const runtimeSource = readFileSync(
      toFixturePath("usage/webpack-bundle-real/webpack-runtime.js"),
      "utf8",
    );
    const chunkSource = readFileSync(
      toFixturePath("usage/webpack-bundle-real/chunks/500.js"),
      "utf8",
    );
    const files = {
      [pageFile]: pageSource,
      [runtimeFile]: runtimeSource,
      [chunkFile]: chunkSource,
    };
    const start = pageSource.indexOf("n(9355)");
    const startPoint: OffsetRange = { start, end: start + "n(9355)".length };
    const withoutPlugin = await new DependencyTracker({ virtualFiles: files }).track({
      entryFile: pageFile,
      startPoint,
      output: { mode: "blank" },
    });
    const withPlugin = await new DependencyTracker({
      virtualFiles: files,
      moduleResolutionPlugins: [
        {
          name: "webpack-numeric-module-map",
          tryResolve: ({ calleeText, args }) =>
            calleeText === "n" && args[0] === 9355 ? { specifier: chunkFile } : null,
        },
      ],
    }).track({
      entryFile: pageFile,
      startPoint,
      output: { mode: "blank" },
    });

    expect(withoutPlugin.issues.some((issue) => issue.kind === "unresolved-call-target")).toBe(
      true,
    );
    expect(withoutPlugin.files.has(chunkFile)).toBe(false);
    expect(withoutPlugin.nodes.some((node) => node.label.includes("__variable_1e4310"))).toBe(
      false,
    );
    expect(withPlugin.issues.some((issue) => issue.kind === "unresolved-call-target")).toBe(false);
    expect(withPlugin.files.has(chunkFile)).toBe(true);
    expect(withPlugin.nodes.some((node) => node.label.includes("__variable_1e4310"))).toBe(true);
  });
});
