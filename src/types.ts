import type { Program } from "@oxc-project/types";
import type MagicString from "magic-string";
import type { NapiResolveOptions } from "oxc-resolver";

export type { IParser } from "@/parse/Parser";
export type { IResolver } from "@/resolve/Resolver";

/**
 * An absolute file system path starting with `/`.
 */
export type AbsolutePath = string;

/**
 * A stable unique identifier for a `DependencyNode`.
 * Format: `"<absolutePath>:<start>:<end>"`.
 */
export type NodeId = string;

/**
 * A 0-based character offset into a source string.
 */
export type CharOffset = number;

/**
 * A 1-based line number within a source string.
 */
export type LineNumber = number;

/**
 * A 1-based column number within a source string.
 */
export type ColumnNumber = number;

/**
 * One entry from `TrackerConfig.ignorePatterns`.
 */
export type IgnorePattern = string | RegExp;

/**
 * Raw source code text of a JavaScript or TypeScript file.
 */
export type SourceText = string;

/**
 * Human-readable label extracted from source for a dependency node.
 */
export type NodeLabel = string;

/**
 * Human-readable issue message for a tracker issue.
 */
export type IssueMessage = string;

/**
 * Oxc parser AST root type.
 */
export type OxcAst = Program;

/**
 * Oxc AST node type accepted by detector and slicer helpers.
 */
export type AstNode = Program;

/**
 * Options forwarded to `oxc-resolver`.
 */
export type OxcResolverOptions = NapiResolveOptions;

/**
 * Output mode for sliced source generation.
 */
export type OutputMode =
  /** Overwrite non-dependency ranges with spaces (offsets preserved). */
  | "blank"
  /** Remove non-dependency ranges entirely (offsets shift). */
  | "compact";

/**
 * Conservative action taken when an issue is detected.
 */
export type IssueResolution =
  /** Include the node despite uncertainty. */
  | "included"
  /** Keep the node as a non-recursed leaf. */
  | "leaf"
  /** Record the issue but do not change the slice. */
  | "flagged-only";

/**
 * A half-open character offset range within a source file.
 * `start` is inclusive and 0-based; `end` is exclusive.
 */
export type OffsetRange = {
  /** Inclusive start offset, 0-based. */
  start: CharOffset;
  /** Exclusive end offset, 0-based. */
  end: CharOffset;
};

/**
 * Configuration passed to `DependencyTracker`.
 */
export type TrackerConfig = {
  /**
   * Options forwarded verbatim to `oxc-resolver`.
   */
  resolver?: OxcResolverOptions;
  /**
   * Paths/patterns to treat as ignored leaves.
   *
   * - `string`: `absolutePath.includes(pattern)`
   * - `RegExp`: `pattern.test(absolutePath)`
   */
  ignorePatterns?: Array<IgnorePattern>;
};

/**
 * Output configuration for a single tracking request.
 */
export type TrackOutputConfig = {
  /**
   * Output mode for the sliced source.
   */
  mode?: OutputMode;
};

/**
 * Per-request input to `DependencyTracker.track()`.
 */
export type TrackRequest = {
  /** Absolute path to the file containing the start point. */
  entryFile: AbsolutePath;
  /** Character offset range of the start-point node. */
  startPoint: OffsetRange;
  /** Optional output configuration for sliced source. */
  output?: TrackOutputConfig;
};

/**
 * Output returned from `DependencyTracker.track()`.
 */
export type TrackResult = {
  /** Sliced source per contributing file. */
  files: Map<AbsolutePath, SlicedFile>;
  /** Flat list of dependency nodes across all files. */
  nodes: DependencyNode[];
  /** Directed dependency edges between nodes. */
  edges: DependencyEdge[];
  /** Issues discovered during slicing. */
  issues: TrackerIssue[];
};

/**
 * Sliced representation of a single file.
 */
export type SlicedFile = {
  /** Absolute file path. */
  path: AbsolutePath;
  /** Edited MagicString wrapper. */
  ms: MagicString;
  /** Original, unmodified source. */
  originalSource: SourceText;
};

/**
 * A single dependency node included in the slice.
 */
export type DependencyNode = {
  /** Unique stable node ID. */
  id: NodeId;
  /** Absolute file path containing the node. */
  file: AbsolutePath;
  /** Character offset range of the node. */
  range: OffsetRange;
  /** Human-readable label extracted from source. */
  label: NodeLabel;
  /** Node classification. */
  kind: DependencyKind;
  /** True if the node was tree-shaken inside a dependency function. */
  shaken: boolean;
};

/**
 * Classifies the kind of dependency node.
 */
export type DependencyKind =
  /** The marked start-point node. */
  | "start-point"
  /** A variable declaration or binding. */
  | "variable"
  /** A function parameter binding. */
  | "parameter"
  /** A function declaration or expression. */
  | "function"
  /** A call expression within a dependency function. */
  | "call-site"
  /** An import declaration. */
  | "import"
  /** A module-level (global) declaration. */
  | "global"
  /** A re-exported binding. */
  | "re-export"
  /** A resolved import whose file matched an ignore pattern. */
  | "ignored-leaf"
  /** A binding that could not be resolved. */
  | "unresolved-leaf";

/**
 * Directed edge between dependency nodes.
 */
