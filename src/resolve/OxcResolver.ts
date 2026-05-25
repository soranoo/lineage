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

  /**
   * Create a resolver configured with ignore filtering.
   *
   * @param ignoreFilter Ignore filter used to classify resolved paths.
   * @param options Optional resolver options forwarded to oxc-resolver.
   */
  constructor(ignoreFilter: IgnoreFilter, options?: OxcResolverOptions) {
    this.ignoreFilter = ignoreFilter;
    this.resolver =
      options === undefined ? ResolverFactory.default() : new ResolverFactory(options);
  }

  /**
   * Resolves `specifier` relative to `fromFile`.
   *
   * @param specifier Raw import specifier to resolve.
   * @param fromFile Absolute path of the importing file.
   * @returns Resolution result after applying ignore filters.
   */
  readonly resolve = (specifier: SourceText, fromFile: AbsolutePath): ResolveResult => {
    const result = this.resolver.resolveFileSync(fromFile, specifier);
    const resolved = this.toResolveResult(result);

    return this.applyIgnoreFilter(resolved);
  };

  /**
   * Convert an oxc-resolver result to the internal ResolveResult union.
   *
   * @param result Resolver result from oxc-resolver.
   * @returns Internal ResolveResult representation.
   */
  private readonly toResolveResult = (result: OxcResolveResult): ResolveResult => {
    const resolvedPath = result.path;

    if (resolvedPath === undefined) {
      return { kind: "failed" };
    }

    const absolutePath: AbsolutePath = resolvedPath;
    return { kind: "resolved", absolutePath };
  };

  /**
   * Apply ignore patterns to a resolved path.
   *
   * @param result ResolveResult to evaluate against ignore patterns.
   * @returns Updated ResolveResult after ignore evaluation.
   * @throws {Error} When an unexpected ResolveResult kind is encountered.
   */
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
