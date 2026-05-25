import type { IResolver } from "@/resolve/Resolver";
import type { AbsolutePath, ResolveResult, SourceText } from "@/types";

/**
 * In-memory resolver stub backed by predefined resolution maps.
 */
export class FakeResolver implements IResolver {
  private readonly base: Map<SourceText, ResolveResult>;
  private readonly overrides?: Map<AbsolutePath, Map<SourceText, ResolveResult>>;

  /**
   * Create a fake resolver backed by predefined maps.
   *
   * @param base Base mapping of specifiers to resolve results.
   * @param overrides Optional per-file overrides for specific importers.
   */
  constructor(
    base: Map<SourceText, ResolveResult>,
    overrides?: Map<AbsolutePath, Map<SourceText, ResolveResult>>,
  ) {
    this.base = base;
    this.overrides = overrides;
  }

  /**
   * Returns the mapped result or `{ kind: 'failed' }` when no mapping exists.
   *
   * @param specifier Import specifier to resolve.
   * @param fromFile Absolute path of the importing file.
   * @returns ResolveResult from the configured maps or a failed result.
   */
  readonly resolve = (specifier: SourceText, fromFile: AbsolutePath): ResolveResult => {
    const override = this.overrides?.get(fromFile)?.get(specifier);
    const resolved = override ?? this.base.get(specifier);

    return resolved ?? { kind: "failed" };
  };
}
