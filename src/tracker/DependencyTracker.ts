import { readFileSync } from "node:fs";

import { MagicStringEditor } from "@/edit";
import { moduleCallKey, tryResolveModuleCall, walkAst } from "@/helpers";
import { collectSpecifiers } from "@/helpers/module-boundary";
import { DynamicPatternDetector, IssueCollector } from "@/issues";
import { IntraFunctionShaker } from "@/shake";
import { BackwardSlicer } from "@/slice";
import { FileAnalysisCache } from "@/tracker/FileAnalysisCache";
import { ProjectContext } from "@/tracker/ProjectContext";
import { assembleSlicedOutput, isDependencyNodeKeepWorthy } from "@/tracker/sliceOutput";
import type {
  AbsolutePath,
  IEditor,
  IIssueCollector,
  IParser,
  IResolver,
  IShaker,
  ParsedFile,
  SlicedFile,
  SourceText,
  ModuleResolutionPlugin,
  ModuleResolutionResult,
  TrackRequest,
  TrackResult,
  TrackerConfig,
  TraceCacheStats,
  DependencyFileAnalysis,
  PreparedDependencyProject,
  PreprocessingCacheStats,
} from "@/types";
import { assertNever } from "assert-never";

/**
 * Optional dependency overrides for constructing a DependencyTracker.
 */
type DependencyTrackerDependencies = {
  /** Parser override used primarily by tests. */
  parser?: IParser;
  /** Resolver override used primarily by tests. */
  resolver?: IResolver;
  /** Shaker override used primarily by tests. */
  shaker?: IShaker;
  /** Issue collector override used primarily by tests. */
  issueCollector?: IIssueCollector;
  /** Editor override used primarily by tests. */
  editor?: IEditor;
};

/**
 * Read source text from disk for the provided absolute path.
 *
 * @param absolutePath Absolute file path to read.
 * @returns UTF-8 source text contents of the file.
 */
const readSourceText = (absolutePath: AbsolutePath): SourceText =>
  readFileSync(absolutePath, "utf8");

/**
 * Collect module specifiers declared at module scope for recursive parsing.
 *
 * @param parsedFile Parsed file whose top-level statements are inspected.
 * @returns Unique list of import/re-export specifiers.
 */
const collectModuleSpecifiers = (parsedFile: ParsedFile): SourceText[] => {
  return collectSpecifiers(parsedFile.ast);
};

/**
 * Orchestrates parsing, slicing, and source editing for dependency tracking.
 */
export class DependencyTracker {
  private readonly parsedCache: Map<AbsolutePath, ParsedFile>;
  private readonly virtualFiles: ReadonlyMap<AbsolutePath, SourceText>;
  private readonly parser: IParser;
  private readonly resolver: IResolver;
  private readonly shaker: IShaker;
  private readonly issueCollector: IIssueCollector;
  private readonly dynamicPatternDetector: DynamicPatternDetector;
  private readonly editor: IEditor;
  private readonly slicer: BackwardSlicer;
  private readonly moduleResolutionPlugins: readonly ModuleResolutionPlugin[];
  private readonly moduleResolutionCache: Map<SourceText, ModuleResolutionResult>;
  private readonly preprocessingCache: FileAnalysisCache;
  private readonly patternIssues = new IssueCollector();

  /**
   * Create a dependency tracker with default implementations or injected fakes.
   *
   * @param config Tracker configuration for resolver and ignore behavior.
   * @param dependenciesOrContext Dependency overrides or a shared project context.
   * @param context Shared project context used by this tracker.
   */
  constructor(
    config: TrackerConfig = {},
    dependenciesOrContext: DependencyTrackerDependencies | ProjectContext = {},
    context?: ProjectContext,
  ) {
    const dependencies =
      dependenciesOrContext instanceof ProjectContext ? {} : dependenciesOrContext;
    const sharedContext =
      context ??
      (dependenciesOrContext instanceof ProjectContext
        ? dependenciesOrContext
        : new ProjectContext(config, dependencies.parser, dependencies.resolver));

    this.parser = sharedContext.getParser();
    this.resolver = sharedContext.getResolver();
    this.parsedCache = new Map<AbsolutePath, ParsedFile>();
    this.virtualFiles = sharedContext.getVirtualFiles();
    this.shaker = dependencies.shaker ?? new IntraFunctionShaker();
    this.issueCollector = dependencies.issueCollector ?? new IssueCollector();
    this.dynamicPatternDetector = new DynamicPatternDetector(this.patternIssues);
    this.preprocessingCache = new FileAnalysisCache(config.preprocessingCache);
    this.editor = dependencies.editor ?? new MagicStringEditor();
    this.moduleResolutionPlugins = config.moduleResolutionPlugins ?? [];
    this.moduleResolutionCache = new Map<SourceText, ModuleResolutionResult>();
    this.slicer = new BackwardSlicer(
      this.parser,
      this.resolver,
      this.shaker,
      this.issueCollector,
      this.moduleResolutionPlugins,
      this.moduleResolutionCache,
      config.traceCache,
    );
  }

