import path from "node:path";

import { assertNever } from "assert-never";
import { describe, expect, it, vi } from "vitest";

import type { AbsolutePath, ResolutionTier, ResolveResult } from "@/types";

import { IgnoreFilter } from "@/resolve/IgnoreFilter";
import { OxcResolver } from "@/resolve/OxcResolver";
import { VirtualAwareResolver } from "@/resolve/VirtualAwareResolver";
import { InvalidVirtualPathError } from "@/types";

const fixturesRoot: AbsolutePath = path.resolve(import.meta.dir, "../_fixtures/resolve");
const entryFile: AbsolutePath = path.resolve(fixturesRoot, "entry.ts");
const targetFile: AbsolutePath = path.resolve(fixturesRoot, "target.ts");

/**
 * Create a real OxcResolver for delegation-oriented tests.
 *
 * @returns OxcResolver configured for TypeScript fixture files.
 */
const createInnerResolver = (): OxcResolver =>
  new OxcResolver(new IgnoreFilter([]), {
    extensions: [".ts", ".js", ".json"],
  });

/**
 * Assert compile-time exhaustiveness for `ResolutionTier`.
 *
 * @param tier Resolution tier to return unchanged.
 * @returns The same tier value.
 */
const expectResolutionTierExhaustive = (tier: ResolutionTier): ResolutionTier => {
  switch (tier) {
    case "virtual":
      return tier;
    case "ignored":
      return tier;
    case "real":
      return tier;
    default:
      return assertNever(tier);
  }
};

/**
 * Intentionally incomplete switch to verify the assertNever compile-time guard.
 *
 * @param tier Resolution tier to return unchanged.
 * @returns The same tier value.
 */
const expectResolutionTierNonExhaustive = (tier: ResolutionTier): ResolutionTier => {
  switch (tier) {
    case "virtual":
      return tier;
    case "ignored":
      return tier;
    default:
      // @ts-expect-error Missing "real" branch must make this call invalid.
      return assertNever(tier);
  }
};

