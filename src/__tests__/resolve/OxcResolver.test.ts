import path from "node:path";

import { assertNever } from "assert-never";
import { describe, expect, it } from "vitest";

import type { AbsolutePath, IgnorePattern } from "@/types";

import { IgnoreFilter } from "@/resolve/IgnoreFilter";
import { OxcResolver } from "@/resolve/OxcResolver";

const fixturesRoot: AbsolutePath = path.resolve(import.meta.dir, "../_fixtures/resolve");
const entryFile: AbsolutePath = path.resolve(fixturesRoot, "entry.ts");
const targetFile: AbsolutePath = path.resolve(fixturesRoot, "target.ts");
const ignoredFile: AbsolutePath = path.resolve(fixturesRoot, "ignored/ignored.ts");

/**
 * Build an OxcResolver with the provided ignore patterns.
 *
 * @param patterns Ignore patterns to apply.
 * @returns Configured OxcResolver for tests.
 */
const buildResolver = (patterns: IgnorePattern[]): OxcResolver =>
  new OxcResolver(new IgnoreFilter(patterns), {
    extensions: [".ts", ".js", ".json"],
  });

describe("OxcResolver", () => {
  it("resolves a specifier to a project file", () => {
    const resolver = buildResolver([]);
    const result = resolver.resolve("./target", entryFile);

    switch (result.kind) {
      case "resolved":
        expect(result.absolutePath).toBe(targetFile);
        break;
      case "ignored":
        throw new Error("Expected resolved result, got ignored.");
      case "failed":
        throw new Error("Expected resolved result, got failed.");
      default:
        assertNever(result);
    }
  });

  it("returns ignored when the resolved path matches an ignore pattern", () => {
    const pattern = /ignored/;
    const resolver = buildResolver([pattern]);
    const result = resolver.resolve("./ignored/ignored", entryFile);

    switch (result.kind) {
      case "ignored":
        expect(result.absolutePath).toBe(ignoredFile);
        expect(result.matchedPattern).toBe(pattern);
        break;
      case "resolved":
        throw new Error("Expected ignored result, got resolved.");
      case "failed":
        throw new Error("Expected ignored result, got failed.");
      default:
        assertNever(result);
    }
  });

  it("returns failed for unknown specifiers", () => {
    const resolver = buildResolver([]);
    const result = resolver.resolve("./missing", entryFile);

    switch (result.kind) {
      case "failed":
        expect(result.kind).toBe("failed");
        break;
      case "resolved":
        throw new Error("Expected failed result, got resolved.");
      case "ignored":
        throw new Error("Expected failed result, got ignored.");
      default:
        assertNever(result);
    }
  });

  it("always ignores node_modules paths", () => {
    const resolver = buildResolver([]);
    const result = resolver.resolve("assert-never", entryFile);

    switch (result.kind) {
      case "ignored":
        expect(result.matchedPattern).toBe("node_modules");
        break;
      case "resolved":
        throw new Error("Expected ignored result, got resolved.");
      case "failed":
        throw new Error("Expected ignored result, got failed.");
      default:
        assertNever(result);
    }
  });
});
