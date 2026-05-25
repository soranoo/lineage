import { describe, expect, it } from "vitest";

import type { AbsolutePath, OxcAst, ParsedFile, SourceText } from "@/types";

import { ParseError } from "@/types";
import { FakeParser } from "./FakeParser";

/**
 * Build a minimal Program AST for tests.
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

describe("FakeParser", () => {
  it("returns the canned parsed file and exposes the cache", () => {
    const file: AbsolutePath = "/project/src/entry.ts";
    const source: SourceText = "const value = 1;";
    const parsed = buildParsedFile(file, source);
    const cache = new Map<AbsolutePath, ParsedFile>([[file, parsed]]);

    const parser = new FakeParser(cache);

    expect(parser.parse(file, source)).toBe(parsed);
    expect(parser.getCache()).toBe(cache);
  });

  it("throws ParseError when the path is missing", () => {
    const parser = new FakeParser(new Map<AbsolutePath, ParsedFile>());
    const file: AbsolutePath = "/project/src/missing.ts";
    const source: SourceText = "const value = 1;";

    expect(() => parser.parse(file, source)).toThrow(ParseError);
  });
});
