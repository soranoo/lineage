import { readFileSync } from "node:fs";

import { assertNever } from "assert-never";

import { MagicStringEditor } from "@/edit";
import { moduleCallKey, tryResolveModuleCall, walkAst } from "@/helpers";
import { collectSpecifiers } from "@/helpers/module-boundary";
import { DynamicPatternDetector, IssueCollector } from "@/issues";
import { IntraFunctionShaker } from "@/shake";
import { BackwardSlicer } from "@/slice";
import { assembleSlicedOutput, isDependencyNodeKeepWorthy } from "@/tracker/sliceOutput";
import { ProjectContext } from "@/tracker/ProjectContext";
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
} from "@/types";

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

  /**
   * Create a dependency tracker with default implementations or injected fakes.
   *
   * @param config Tracker configuration for resolver and ignore behavior.
   * @param dependencies Optional dependency overrides used by tests.
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
    this.dynamicPatternDetector = new DynamicPatternDetector(this.issueCollector);
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
    );

  }

  /**
   * Execute the dependency tracking pipeline for the provided request.
   *
   * @param request Track request containing entry file and start point.
   * @returns Complete track result including files, nodes, edges, and issues.
   */
  readonly track = async (request: TrackRequest): Promise<TrackResult> => {
    this.issueCollector.clear();

    const parsedFiles = await this.collectParsedFiles(request.entryFile);
    this.detectDynamicPatterns(parsedFiles);
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
   * @returns Parsed-file map keyed by absolute path.
   */
  private readonly collectParsedFiles = (
    entryFile: AbsolutePath,
  ): Map<AbsolutePath, ParsedFile> => {
    const parsedFiles = new Map<AbsolutePath, ParsedFile>();
    const queue: AbsolutePath[] = [entryFile];

    while (queue.length > 0) {
      const nextFile = queue.shift();

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

      const specifiers = collectModuleSpecifiers(parsedFile);
      for (const specifier of specifiers) {
        const resolution = this.resolver.resolve(specifier, nextFile);

        switch (resolution.kind) {
          case "resolved":
            if (!parsedFiles.has(resolution.absolutePath)) {
              queue.push(resolution.absolutePath);
            }
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
        this.moduleResolutionCache.set(cacheKey, pluginResult);

        if (pluginResult === null) {
          return;
        }

        const resolution = this.resolver.resolve(pluginResult.specifier, nextFile);
        if (resolution.kind === "resolved" && !parsedFiles.has(resolution.absolutePath)) {
          queue.push(resolution.absolutePath);
        }
      });
    }

    return parsedFiles;
  };

  /**
   * Detect dynamic-pattern issues for all parsed files in the current request.
   *
   * @param parsedFiles Parsed files to scan for dynamic patterns.
   */
  private readonly detectDynamicPatterns = (parsedFiles: Map<AbsolutePath, ParsedFile>): void => {
    for (const parsedFile of parsedFiles.values()) {
      this.dynamicPatternDetector.detect(parsedFile.ast, parsedFile.absolutePath, parsedFile);
    }
  };
}
