import { describe, expect, it } from "vitest";

import { buildParsedFile } from "@/__tests__/utils";
import type { IParser } from "@/parse";
import type { AbsolutePath, ParsedFile, SourceText } from "@/types";

/**
 * Minimal parser implementation used for interface checks.
 */
class ValidParser implements IParser {
  /**
   * Return a ParsedFile for the provided path and source.
   *
   * @param absolutePath Absolute path of the file.
   * @param source Source text to associate with the file.
   * @returns ParsedFile instance for the provided inputs.
   */
  readonly parse = (absolutePath: AbsolutePath, source: SourceText): ParsedFile =>
    buildParsedFile(absolutePath, source);

  /**
   * Return an empty cache for the test parser.
   *
   * @returns Empty parse cache.
   */
  readonly getCache = (): Map<AbsolutePath, ParsedFile> => new Map();
}

describe("IParser", () => {
  it("accepts a valid implementation", () => {
    const parser = new ValidParser();
    const file: AbsolutePath = "/project/src/entry.ts";
    const source: SourceText = "const value = 1;";

    const parsed = parser.parse(file, source);

    expect(parsed.absolutePath).toBe(file);
    expect(parsed.source).toBe(source);
  });
});
