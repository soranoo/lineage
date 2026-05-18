import type { IResolver } from "@/resolve/Resolver";
import type { AbsolutePath, ResolveResult, SourceText } from "@/types";

/**
 * In-memory resolver stub backed by predefined resolution maps.
 */
export class FakeResolver implements IResolver {
  private readonly base: Map<SourceText, ResolveResult>;
  private readonly overrides?: Map<AbsolutePath, Map<SourceText, ResolveResult>>;

  constructor(
    base: Map<SourceText, ResolveResult>,
    overrides?: Map<AbsolutePath, Map<SourceText, ResolveResult>>,
  ) {
    this.base = base;
    this.overrides = overrides;
  }

  /**
   * Returns the mapped result or `{ kind: 'failed' }` when no mapping exists.
   */
  readonly resolve = (specifier: SourceText, fromFile: AbsolutePath): ResolveResult => {
    const override = this.overrides?.get(fromFile)?.get(specifier);
    const resolved = override ?? this.base.get(specifier);

    return resolved ?? { kind: "failed" };
  };
}
