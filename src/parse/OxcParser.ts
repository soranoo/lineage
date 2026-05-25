import { parseSync } from "oxc-parser";

import type { IParser } from "@/parse/Parser";
import type { AbsolutePath, ParsedFile, SourceText } from "@/types";

import { ParseError } from "@/types";

/**
 * Parses source files with `oxc-parser` and caches results by absolute path.
 */
export class OxcParser implements IParser {
  private readonly cache: Map<AbsolutePath, ParsedFile>;

  /**
   * Initialize a new parser with an empty cache.
   */
  constructor() {
    this.cache = new Map();
  }

  /**
   * Parse `source` and cache the result under `absolutePath`.
   *
   * @param absolutePath Absolute file path of the source being parsed.
   * @param source Raw source code text to parse.
   * @returns Parsed file data for the provided source.
   * @throws {ParseError} When `source` contains syntax errors.
   */
  readonly parse = (absolutePath: AbsolutePath, source: SourceText): ParsedFile => {
    const cached = this.cache.get(absolutePath);

    if (cached !== undefined) {
      return cached;
    }

    const result = parseSync(absolutePath, source);
    const errors = result.errors;

    if (errors.length > 0) {
      throw new ParseError(absolutePath, errors);
    }

    const parsedFile: ParsedFile = {
      absolutePath,
      ast: result.program,
      source,
    };

    this.cache.set(absolutePath, parsedFile);
    return parsedFile;
  };

  /**
   * Returns the internal parse cache.
   *
   * @returns Internal parse cache mapping absolute paths to parsed files.
   */
  readonly getCache = (): Map<AbsolutePath, ParsedFile> => this.cache;
}
