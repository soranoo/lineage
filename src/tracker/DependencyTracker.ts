import { readFileSync } from "node:fs";

import { assertNever } from "assert-never";
import MagicString from "magic-string";

import type {
  AbsolutePath,
  AstNode,
  DependencyNode,
  IEditor,
  IIssueCollector,
  IParser,
  IResolver,
  IShaker,
  OffsetRange,
  OutputMode,
  ParsedFile,
  SlicedFile,
  SourceText,
  TrackRequest,
  TrackResult,
  TrackerConfig,
} from "@/types";

import { MagicStringEditor } from "@/edit/MagicStringEditor";
import { walkAst } from "@/helpers/ast-walker";
import { IssueCollector } from "@/issues/IssueCollector";
import { DynamicPatternDetector } from "@/issues/DynamicPatternDetector";
import { OxcParser } from "@/parse/OxcParser";
import { IgnoreFilter } from "@/resolve/IgnoreFilter";
import { OxcResolver } from "@/resolve/OxcResolver";
import { VirtualAwareResolver } from "@/resolve/VirtualAwareResolver";
import { IntraFunctionShaker } from "@/shake/IntraFunctionShaker";
import { BackwardSlicer } from "@/slice/BackwardSlicer";
import { InvalidVirtualPathError } from "@/types";

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
 * Validate and materialize configured virtual files as a map.
 *
 * @param virtualFiles Optional virtual file record from tracker config.
 * @returns Map keyed by absolute virtual path.
 * @throws {InvalidVirtualPathError} When any key does not start with `/`.
 */
const toVirtualFileMap = (
  virtualFiles: Record<AbsolutePath, SourceText> | undefined,
): Map<AbsolutePath, SourceText> => {
  const map = new Map<AbsolutePath, SourceText>();

  if (virtualFiles === undefined) {
    return map;
  }

  for (const [filePath, source] of Object.entries(virtualFiles)) {
    if (!filePath.startsWith("/")) {
      throw new InvalidVirtualPathError(filePath);
    }

    map.set(filePath, source);
  }

  return map;
};

/**
 * Convert a virtual file map back into a plain record for resolver construction.
 *
 * @param virtualFiles Virtual file map keyed by absolute path.
 * @returns Virtual file record keyed by absolute path.
 */
const toVirtualFileRecord = (
  virtualFiles: ReadonlyMap<AbsolutePath, SourceText>,
): Record<AbsolutePath, SourceText> => {
  const record: Record<AbsolutePath, SourceText> = {};

  for (const [filePath, source] of virtualFiles) {
    record[filePath] = source;
  }

  return record;
};

/**
 * Parse and cache all configured virtual files before the first track call.
 *
 * @param parser Parser used to build parsed-file objects.
 * @param parsedCache Tracker-level parsed-file cache.
 * @param virtualFiles Virtual files to pre-populate.
 */
const prepopulateVirtualParsedFiles = (
  parser: IParser,
  parsedCache: Map<AbsolutePath, ParsedFile>,
  virtualFiles: ReadonlyMap<AbsolutePath, SourceText>,
): void => {
  for (const [filePath, source] of virtualFiles) {
    const parsedFile = parser.parse(filePath, source);
    parsedCache.set(filePath, parsedFile);
  }
};

/**
 * Collect module specifiers declared at module scope for recursive parsing.
 *
 * @param parsedFile Parsed file whose top-level statements are inspected.
 * @returns Unique list of import/re-export specifiers.
 */
const collectModuleSpecifiers = (parsedFile: ParsedFile): SourceText[] => {
  const specifiers = new Set<SourceText>();

  for (const statement of parsedFile.ast.body) {
    switch (statement.type) {
      case "ImportDeclaration":
        specifiers.add(statement.source.value);
        break;
      case "ExportNamedDeclaration":
        if (statement.source !== null) {
          specifiers.add(statement.source.value);
        }
        break;
      case "ExportAllDeclaration":
        specifiers.add(statement.source.value);
        break;
      default:
        break;
    }
  }

  return [...specifiers];
};

/**
 * Build a deduplicated set of keep ranges from dependency nodes for one file.
 *
 * @param ranges Raw node ranges to keep.
 * @returns Keep-range set compatible with the editor interface.
 */
