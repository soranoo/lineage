import { describe, expect, it } from "vitest";

import type { AbsolutePath, SourceText } from "@/types";

import { ParseError } from "@/types";
import { OxcParser } from "@/parse/OxcParser";

describe("OxcParser", () => {
  it("parses valid JS into a ParsedFile", () => {
    const parser = new OxcParser();
    const file: AbsolutePath = "/project/src/entry.ts";
    const source: SourceText = "const value = 1;";

    const parsed = parser.parse(file, source);

    expect(parsed.absolutePath).toBe(file);
    expect(parsed.source).toBe(source);
    expect(parsed.ast).toBeTruthy();
  });

  it("returns cached results for the same path", () => {
    const parser = new OxcParser();
    const file: AbsolutePath = "/project/src/cache.ts";
    const source: SourceText = "const value = 2;";

    const first = parser.parse(file, source);
    const second = parser.parse(file, source);

    expect(second).toBe(first);
  });

  it("caches results per path", () => {
    const parser = new OxcParser();
    const firstFile: AbsolutePath = "/project/src/first.ts";
    const secondFile: AbsolutePath = "/project/src/second.ts";

    parser.parse(firstFile, "const a = 1;");
    parser.parse(secondFile, "const b = 2;");

    const cache = parser.getCache();
    expect(cache.size).toBe(2);
    expect(cache.has(firstFile)).toBe(true);
    expect(cache.has(secondFile)).toBe(true);
  });

  it("throws ParseError with errors for invalid JS", () => {
    const parser = new OxcParser();
    const file: AbsolutePath = "/project/src/bad.ts";
    const source: SourceText = "const =";

    try {
      parser.parse(file, source);
    } catch (error) {
      if (!(error instanceof ParseError)) {
        throw error;
      }

      expect(error.oxcErrors.length).toBeGreaterThan(0);
      return;
    }

    throw new Error("Expected ParseError to be thrown.");
  });

  it("reports cache size for unique paths", () => {
    const parser = new OxcParser();
    const firstFile: AbsolutePath = "/project/src/alpha.ts";
    const secondFile: AbsolutePath = "/project/src/beta.ts";

    parser.parse(firstFile, "const alpha = 1;");
    parser.parse(secondFile, "const beta = 2;");

    expect(parser.getCache().size).toBe(2);
  });
});
