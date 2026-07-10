import type { IResolver } from "@/resolve/Resolver";
import type { AbsolutePath, ResolveResult, SourceText } from "@/types";

/**
 * In-memory resolver keyed by "specifier::fromFile" pairs.
 */
export class FakeVirtualResolver implements IResolver {
  private readonly responses: Map<string, ResolveResult>;

  /**
   * Create a fake virtual-aware resolver with canned per-call responses.
   *
   * @param responses Map keyed by `${specifier}::${fromFile}`.
   */
  constructor(responses: Map<string, ResolveResult>) {
    this.responses = responses;
  }

  /**
   * Resolve a specifier/from pair using canned responses.
   *
   * @param specifier Import specifier to resolve.
   * @param fromFile Absolute path of the importing file.
   * @returns Mapped response or failed when absent.
   */
  readonly resolve = (specifier: SourceText, fromFile: AbsolutePath): ResolveResult => {
    const key = `${specifier}::${fromFile}`;
    const response = this.responses.get(key);

    return response ?? { kind: "failed" };
  };
}