const buildKeepRangeSet = (ranges: OffsetRange[]): Set<OffsetRange> => {
  const byKey = new Map<SourceText, OffsetRange>();

  for (const range of ranges) {
    const key: SourceText = `${range.start}:${range.end}`;
    byKey.set(key, range);
  }

  return new Set(byKey.values());
};

/**
 * Check whether a container node fully contains a target range.
 *
 * @param container Node that may contain the range.
 * @param range Range to test.
 * @returns True when the range is inside the container.
 */
const containsRange = (container: AstNode, range: OffsetRange): boolean =>
  container.start <= range.start && container.end >= range.end;

/**
 * Check whether a node can define a keep-range boundary.
 *
 * @param node AST node to inspect.
 * @returns True when the node is a statement/declaration boundary.
 */
const isKeepBoundaryNode = (node: AstNode): boolean => {
  if (node.type.endsWith("Statement") || node.type.endsWith("Declaration")) {
    return true;
  }

  return false;
};

/**
 * Select the smallest node span from a non-empty candidate list.
 *
 * @param candidates Candidate nodes.
 * @returns Smallest-span node.
 */
const selectSmallestNode = (candidates: AstNode[]): AstNode => {
  const [first, ...rest] = candidates;

  if (first === undefined) {
    throw new Error("Expected at least one AST node candidate.");
  }

  let smallest = first;

  for (const node of rest) {
    const smallestSize = smallest.end - smallest.start;
    const nodeSize = node.end - node.start;

    if (nodeSize < smallestSize) {
      smallest = node;
    }
  }

  return smallest;
};

/**
 * Expand a dependency-node range to its nearest statement/declaration boundary.
 *
 * @param ast AST root for the current file.
 * @param range Dependency-node range.
 * @returns Expanded statement/declaration range when found; otherwise original range.
 */
const expandRangeToBoundary = (ast: AstNode, range: OffsetRange): OffsetRange => {
  const boundaryMatches: AstNode[] = [];
  const exportMatches: AstNode[] = [];

  walkAst(ast, (node) => {
    if (!isKeepBoundaryNode(node) || !containsRange(node, range)) {
      return;
    }

    boundaryMatches.push(node);

    if (
      node.type === "ExportNamedDeclaration" ||
      node.type === "ExportDefaultDeclaration" ||
      node.type === "ExportAllDeclaration"
    ) {
      exportMatches.push(node);
    }
  });

  if (exportMatches.length > 0) {
    const selectedExport = selectSmallestNode(exportMatches);
    return { start: selectedExport.start, end: selectedExport.end };
  }

  if (boundaryMatches.length === 0) {
    return { start: range.start, end: range.end };
  }

  const selectedBoundary = selectSmallestNode(boundaryMatches);
  return { start: selectedBoundary.start, end: selectedBoundary.end };
};

/**
 * Determine whether a dependency node should contribute to output keep ranges.
 *
 * @param node Dependency node to evaluate.
 * @returns True when the node should preserve output text.
 */
const shouldKeepNodeForOutput = (node: DependencyNode): boolean => {
  switch (node.kind) {
    case "parameter":
      return false;
    case "start-point":
    case "variable":
    case "function":
    case "call-site":
    case "import":
    case "global":
    case "re-export":
    case "ignored-leaf":
    case "unresolved-leaf":
      return true;
    default:
      return assertNever(node.kind);
  }
};

/**
 * Convert dependency nodes into output keep ranges.
 *
 * @param nodes Dependency nodes from one file.
 * @param parsedFile Parsed file of the current source file.
 * @returns Keep ranges used by the editor.
 */