describe("VirtualAwareResolver", () => {
  it("resolves exact virtual keys before any fallback", () => {
    const inner = createInnerResolver();
    const resolver = new VirtualAwareResolver(
      {
        "/virtual/math": "export const v = 1;",
      },
      new IgnoreFilter([]),
      inner,
    );

    const result = resolver.resolve("./math", "/virtual/main.ts");

    switch (result.kind) {
      case "resolved":
        expect(result.absolutePath).toBe("/virtual/math");
        break;
      case "ignored":
        throw new Error("Expected resolved result, got ignored.");
      case "failed":
        throw new Error("Expected resolved result, got failed.");
      default:
        assertNever(result);
    }
  });

  it("resolves './math' to '/virtual/math.ts' when only the extension probe exists", () => {
    const inner = createInnerResolver();
    const resolver = new VirtualAwareResolver(
      {
        "/virtual/math.ts": "export const add = (a: number, b: number) => a + b;",
      },
      new IgnoreFilter([]),
      inner,
    );

    const result = resolver.resolve("./math", "/virtual/main.ts");

    switch (result.kind) {
      case "resolved":
        expect(result.absolutePath).toBe("/virtual/math.ts");
        break;
      case "ignored":
        throw new Error("Expected resolved result, got ignored.");
      case "failed":
        throw new Error("Expected resolved result, got failed.");
      default:
        assertNever(result);
    }
  });

  it("probes all eight extension candidates in order", () => {
    const candidates: readonly [
      AbsolutePath,
      AbsolutePath,
      AbsolutePath,
      AbsolutePath,
      AbsolutePath,
      AbsolutePath,
      AbsolutePath,
      AbsolutePath,
    ] = [
      "/virtual/math.ts",
      "/virtual/math.tsx",
      "/virtual/math.js",
      "/virtual/math.jsx",
      "/virtual/math/index.ts",
      "/virtual/math/index.tsx",
      "/virtual/math/index.js",
      "/virtual/math/index.jsx",
    ];

    for (const expectedPath of candidates) {
      const inner = createInnerResolver();
      const resolver = new VirtualAwareResolver(
        {
          [expectedPath]: "export const value = 1;",
        },
        new IgnoreFilter([]),
        inner,
      );

      const result = resolver.resolve("./math", "/virtual/main.ts");
      switch (result.kind) {
        case "resolved":
          expect(result.absolutePath).toBe(expectedPath);
          break;
        case "ignored":
          throw new Error("Expected resolved result, got ignored.");
        case "failed":
          throw new Error("Expected resolved result, got failed.");
        default:
          assertNever(result);
      }
    }
  });

  it("prefers earlier probe candidates when multiple virtual candidates exist", () => {
    const inner = createInnerResolver();
    const resolver = new VirtualAwareResolver(
      {
        "/virtual/math.ts": "export const first = true;",
        "/virtual/math.tsx": "export const second = true;",
      },
      new IgnoreFilter([]),
      inner,
    );

    const result = resolver.resolve("./math", "/virtual/main.ts");

    switch (result.kind) {
      case "resolved":
        expect(result.absolutePath).toBe("/virtual/math.ts");
        break;
      case "ignored":
        throw new Error("Expected resolved result, got ignored.");
      case "failed":
        throw new Error("Expected resolved result, got failed.");
      default:
        assertNever(result);
    }
  });

  it("returns ignored when no virtual file matches and the normalized path is ignored", () => {
    const inner = createInnerResolver();
    const pattern = /\/virtual\/ignored/;
    const resolver = new VirtualAwareResolver({}, new IgnoreFilter([pattern]), inner);

    const result = resolver.resolve("./ignored/module", "/virtual/main.ts");

    switch (result.kind) {
      case "ignored":
        expect(result.matchedPattern).toBe(pattern);
        expect(result.absolutePath).toBe("/virtual/ignored/module");
        break;
      case "resolved":
        throw new Error("Expected ignored result, got resolved.");
      case "failed":
        throw new Error("Expected ignored result, got failed.");
      default:
        assertNever(result);
    }
  });

  it("delegates to OxcResolver when virtual and ignore tiers do not match", () => {
    const inner = createInnerResolver();
    const resolver = new VirtualAwareResolver({}, new IgnoreFilter([]), inner);

    const delegated: ResolveResult = {
      kind: "resolved",
      absolutePath: targetFile,
    };

    const spy = vi.spyOn(inner, "resolve").mockReturnValue(delegated);

    const result = resolver.resolve("./target", entryFile);
    expect(result).toEqual(delegated);
    expect(spy).toHaveBeenCalledWith("./target", entryFile);

    spy.mockRestore();
  });

  it("routes virtual-to-real lookups through the inner OxcResolver", () => {
    const inner = createInnerResolver();
    const resolver = new VirtualAwareResolver(
      {
        "/virtual/main.ts": "import target from './target';",
      },
      new IgnoreFilter([]),
      inner,
    );

    const delegated: ResolveResult = {
      kind: "resolved",
      absolutePath: targetFile,
    };

    const spy = vi.spyOn(inner, "resolve").mockReturnValue(delegated);

    const result = resolver.resolve("./target", "/virtual/main.ts");

    expect(result).toEqual(delegated);
    expect(spy).toHaveBeenCalledWith("./target", "/virtual/main.ts");

    spy.mockRestore();
  });

  it("resolves real-to-virtual imports without delegating", () => {
    const inner = createInnerResolver();
    const resolver = new VirtualAwareResolver(
      {
        "/virtual/math.ts": "export const value = 1;",
      },
      new IgnoreFilter([]),
      inner,
    );

    const spy = vi.spyOn(inner, "resolve");
    const result = resolver.resolve("/virtual/math", entryFile);

    switch (result.kind) {
      case "resolved":
        expect(result.absolutePath).toBe("/virtual/math.ts");
        break;
      case "ignored":
        throw new Error("Expected resolved result, got ignored.");
      case "failed":
        throw new Error("Expected resolved result, got failed.");
      default:
        assertNever(result);
    }

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("throws InvalidVirtualPathError when a virtual key is not absolute", () => {
    const inner = createInnerResolver();

    expect(
      () =>
        new VirtualAwareResolver(
          {
            "relative/path.ts": "export const value = 1;",
          },
          new IgnoreFilter([]),
          inner,
        ),
    ).toThrow(InvalidVirtualPathError);
  });

  it("keeps ResolutionTier switches exhaustive at compile-time", () => {
    expect(expectResolutionTierExhaustive("real")).toBe("real");
    expect(expectResolutionTierNonExhaustive("virtual")).toBe("virtual");
  });
});