export type DependencyEdge = {
  /** Source node ID. */
  from: NodeId;
  /** Target node ID. */
  to: NodeId;
  /** Edge classification. */
  kind: EdgeKind;
};

/**
 * Classifies the kind of dependency edge.
 */
export type EdgeKind =
  /** Value of `from` is read by `to`. */
  | "data-flow"
  /** `to` calls `from`. */
  | "call"
  /** Call argument binds to parameter. */
  | "param-bind"
  /** `to` closes over `from`. */
  | "closure"
  /** `to` imports `from`. */
  | "import";

/**
 * Issue discovered during slicing.
 */
export type TrackerIssue = {
  /** Issue classification. */
  kind: IssueKind;
  /** Human-readable description. */
  message: IssueMessage;
  /** Absolute file path where the issue occurred. */
  file: AbsolutePath;
  /** Character offset range of the issue. */
  range: OffsetRange;
  /** Conservative action taken for the issue. */
  resolution: IssueResolution;
  /** Matched ignore pattern, when applicable. */
  matchedPattern?: IgnorePattern;
};

/**
 * Classifies the kind of tracker issue.
 */
export type IssueKind =
  /** Binding not found in any provided or resolvable file. */
  | "unresolved-dependency"
  /** Resolved file matched an ignore pattern. */
  | "ignored-path"
  /** `import(expr)` — target unknown statically. */
  | "dynamic-import"
  /** `obj[expr]` — property name unknown statically. */
  | "computed-property"
  /** `eval(...)` — unbounded side effects. */
  | "eval"
  /** Use of `arguments` — parameter count unknown. */
  | "arguments-object"
  /** `...spread` of unknown shape. */
  | "rest-spread-unknown"
  /** `const f = getFn(); f()` indirect call. */
  | "indirect-call"
  /** `Foo.prototype.x =` — may affect instances. */
  | "prototype-mutation"
  /** `this.method()` — receiver unknown statically. */
  | "this-call";

/**
 * Discriminated union describing the outcome of resolving an import specifier.
 */
export type ResolveResult =
  | {
      /** Specifier resolved to a project file. */
      kind: "resolved";
      /** Absolute path to the resolved file. */
      absolutePath: AbsolutePath;
    }
  | {
      /** Resolved path matched an ignore pattern. */
      kind: "ignored";
      /** Absolute path to the resolved file. */
      absolutePath: AbsolutePath;
      /** Pattern that caused the match. */
      matchedPattern: IgnorePattern;
    }
  | {
      /** Specifier could not be resolved. */
      kind: "failed";
    };

/**
 * Parsed source file cached by the parser layer.
 */
export type ParsedFile = {
  /** Absolute path to the file. */
  absolutePath: AbsolutePath;
  /** Parsed AST returned by the parser. */
  ast: OxcAst;
  /** Original source text. */
  source: SourceText;
};

/**
 * Collects tracker issues in insertion order.
 */
export interface IIssueCollector {
  /**
   * Appends `issue` to the internal list.
   */
  readonly add: (issue: TrackerIssue) => void;

  /**
   * Returns a shallow copy of all collected issues.
   */
  readonly getAll: () => TrackerIssue[];

  /**
   * Clears all collected issues.
   */
  readonly clear: () => void;
}

/**
 * Shakes unused statements inside a function body.
 */
export interface IShaker {
  /**
   * Returns the set of ranges that should be removed or blanked.
   */
  readonly shake: (fn: unknown, source: SourceText) => Set<OffsetRange>;
}

/**
 * Edits a MagicString based on keep/remove ranges.
 */
export interface IEditor {
  /**
   * Applies edits to the provided MagicString in-place.
   */
  readonly apply: (
    ms: MagicString,
    source: SourceText,
    keepRanges: Set<OffsetRange>,
    mode: OutputMode,
  ) => void;
}

/**
 * Thrown when a start-point range does not map to any AST node.
 */
export class StartPointNotFoundError extends Error {
  /** Absolute path to the file that was searched. */
  readonly file: AbsolutePath;
  /** Requested offset range that could not be resolved. */
  readonly requestedRange: OffsetRange;

  constructor(file: AbsolutePath, requestedRange: OffsetRange) {
    super(`Start point not found in ${file}.`);
    this.name = "StartPointNotFoundError";
    this.file = file;
    this.requestedRange = requestedRange;
  }
}

/**
 * Thrown when `oxc-parser` reports syntax errors.
 */
export class ParseError extends Error {
  /** Absolute path to the file that failed to parse. */
  readonly file: AbsolutePath;
  /** Raw parser errors from `oxc-parser`. */
  readonly oxcErrors: unknown[];

  constructor(file: AbsolutePath, oxcErrors: unknown[]) {
    super(`Parse error in ${file}.`);
    this.name = "ParseError";
    this.file = file;
    this.oxcErrors = oxcErrors;
  }
}

/**
 * Thrown when a cyclic import or resolution chain is detected.
 */
export class CyclicResolutionError extends Error {
  /** Ordered list of absolute paths that form the cycle. */
  readonly cycle: AbsolutePath[];

  constructor(cycle: AbsolutePath[]) {
    super("Cyclic resolution detected.");
    this.name = "CyclicResolutionError";
    this.cycle = cycle;
  }
}
