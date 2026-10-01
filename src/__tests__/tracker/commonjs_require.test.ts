import { describe, expect, it } from "vitest";

import type { AbsolutePath, SourceText, TrackerConfig } from "@/types";
import { findRange } from "@/__tests__/utils";
import { DependencyTracker } from "@/index";

const page: AbsolutePath = "/project/page.js";
const runtime: AbsolutePath = "/project/runtime.js";

/** Track a selected fragment in a set of virtual CommonJS files. */
const track = async (
  source: SourceText,
  fragment: SourceText,
  files: Record<AbsolutePath, SourceText>,
  config: TrackerConfig = {},
) =>
  new DependencyTracker({ virtualFiles: { [page]: source, ...files }, ...config }).track({
    entryFile: page,
    startPoint: findRange(source, fragment),
  });

describe("literal CommonJS require dependencies", () => {
  it("follows a default CommonJS export through a literal require", async () => {
    const source = 'var t = require("./runtime.js"); const result = t(1);';
    const result = await track(source, "const result = t(1)", {
      [runtime]: "function runtime(id) { return id; } module.exports = runtime;",
    });

    expect(
      result.nodes.some((node) => node.file === runtime && node.label.includes("function runtime")),
    ).toBe(true);
    expect(result.edges.some((edge) => edge.kind === "import" && edge.to.startsWith(runtime))).toBe(
      true,
    );
    expect(
      result.issues.some(
        (issue) =>
          issue.kind === "unresolved-dependency" && issue.range.start === source.indexOf("require"),
      ),
    ).toBe(false);
  });

  it("follows a require selected directly at its declaration", async () => {
    const source = 'var t = require("./runtime.js");';
    const result = await track(source, "var t = require", {
      [runtime]: "function runtime(id) { return id; } module.exports = runtime;",
    });

    expect(result.nodes.some((node) => node.file === runtime && node.kind === "function")).toBe(
      true,
    );
    expect(result.issues.some((issue) => issue.kind === "unresolved-dependency")).toBe(false);
  });

  it("follows CommonJS exports inside wrapper functions", async () => {
    const source = '(() => { var t = require("./runtime.js"); t.C({}); })();';
    const result = await track(source, "t.C({})", {
      [runtime]: "(() => { function runtime(id) { return id; } module.exports = runtime; })();",
    });

    expect(
      result.nodes.some((node) => node.file === runtime && node.label.includes("function runtime")),
    ).toBe(true);
  });

  it("follows a named export through a destructured require", async () => {
    const source = 'const { run } = require("./runtime.js"); const result = run(1);';
    const result = await track(source, "const result = run(1)", {
      [runtime]: "function run(value) { return value; } exports.run = run;",
    });

    expect(
      result.nodes.some((node) => node.file === runtime && node.label.includes("function run")),
    ).toBe(true);
    expect(result.edges.some((edge) => edge.kind === "import" && edge.to.startsWith(runtime))).toBe(
      true,
    );
  });

  it("emits an unresolved leaf for a missing relative module", async () => {
    const source = 'const value = require("./missing.js"); const result = value;';
    const result = await track(source, "const result = value", {});

    expect(result.nodes.some((node) => node.kind === "unresolved-leaf" && node.file === page)).toBe(
      true,
    );
    expect(result.issues.some((issue) => issue.kind === "unresolved-dependency")).toBe(true);
  });

  it("emits an unresolved leaf for a missing named export", async () => {
    const source = 'const { run } = require("./runtime.js"); const result = run;';
    const result = await track(source, "const result = run", {
      [runtime]: "exports.other = 1;",
    });

    expect(result.nodes.some((node) => node.kind === "unresolved-leaf" && node.file === page)).toBe(
      true,
    );
    expect(result.issues.some((issue) => issue.kind === "unresolved-dependency")).toBe(true);
  });

  it("does not substitute a default export for a missing destructured name", async () => {
    const source = 'const { run } = require("./runtime.js"); const result = run;';
    const result = await track(source, "const result = run", {
      [runtime]: "function runtime() {} module.exports = runtime;",
    });

    expect(result.nodes.some((node) => node.kind === "unresolved-leaf" && node.file === page)).toBe(
      true,
    );
    expect(result.nodes.some((node) => node.file === runtime && node.kind === "function")).toBe(
      false,
    );
  });

  it("keeps an ignored node_modules target as a visible leaf", async () => {
    const source = 'const value = require("./node_modules/pkg.js"); const result = value;';
    const target: AbsolutePath = "/project/node_modules/pkg.js";
    const result = await track(source, "const result = value", {});

    expect(result.nodes.some((node) => node.kind === "ignored-leaf" && node.file === page)).toBe(
      true,
    );
    expect(
      result.issues.some(
        (issue) => issue.kind === "ignored-path" && issue.matchedPattern === "node_modules",
      ),
    ).toBe(true);
    expect(result.nodes.some((node) => node.file === target)).toBe(false);
  });

  it("does not resolve a dynamic require as a static import", async () => {
    const source =
      "const name = './runtime.js'; const value = require(name); const result = value;";
    const result = await track(source, "const result = value", {
      [runtime]: "module.exports = 1;",
    });

    expect(result.nodes.some((node) => node.file === runtime)).toBe(false);
    expect(result.issues.some((issue) => issue.kind === "dynamic-require")).toBe(true);
  });

  it("does not mistake a shadowed require parameter for the module loader", async () => {
    const source =
      'function load(require) { const value = require("./runtime.js"); return value; }';
    const result = await track(source, "return value", {
      [runtime]: "module.exports = 1;",
    });

    expect(result.nodes.some((node) => node.file === runtime)).toBe(false);
  });
});
