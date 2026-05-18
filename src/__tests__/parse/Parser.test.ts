import { describe, expect, it } from "vitest";

import type { IParser } from "@/parse/Parser";
import type { AbsolutePath, OxcAst, ParsedFile, SourceText } from "@/types";

const buildAst = (): OxcAst => ({
  type: "Program",
  body: [],
  sourceType: "module",
  hashbang: null,
  start: 0,
  end: 0,
});

const buildParsedFile = (absolutePath: AbsolutePath, source: SourceText): ParsedFile => ({
  absolutePath,
  ast: buildAst(),
  source,
});

class ValidParser implements IParser {
  readonly parse = (absolutePath: AbsolutePath, source: SourceText): ParsedFile =>
    buildParsedFile(absolutePath, source);

  readonly getCache = (): Map<AbsolutePath, ParsedFile> => new Map();
}

// @ts-expect-error Missing parse method.
class MissingParse implements IParser {
  readonly getCache = (): Map<AbsolutePath, ParsedFile> => new Map();
}

// @ts-expect-error Missing getCache method.
class MissingCache implements IParser {
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
