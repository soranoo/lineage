import path from "node:path";

import { assertNever } from "assert-never";
import { describe, expect, it } from "vitest";

import type { AbsolutePath, IgnorePattern } from "@/types";

import { IgnoreFilter } from "@/resolve/IgnoreFilter";
import { OxcResolver } from "@/resolve/OxcResolver";

const fixturesRoot: AbsolutePath = path.resolve(import.meta.dir, "../_fixtures/resolve");
const entryFile: AbsolutePath = path.resolve(fixturesRoot, "entry.ts");
const targetFile: AbsolutePath = path.resolve(fixturesRoot, "target.ts");

const buildResolver = (patterns: IgnorePattern[]): OxcResolver =>
  new OxcResolver(new IgnoreFilter(patterns), {
    extensions: [".ts", ".js", ".json"],
  });

describe("OxcResolver + IgnoreFilter", () => {
  it("returns ignored for a path matching a custom pattern", () => {
    const pattern = /ignored/;
    const resolver = buildResolver([pattern]);
    const result = resolver.resolve("./ignored/ignored", entryFile);

    switch (result.kind) {
      case "ignored":
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

  it("returns resolved when no patterns match", () => {
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
});
