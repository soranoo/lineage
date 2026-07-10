import { describe, expect, it } from "vitest";

import type { AbsolutePath, ResolveResult, SourceText } from "@/types";

import { FakeVirtualResolver } from "./FakeVirtualResolver";

describe("FakeVirtualResolver", () => {
  it("returns the canned per-call result", () => {
    const specifier: SourceText = "./math";
    const fromFile: AbsolutePath = "/virtual/main.ts";
    const resolvedPath: AbsolutePath = "/virtual/math.ts";
    const expected: ResolveResult = {
      kind: "resolved",
      absolutePath: resolvedPath,
    };

    const responses = new Map<string, ResolveResult>([[`${specifier}::${fromFile}`, expected]]);
    const resolver = new FakeVirtualResolver(responses);

    expect(resolver.resolve(specifier, fromFile)).toEqual(expected);
  });

  it("returns failed when no key is mapped", () => {
    const resolver = new FakeVirtualResolver(new Map());

    expect(resolver.resolve("./missing", "/virtual/main.ts")).toEqual({ kind: "failed" });
  });
});