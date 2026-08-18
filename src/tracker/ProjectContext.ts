import { OxcParser } from "@/parse";
import type { IParser } from "@/parse";
import { ImportGraph, ProjectIndexer } from "@/project";
import { IgnoreFilter, OxcResolver, ProjectFileScanner, VirtualAwareResolver } from "@/resolve";
import type { IResolver } from "@/resolve";
import type {
  AbsolutePath,
  SourceText,
  TrackerConfig,
  UsageTrackerConfig,
} from "@/types";
import { InvalidVirtualPathError } from "@/types";

const toVirtualFileMap = (
  virtualFiles: Record<AbsolutePath, SourceText> | undefined,
): Map<AbsolutePath, SourceText> => {
  const map = new Map<AbsolutePath, SourceText>();

  for (const [filePath, source] of Object.entries(virtualFiles ?? {})) {
    if (!filePath.startsWith("/")) {
      throw new InvalidVirtualPathError(filePath);
    }

    map.set(filePath, source);
  }

  return map;
};

const toVirtualFileRecord = (
  virtualFiles: ReadonlyMap<AbsolutePath, SourceText>,
): Record<AbsolutePath, SourceText> => Object.fromEntries(virtualFiles);

/** Shared parser, resolver, and lazily-built project-index cache. */
export class ProjectContext {
  private readonly config: TrackerConfig;
  private readonly parser: IParser;
  private readonly resolver: IResolver;
  private readonly virtualFiles: ReadonlyMap<AbsolutePath, SourceText>;
  private readonly indexer: ProjectIndexer;
  private readonly graphCache: Map<SourceText, ImportGraph>;

  /**
   * Create a context that can be shared by backward and forward trackers.
   *
   * @param config Base resolver and virtual-file configuration for the context.
   * @param parser Optional parser implementation, primarily useful for tests.
   * @param resolver Optional resolver implementation, primarily useful for tests.
   */
  constructor(config: TrackerConfig = {}, parser?: IParser, resolver?: IResolver) {
    this.config = config;
    this.virtualFiles = toVirtualFileMap(config.virtualFiles);
    this.parser = parser ?? new OxcParser();

    const ignoreFilter = new IgnoreFilter(config.ignorePatterns ?? []);
    const oxcResolver = new OxcResolver(ignoreFilter, config.resolver);
    const defaultResolver: IResolver =
      this.virtualFiles.size > 0
        ? new VirtualAwareResolver(toVirtualFileRecord(this.virtualFiles), ignoreFilter, oxcResolver)
        : oxcResolver;

    this.resolver = resolver ?? defaultResolver;
    this.indexer = new ProjectIndexer(this.parser, this.resolver, new ProjectFileScanner());
    this.graphCache = new Map<SourceText, ImportGraph>();

    for (const [filePath, source] of this.virtualFiles) {
      this.parser.parse(filePath, source);
    }
  }

  /**
   * Return the parser shared by all trackers using this context.
   *
   * @returns Shared parser and its cache.
   */
  readonly getParser = (): IParser => this.parser;

  /**
   * Return the resolver shared by all trackers using this context.
   *
   * @returns Shared module resolver.
   */
  readonly getResolver = (): IResolver => this.resolver;

  /**
   * Return the context's validated virtual-file map.
   *
   * @returns Read-only virtual-file map.
   */
  readonly getVirtualFiles = (): ReadonlyMap<AbsolutePath, SourceText> => this.virtualFiles;

  /**
   * Build or retrieve the reverse-import graph for a usage configuration.
   *
   * @param config Usage configuration describing the bounded project.
   * @returns Cached reverse-import graph for the configuration.
   */
  readonly getProjectIndex = (config: UsageTrackerConfig): ImportGraph => {
    const effectiveConfig: UsageTrackerConfig = {
      ...this.config,
      ...config,
      ignorePatterns: config.ignorePatterns ?? this.config.ignorePatterns,
      virtualFiles: config.virtualFiles ?? this.config.virtualFiles,
    };
    const cacheKey = this.createGraphCacheKey(effectiveConfig);
    const cached = this.graphCache.get(cacheKey);

    if (cached !== undefined) {
      return cached;
    }

    const graph = this.indexer.index(effectiveConfig);
    this.graphCache.set(cacheKey, graph);
    return graph;
  };

  /** Build a stable key for one bounded project-index configuration. */
  private readonly createGraphCacheKey = (config: UsageTrackerConfig): SourceText =>
    JSON.stringify({
      projectRoot: config.projectRoot,
      projectFiles: config.projectFiles,
      virtualFiles: Object.entries(config.virtualFiles ?? {}).sort(),
      ignorePatterns: (config.ignorePatterns ?? []).map((pattern) =>
        typeof pattern === "string" ? pattern : pattern.toString(),
      ),
    });
}