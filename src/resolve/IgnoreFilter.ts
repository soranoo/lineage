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

  constructor(patterns: IgnorePattern[]) {
    const withImplicit = ["node_modules", ...patterns];
    this.patterns = withImplicit.map((pattern) => this.compilePattern(pattern));
  }

  /**
   * Returns the first pattern that matches `absolutePath`, or `null` if none match.
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
