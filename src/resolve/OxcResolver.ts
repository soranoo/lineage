import { assertNever } from "assert-never";
import { ResolverFactory } from "oxc-resolver";
import type { ResolveResult as OxcResolveResult } from "oxc-resolver";

import type { IResolver } from "@/resolve/Resolver";
import type { AbsolutePath, OxcResolverOptions, ResolveResult, SourceText } from "@/types";

import { IgnoreFilter } from "@/resolve/IgnoreFilter";

/**
 * Resolves module specifiers using `oxc-resolver`, applying ignore patterns.
 */
export class OxcResolver implements IResolver {
  private readonly resolver: ResolverFactory;
  private readonly ignoreFilter: IgnoreFilter;

  constructor(ignoreFilter: IgnoreFilter, options?: OxcResolverOptions) {
    this.ignoreFilter = ignoreFilter;
    this.resolver =
      options === undefined ? ResolverFactory.default() : new ResolverFactory(options);
  }

  /**
   * Resolves `specifier` relative to `fromFile`.
   */
  readonly resolve = (specifier: SourceText, fromFile: AbsolutePath): ResolveResult => {
    const result = this.resolver.resolveFileSync(fromFile, specifier);
    const resolved = this.toResolveResult(result);

    return this.applyIgnoreFilter(resolved);
  };

  private readonly toResolveResult = (result: OxcResolveResult): ResolveResult => {
    const resolvedPath = result.path;

    if (resolvedPath === undefined) {
      return { kind: "failed" };
    }

    const absolutePath: AbsolutePath = resolvedPath;
    return { kind: "resolved", absolutePath };
  };

  private readonly applyIgnoreFilter = (result: ResolveResult): ResolveResult => {
    switch (result.kind) {
      case "resolved": {
        const matchedPattern = this.ignoreFilter.match(result.absolutePath);
        return matchedPattern === null
          ? result
          : {
              kind: "ignored",
              absolutePath: result.absolutePath,
              matchedPattern,
            };
      }
      case "ignored":
        return result;
      case "failed":
        return result;
      default:
        assertNever(result);
    }
  };
}
