import { parseSync } from "oxc-parser";

import type { IParser } from "@/parse/Parser";
import type { AbsolutePath, ParsedFile, SourceText } from "@/types";

import { ParseError } from "@/types";

/**
 * Parses source files with `oxc-parser` and caches results by absolute path.
 */
export class OxcParser implements IParser {
  private readonly cache: Map<AbsolutePath, ParsedFile>;

  constructor() {
    this.cache = new Map();
  }

  /**
   * Parse `source` and cache the result under `absolutePath`.
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
   */
  readonly getCache = (): Map<AbsolutePath, ParsedFile> => this.cache;
}
