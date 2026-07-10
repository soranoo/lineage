import path from "node:path";

import { assertNever } from "assert-never";

import type { IResolver } from "@/resolve/Resolver";
import type {
  AbsolutePath,
  IgnorePattern,
  ResolutionTier,
  ResolveResult,
  SourceText,
} from "@/types";

import { IgnoreFilter } from "@/resolve/IgnoreFilter";
import { OxcResolver } from "@/resolve/OxcResolver";
import { InvalidVirtualPathError } from "@/types";

const VIRTUAL_PROBE_SUFFIXES: readonly [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.jsx",
] = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

/**
 * Resolver that checks virtual files first, then ignore rules, then real files.
 */
export class VirtualAwareResolver implements IResolver {
  private readonly virtualFiles: ReadonlyMap<AbsolutePath, SourceText>;
  private readonly ignoreFilter: IgnoreFilter;
  private readonly inner: OxcResolver;

  /**
   * Create a virtual-aware resolver.
   *
   * @param virtualFiles In-memory source map keyed by absolute virtual paths.
   * @param ignoreFilter Ignore filter applied before real-file delegation.
   * @param inner Real-file resolver used for non-virtual lookups.
   * @throws {InvalidVirtualPathError} When any virtual key does not start with `/`.
   */
  constructor(
    virtualFiles: Record<AbsolutePath, SourceText>,
    ignoreFilter: IgnoreFilter,
    inner: OxcResolver,
  ) {
    this.virtualFiles = this.buildVirtualFileMap(virtualFiles);
    this.ignoreFilter = ignoreFilter;
    this.inner = inner;
  }

  /**
   * Resolve a specifier by probing virtual files, then ignore rules, then real files.
   *
   * @param specifier Raw import specifier.
   * @param fromFile Absolute path of the importing file.
   * @returns Resolution result from virtual, ignored, or delegated tier.
   */
  readonly resolve = (specifier: SourceText, fromFile: AbsolutePath): ResolveResult => {
    const basePath = this.normalizeBasePath(specifier, fromFile);
    const virtualMatch = this.findVirtualPath(basePath);
    const matchedPattern = this.ignoreFilter.match(basePath);
    const tier = this.resolveTier(virtualMatch, matchedPattern);

    switch (tier) {
      case "virtual":
        return this.createVirtualResult(virtualMatch);
      case "ignored":
        return this.createIgnoredResult(basePath, matchedPattern);
      case "real":
        return this.inner.resolve(specifier, fromFile);
      default:
        return assertNever(tier);
    }
  };

  /**
   * Validate and materialize the virtual file object as a map.
   *
   * @param virtualFiles Raw virtual file record from configuration.
   * @returns Readonly map of validated virtual file entries.
   * @throws {InvalidVirtualPathError} When any key is not absolute.
   */
  private readonly buildVirtualFileMap = (
    virtualFiles: Record<AbsolutePath, SourceText>,
  ): ReadonlyMap<AbsolutePath, SourceText> => {
    const map = new Map<AbsolutePath, SourceText>();

    for (const [virtualPath, source] of Object.entries(virtualFiles)) {
      if (!virtualPath.startsWith("/")) {
        throw new InvalidVirtualPathError(virtualPath);
      }

      map.set(virtualPath, source);
    }

    return map;
  };

  /**
   * Normalize a specifier into the base path used for virtual probing and ignore checks.
   *
   * @param specifier Raw import specifier.
   * @param fromFile Importing file path.
   * @returns Normalized absolute probe base path.
   */
  private readonly normalizeBasePath = (specifier: SourceText, fromFile: AbsolutePath): AbsolutePath => {
    const usePosixResolution = fromFile.startsWith("/") || specifier.startsWith("/");

    if (usePosixResolution) {
      return path.posix.resolve(path.posix.dirname(fromFile), specifier);
    }

    return path.resolve(path.dirname(fromFile), specifier);
  };

  /**
   * Probe virtual file candidates in deterministic order.
   *
   * @param basePath Normalized base path to probe.
   * @returns Matching virtual file path, or null when none match.
   */
  private readonly findVirtualPath = (basePath: AbsolutePath): AbsolutePath | null => {
    for (const suffix of VIRTUAL_PROBE_SUFFIXES) {
      const candidate = `${basePath}${suffix}`;
      if (this.virtualFiles.has(candidate)) {
        return candidate;
      }
    }

    return null;
  };

  /**
   * Select the resolution tier from virtual and ignore probe results.
   *
   * @param virtualMatch Matched virtual path when found.
   * @param matchedPattern Matched ignore pattern when found.
   * @returns Chosen resolution tier.
   */
  private readonly resolveTier = (
    virtualMatch: AbsolutePath | null,
    matchedPattern: IgnorePattern | null,
  ): ResolutionTier => {
    if (virtualMatch !== null) {
      return "virtual";
    }

    if (matchedPattern !== null) {
      return "ignored";
    }

    return "real";
  };

  /**
   * Build a resolved result for a virtual-path match.
   *
   * @param virtualMatch Matched virtual path.
   * @returns Resolved result containing the virtual absolute path.
   */
  private readonly createVirtualResult = (virtualMatch: AbsolutePath | null): ResolveResult => {
    if (virtualMatch === null) {
      throw new Error("Virtual tier selected without a virtual match.");
    }

    return { kind: "resolved", absolutePath: virtualMatch };
  };

  /**
   * Build an ignored result from the matched ignore pattern.
   *
   * @param basePath Normalized absolute path tested by IgnoreFilter.
   * @param matchedPattern Ignore pattern that matched the base path.
   * @returns Ignored result containing path and pattern.
   */
  private readonly createIgnoredResult = (
    basePath: AbsolutePath,
    matchedPattern: IgnorePattern | null,
  ): ResolveResult => {
    if (matchedPattern === null) {
      throw new Error("Ignored tier selected without a matched pattern.");
    }

    return {
      kind: "ignored",
      absolutePath: basePath,
      matchedPattern,
    };
  };
}