import { assertNever } from "assert-never";

import type { AbsolutePath, IgnorePattern } from "@/types";

/**
 * Compiled ignore pattern representation.
 */
type CompiledPattern = { kind: "string"; value: string } | { kind: "regexp"; value: RegExp };

/**
 * Compiles and tests ignore patterns against resolved absolute file paths.
 *
 * Always includes `node_modules` as an implicit leading pattern.
 */
export class IgnoreFilter {
  private readonly patterns: CompiledPattern[];

  /**
   * Create an ignore filter with the implicit node_modules pattern prepended.
   *
   * @param patterns Ignore patterns supplied by the caller.
   */
  constructor(patterns: IgnorePattern[]) {
    const withImplicit = ["node_modules", ...patterns];
    this.patterns = withImplicit.map((pattern) => this.compilePattern(pattern));
  }

  /**
   * Returns the first pattern that matches `absolutePath`, or `null` if none match.
   *
   * @param absolutePath Absolute path to test against ignore patterns.
   * @returns The first matching pattern, or null when none match.
   * @throws {Error} When an unexpected compiled pattern is encountered.
   */
  readonly match = (absolutePath: AbsolutePath): IgnorePattern | null => {
    for (const pattern of this.patterns) {
      switch (pattern.kind) {
        case "string":
          if (absolutePath.includes(pattern.value)) {
            return pattern.value;
          }
          break;
        case "regexp":
          if (pattern.value.test(absolutePath)) {
            return pattern.value;
          }
          break;
        default:
          assertNever(pattern);
      }
    }

    return null;
  };

  /**
   * Compile a raw ignore pattern into a tagged representation.
   *
   * @param pattern Raw ignore pattern supplied by the caller.
   * @returns Compiled pattern with an explicit kind tag.
   * @throws {Error} When an unsupported pattern type is encountered.
   */
  private readonly compilePattern = (pattern: IgnorePattern): CompiledPattern => {
    switch (typeof pattern) {
      case "string":
        return { kind: "string", value: pattern };
      case "object":
        return { kind: "regexp", value: pattern };
      default:
        return assertNever(pattern);
    }
  };
}
