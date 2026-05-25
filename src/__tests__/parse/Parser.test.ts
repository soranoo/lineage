import { describe, expect, it } from "vitest";

import type { IParser } from "@/parse/Parser";
import type { AbsolutePath, OxcAst, ParsedFile, SourceText } from "@/types";

/**
 * Build a minimal Program AST for test usage.
 *
 * @returns Minimal Program AST instance.
 */
const buildAst = (): OxcAst => ({
  type: "Program",
  body: [],
  sourceType: "module",
  hashbang: null,
  start: 0,
  end: 0,
});

/**
 * Build a ParsedFile for the provided path and source.
 *
 * @param absolutePath Absolute path for the parsed file.
 * @param source Source text to attach to the parsed file.
 * @returns ParsedFile instance for tests.
 */
const buildParsedFile = (absolutePath: AbsolutePath, source: SourceText): ParsedFile => ({
  absolutePath,
  ast: buildAst(),
  source,
});

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

/**
 * Parser missing parse method for compile-time checks.
 */
// @ts-expect-error Missing parse method.
class MissingParse implements IParser {
  /**
   * Return an empty cache for the test parser.
   *
   * @returns Empty parse cache.
   */
  readonly getCache = (): Map<AbsolutePath, ParsedFile> => new Map();
}

/**
 * Parser missing getCache method for compile-time checks.
 */
// @ts-expect-error Missing getCache method.
class MissingCache implements IParser {
  /**
   * Return a ParsedFile for the provided path and source.
   *
   * @param absolutePath Absolute path of the file.
   * @param source Source text to associate with the file.
   * @returns ParsedFile instance for the provided inputs.
   */
  readonly parse = (absolutePath: AbsolutePath, source: SourceText): ParsedFile =>
    buildParsedFile(absolutePath, source);
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
