import { describe, expect, it } from "vitest";

import type { IResolver } from "@/resolve/Resolver";
import type { AbsolutePath, ResolveResult, SourceText } from "@/types";

class ValidResolver implements IResolver {
  readonly resolve = (_specifier: SourceText, _fromFile: AbsolutePath): ResolveResult => ({
    kind: "failed",
  });
}

// @ts-expect-error Missing resolve method.
class MissingResolve implements IResolver {}

describe("IResolver", () => {
  it("accepts a valid implementation", () => {
    const resolver = new ValidResolver();
    const result = resolver.resolve("./missing", "/project/src/entry.ts");

    expect(result.kind).toBe("failed");
  });
});
