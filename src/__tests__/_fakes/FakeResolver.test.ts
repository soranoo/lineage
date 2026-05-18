import { describe, expect, it } from "vitest";

import type { AbsolutePath, ResolveResult, SourceText } from "@/types";

import { FakeResolver } from "./FakeResolver";

describe("FakeResolver", () => {
  it("returns mapped results or failed", () => {
    const specifier: SourceText = "./target";
    const fromFile: AbsolutePath = "/project/src/entry.ts";
    const resolvedPath: AbsolutePath = "/project/src/target.ts";
    const resolved: ResolveResult = {
      kind: "resolved",
      absolutePath: resolvedPath,
    };

    const base = new Map<SourceText, ResolveResult>([[specifier, resolved]]);
    const resolver = new FakeResolver(base);

    expect(resolver.resolve(specifier, fromFile)).toEqual(resolved);
    expect(resolver.resolve("./missing", fromFile)).toEqual({ kind: "failed" });
  });

  it("supports per-file overrides", () => {
    const specifier: SourceText = "./target";
    const fromFile: AbsolutePath = "/project/src/entry.ts";
    const otherFile: AbsolutePath = "/project/src/other.ts";
    const resolvedPath: AbsolutePath = "/project/src/target.ts";
    const resolved: ResolveResult = {
      kind: "resolved",
      absolutePath: resolvedPath,
    };
    const ignored: ResolveResult = {
      kind: "ignored",
      absolutePath: resolvedPath,
      matchedPattern: "ignored",
    };

    const base = new Map<SourceText, ResolveResult>([[specifier, resolved]]);
    const overrides = new Map<AbsolutePath, Map<SourceText, ResolveResult>>([
      [fromFile, new Map([[specifier, ignored]])],
    ]);

    const resolver = new FakeResolver(base, overrides);

    expect(resolver.resolve(specifier, fromFile)).toEqual(ignored);
    expect(resolver.resolve(specifier, otherFile)).toEqual(resolved);
  });
});