const toOutputKeepRanges = (nodes: DependencyNode[], parsedFile: ParsedFile): Set<OffsetRange> => {
  const ranges = nodes
    .filter((node) => node.shaken === false && shouldKeepNodeForOutput(node))
    .map((node) => expandRangeToBoundary(parsedFile.ast, node.range));

  return buildKeepRangeSet(ranges);
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

  /**
   * Create a dependency tracker with default implementations or injected fakes.
   *
   * @param config Tracker configuration for resolver and ignore behavior.
   * @param dependencies Optional dependency overrides used by tests.
   */
  constructor(config: TrackerConfig = {}, dependencies: DependencyTrackerDependencies = {}) {
    const ignoreFilter = new IgnoreFilter(config.ignorePatterns ?? []);
    const virtualFiles = toVirtualFileMap(config.virtualFiles);
    const oxcResolver = new OxcResolver(ignoreFilter, config.resolver);
    const defaultResolver: IResolver =
      virtualFiles.size > 0
        ? new VirtualAwareResolver(toVirtualFileRecord(virtualFiles), ignoreFilter, oxcResolver)
        : oxcResolver;

    this.parsedCache = new Map<AbsolutePath, ParsedFile>();
    this.virtualFiles = virtualFiles;
    this.parser = dependencies.parser ?? new OxcParser();
    this.resolver = dependencies.resolver ?? defaultResolver;
    this.shaker = dependencies.shaker ?? new IntraFunctionShaker();
    this.issueCollector = dependencies.issueCollector ?? new IssueCollector();
    this.dynamicPatternDetector = new DynamicPatternDetector(this.issueCollector);
    this.editor = dependencies.editor ?? new MagicStringEditor();
    this.slicer = new BackwardSlicer(this.parser, this.resolver, this.shaker, this.issueCollector);

    prepopulateVirtualParsedFiles(this.parser, this.parsedCache, this.virtualFiles);
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
    const sliceResult = this.slicer.slice(request.entryFile, request.startPoint, parsedFiles);
    const mode = this.resolveOutputMode(request);
    const files = this.buildSlicedFiles(sliceResult.nodes, parsedFiles, mode);

    return {
      files,
      nodes: sliceResult.nodes,
      edges: sliceResult.edges,
      issues: this.issueCollector.getAll(),
    };
  };

  /**
   * Resolve the effective output mode for a tracking request.
   *
   * @param request Track request whose output mode is inspected.
   * @returns Explicit request mode when present, otherwise blank mode.
   */
  private readonly resolveOutputMode = (request: TrackRequest): OutputMode => {
    const mode = request.output?.mode;

    switch (mode) {
      case undefined:
        return "blank";
      case "blank":
        return "blank";
      case "compact":
        return "compact";
      default:
        return assertNever(mode);
    }
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
    }

    return parsedFiles;
  };

  /**
   * Build edited file outputs for files that contributed dependency nodes.
   *
   * @param nodes Dependency nodes produced by slicing.
   * @param parsedFiles Parsed files available for source lookups.
   * @param mode Output mode for edit behavior.
   * @returns Map of sliced files keyed by absolute path.
   */
  private readonly buildSlicedFiles = (
    nodes: DependencyNode[],
    parsedFiles: Map<AbsolutePath, ParsedFile>,
    mode: OutputMode,
  ): Map<AbsolutePath, SlicedFile> => {
    const files = new Map<AbsolutePath, SlicedFile>();
    const nodesByFile = new Map<AbsolutePath, DependencyNode[]>();

    for (const node of nodes) {
      const existing = nodesByFile.get(node.file);

      if (existing === undefined) {
        nodesByFile.set(node.file, [node]);
        continue;
      }

      existing.push(node);
    }

    for (const [file, fileNodes] of nodesByFile) {
      const parsedFile = parsedFiles.get(file);

      if (parsedFile === undefined) {
        continue;
      }

      const keepRanges = toOutputKeepRanges(fileNodes, parsedFile);
      const ms = new MagicString(parsedFile.source);
      this.editor.apply(ms, parsedFile.source, keepRanges, mode);

      files.set(file, {
        path: file,
        ms,
        originalSource: parsedFile.source,
      });
    }

    return files;
  };

  /**
   * Detect dynamic-pattern issues for all parsed files in the current request.
   *
   * @param parsedFiles Parsed files to scan for dynamic patterns.
   */
  private readonly detectDynamicPatterns = (parsedFiles: Map<AbsolutePath, ParsedFile>): void => {
    for (const parsedFile of parsedFiles.values()) {
      this.dynamicPatternDetector.detect(parsedFile.ast, parsedFile.absolutePath);
    }
  };
}
