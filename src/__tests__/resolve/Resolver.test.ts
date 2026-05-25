import { describe, expect, it } from "vitest";

import type { IResolver } from "@/resolve/Resolver";
import type { AbsolutePath, ResolveResult, SourceText } from "@/types";

/**
 * Minimal resolver implementation used for interface checks.
 */
class ValidResolver implements IResolver {
  /**
   * Return a failed resolution result for tests.
   *
   * @param _specifier Specifier being resolved.
   * @param _fromFile Importing file path.
   * @returns Failed ResolveResult for test coverage.
   */
  readonly resolve = (_specifier: SourceText, _fromFile: AbsolutePath): ResolveResult => ({
    kind: "failed",
  });
}

/**
 * Resolver missing resolve method for compile-time checks.
 */
// @ts-expect-error Missing resolve method.
class MissingResolve implements IResolver {}

describe("IResolver", () => {
  it("accepts a valid implementation", () => {
    const resolver = new ValidResolver();
    const result = resolver.resolve("./missing", "/project/src/entry.ts");

    expect(result.kind).toBe("failed");
  });
});