  /**
   * Inspect computed dependency graph reuse and estimated retained memory.
   * @returns Counters scoped to this tracker and its immutable project context.
   */
  readonly getTraceCacheStats = (): TraceCacheStats => this.slicer.getTraceCacheStats();

  /**
   * Inspect module-discovery and file-wide issue reuse.
   * @returns File analysis cache counters for this tracker.
   */
  readonly getPreprocessingCacheStats = (): PreprocessingCacheStats =>
    this.preprocessingCache.stats();

  /**
   * Execute the dependency tracking pipeline for the provided request.
   *
   * @param request Track request containing entry file and start point.
   * @returns Complete track result including files, nodes, edges, and issues.
   */
  readonly track = async (request: TrackRequest): Promise<TrackResult> => {
    this.issueCollector.clear();

    const prepared = this.collectParsedFiles(request.entryFile);
    const parsedFiles = prepared.files;
    for (const issue of prepared.issues) {
      this.issueCollector.add(issue);
    }
    const sliceResult = this.slicer.slice(
      request.entryFile,
      request.startPoint,
      parsedFiles,
      request.shake !== false,
    );
    const files =
      request.output === undefined
        ? new Map<AbsolutePath, SlicedFile>()
        : assembleSlicedOutput(
            sliceResult.nodes,
            parsedFiles,
            request.output.mode ?? "blank",
            isDependencyNodeKeepWorthy,
            this.editor,
            request.shake === false,
          );

    return {
      files,
      nodes: sliceResult.nodes,
      edges: sliceResult.edges,
      issues: this.issueCollector.getAll(),
    };
  };

  /**
   * Parse entry and recursively resolved module files into one map.
   *
   * @param entryFile Absolute path of the entry file to parse.
   * @returns Parsed-file closure and independent file-wide issues in discovery order.
   */
  private readonly collectParsedFiles = (entryFile: AbsolutePath): PreparedDependencyProject => {
    const parsedFiles = new Map<AbsolutePath, ParsedFile>();
    const issues: PreparedDependencyProject["issues"] = [];
    const queue: AbsolutePath[] = [entryFile];
    // Cursor traversal avoids shifting the remaining queue for every discovered file.
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const nextFile = queue[cursor];

      if (nextFile === undefined) {
        continue;
      }

      if (parsedFiles.has(nextFile)) {
        continue;
      }

      const cached = this.parsedCache.get(nextFile);
      const virtualSource = this.virtualFiles.get(nextFile);
      const parsedFile =
        cached ?? this.parser.parse(nextFile, virtualSource ?? readSourceText(nextFile));

      this.parsedCache.set(nextFile, parsedFile);
      parsedFiles.set(nextFile, parsedFile);

      const analysis = this.analyzeFile(parsedFile);
      issues.push(...structuredClone(analysis.issues));
      for (const [key, result] of analysis.moduleCalls) {
        this.moduleResolutionCache.set(key, result);
      }
      for (const dependency of analysis.dependencies) {
        if (!parsedFiles.has(dependency)) {
          queue.push(dependency);
        }
      }
    }
    return { files: parsedFiles, issues };
  };

  /**
   * Discover module boundaries and file-wide issues once per retained parsed source.
   * @param parsedFile Immutable parsed source.
   * @returns Completed source-derived metadata, including failed plugin decisions.
   */
  private readonly analyzeFile = (parsedFile: ParsedFile): DependencyFileAnalysis => {
    const cached = this.preprocessingCache.read(parsedFile);
    if (cached) {
      return cached;
    }
    const nextFile = parsedFile.absolutePath;
    const dependencies = new Set<AbsolutePath>();
    const moduleCalls: DependencyFileAnalysis["moduleCalls"] = [];
    const specifiers = collectModuleSpecifiers(parsedFile);
    for (const specifier of specifiers) {
      const resolution = this.resolver.resolve(specifier, nextFile);

      switch (resolution.kind) {
        case "resolved":
          dependencies.add(resolution.absolutePath);
          break;
        case "ignored":
          break;
        case "failed":
          break;
        default:
          assertNever(resolution);
      }
    }

    walkAst(parsedFile.ast, (node) => {
      if (node.type !== "CallExpression") {
        return;
      }

      const cacheKey = moduleCallKey(nextFile, node);
      const pluginResult = tryResolveModuleCall(
        node,
        parsedFile.source,
        nextFile,
        this.moduleResolutionPlugins,
      );
      moduleCalls.push([cacheKey, pluginResult]);

      if (pluginResult === null) {
        return;
      }

      const resolution = this.resolver.resolve(pluginResult.specifier, nextFile);
      if (resolution.kind === "resolved") {
        dependencies.add(resolution.absolutePath);
      }
    });
    this.patternIssues.clear();
    this.dynamicPatternDetector.detect(parsedFile.ast, parsedFile.absolutePath, parsedFile);
    const analysis: DependencyFileAnalysis = {
      source: parsedFile.source,
      ast: parsedFile.ast,
      dependencies: [...dependencies],
      moduleCalls,
      issues: this.patternIssues.getAll(),
    };
    this.preprocessingCache.write(nextFile, analysis);
    return analysis;
  };
}
