import type { ArrowFunctionExpression, Function, Node, Program } from "@oxc-project/types";
import type MagicString from "magic-string";
import type { NapiResolveOptions } from "oxc-resolver";

export type { IParser } from "@/parse";
export type { IResolver } from "@/resolve";
export type { IShaker } from "@/shake";
export type { IEditor } from "@/edit";

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
 * Zero-based index of a parameter in a function signature.
 */
export type ParameterIndex = number;

/**
 * One entry from `TrackerConfig.ignorePatterns`.
 */
export type IgnorePattern = string | RegExp;

/**
 * Raw source code text of a JavaScript or TypeScript file.
 */
export type SourceText = string;

/** A name exported by an ECMAScript module. */
export type ExportedName = string;

/** A local binding name used by an importing module. */
export type LocalAlias = string;

/** The syntax used to re-export a module binding. */
export type ReExportKind = "named" | "default" | "namespace" | "export-all";

/** A direct import entry in the project-wide reverse index. */
export type ImporterEntry = {
  /** The entry's direct-import discriminator. */
  kind: "import";
  /** Absolute path of the importing file. */
  importerFile: AbsolutePath;
  /** Exported name requested from the source file. */
  exportedName: ExportedName;
  /** Local binding introduced in the importing file. */
  localAlias: LocalAlias;
};

/** A direct re-export edge in the project-wide reverse index. */
export type ReExportEntry = {
  /** Re-export syntax discriminator. */
  kind: ReExportKind;
  /** Absolute path of the file exposing the re-export. */
  reExporterFile: AbsolutePath;
  /** Absolute path of the ultimate source named by this edge. */
  sourceFile: AbsolutePath;
  /** Name requested from the source file, or `*` for export-all. */
  importedName: ExportedName;
  /** Name exposed by the re-exporting file, or `*` for export-all. */
  exportedName: ExportedName;
};

/**
 * Human-readable label extracted from source for a dependency node.
 */
export type NodeLabel = string;

/** A module specifier accepted by a resolver or module boundary plugin. */
export type ModuleSpecifier = string;

/** A binding exposed by an ESM or CommonJS module boundary. */
export type ExportedBinding = {
  /** Name visible to importers. */
  exportedName: ExportedName;
  /** Local binding that provides the exported value, when known. */
  localName?: LocalAlias;
  /** Source module for a re-exported binding. */
  source?: ModuleSpecifier;
};

/** Kind of module boundary import discovered in a source file. */
export type ModuleBoundaryImportKind = "import" | "re-export";

/** Import or re-export metadata associated with a module specifier. */
export type ModuleBoundaryImport = {
  /** Whether the boundary introduces a local import or re-exports a binding. */
  kind: ModuleBoundaryImportKind;
  /** Module path passed to the resolver. */
  specifier: ModuleSpecifier;
  /** Name requested from the source module. */
  importedName: ExportedName;
  /** Local name introduced by an import. */
  localAlias: LocalAlias;
  /** Name exposed by a re-exporting module. */
  exportedName?: ExportedName;
  /** Re-export syntax used by this boundary. */
  reExportKind?: ReExportKind;
};

/** A stable name used to identify a module-resolution plugin. */
export type ModuleResolutionPluginName = string;

/** A statically known primitive literal passed to a module boundary plugin. */
export type LiteralValue = string | number | boolean;

/** Maximum number of usage nodes a forward traversal may produce. */
export type UsageNodeLimit = number;

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
export type AstNode = Node;

/**
 * AST nodes that are valid slice seed statements or expressions.
 */
export type SeedNode = AstNode & {
  /** Supported seed node discriminants. */
  type:
    | "ReturnStatement"
    | "VariableDeclaration"
    | "ExpressionStatement"
    | "AssignmentExpression"
    | "IfStatement"
    | "SwitchStatement"
    | "WhileStatement"
    | "DoWhileStatement"
    | "ForStatement"
    | "ForInStatement"
    | "ForOfStatement";
};

/**
 * Function node accepted by shaker implementations.
 */
export type FunctionNode = Function | ArrowFunctionExpression;

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
  /**
   * In-memory source files keyed by virtual absolute path.
   *
   * Virtual keys must start with `/`.
   */
  virtualFiles?: Record<AbsolutePath, SourceText>;
  /** Plugins that can resolve non-standard module call patterns. */
  moduleResolutionPlugins?: ModuleResolutionPlugin[];
};

/**
 * Caller-supplied resolution logic for calls whose module target is not a
 * plain string import or require specifier.
 */
export type ModuleResolutionPlugin = {
  /** Name used in issue messages and diagnostics. */
  name: ModuleResolutionPluginName;
  /**
   * Resolves a recognized call into a normal module specifier, or returns
   * null when this plugin does not recognize the call.
   */
  tryResolve: (call: {
    /** Source text of the callee expression. */
    calleeText: SourceText;
    /** Statically known literal arguments. */
    args: readonly LiteralValue[];
    /** Absolute path of the file containing the call. */
    file: AbsolutePath;
  }) => { specifier: ModuleSpecifier } | null;
};

/** Cached result from consulting a module-resolution plugin for one call. */
export type ModuleResolutionResult = { specifier: ModuleSpecifier } | null;

/**
 * Resolver dispatch tier used by `VirtualAwareResolver`.
 */
export type ResolutionTier =
  /** Resolved directly from the virtual file map. */
  | "virtual"
  /** Blocked by ignore pattern matching before real-file resolution. */
  | "ignored"
  /** Delegated to the inner real-file resolver. */
  | "real";

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
  /** Whether to prune statements that do not contribute to returned values. */
  shake?: boolean;
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

/** Configuration for forward usage tracking and its project-wide index. */
export type UsageTrackerConfig = TrackerConfig & {
  /** Root directory recursively scanned for project files. */
  projectRoot?: AbsolutePath;
  /** Explicit allow-list of files to index instead of scanning a root. */
  projectFiles?: AbsolutePath[];
  /** Safety cap for import-graph usage traversal. */
  maxUsageNodes?: UsageNodeLimit;
};

/** Inputs used to enumerate files for a project index. */
export type ProjectScanConfig = {
  /** Root directory recursively scanned for source files. */
  projectRoot?: AbsolutePath;
  /** Explicit files to include instead of discovering from disk. */
  projectFiles?: AbsolutePath[];
  /** In-memory files included without disk access. */
  virtualFiles?: Record<AbsolutePath, SourceText>;
};

/** Input describing the declaration to track forward from. */
export type UsageRequest = {
  /** Absolute path to the file containing the declaration. */
  entryFile: AbsolutePath;
  /** Offset range of the declaration to track. */
  startPoint: OffsetRange;
  /** Optional sliced output configuration. */
  output?: TrackOutputConfig;
};

/** Output returned from a forward usage-tracking request. */
export type UsageResult = {
  /** Sliced source per contributing file. */
  files: Map<AbsolutePath, SlicedFile>;
  /** Flat list of usage nodes across all files. */
  nodes: UsageNode[];
  /** Directed usage edges between nodes. */
  edges: UsageEdge[];
  /** Issues discovered while finding usages. */
  issues: TrackerIssue[];
};

/** A node in the forward usage graph. */
export type UsageNode = {
  /** Stable unique node identifier. */
  id: NodeId;
  /** Absolute path containing the usage. */
  file: AbsolutePath;
  /** Character range of the usage node. */
  range: OffsetRange;
  /** Human-readable source label. */
  label: NodeLabel;
  /** Classification of the usage. */
  kind: UsageKind;
  /** Continuation details for an untraced usage. */
  continuation?: UsageContinuation;
};

/** Classification of a forward usage node. */
export type UsageKind =
  /** The declaration marked as the usage start point. */
  | "start-point"
  /** A direct read of the tracked binding. */
  | "read-reference"
  /** A reassignment of the tracked binding. */
  | "write-reference"
  /** The tracked binding is exported from its file. */
  | "export-boundary"
  /** An importer's local alias for an exported tracked binding. */
  | "import-usage"
  /** A terminal usage whose next location is not automatically followed. */
  | "untraced-continuation";

/** Reason a usage continues without automatic transitive tracking. */
export type UntracedContinuationReason =
  /** A value is assigned to a new or existing binding. */
  | "reassignment"
  /** A value is unpacked through a destructuring pattern. */
  | "destructure"
  /** A value is passed as an argument. */
  | "call-argument"
  /** A value is returned from a function. */
  | "return-value"
  /** A value is written to an object property. */
  | "property-write"
  /** A value is spread into another object or array. */
  | "spread"
  /** A tracked function or callable value is invoked. */
  | "invoked";

/** Details about where a terminal usage may continue. */
export type UsageContinuation = {
  /** Classification of the continuation. */
  reason: UntracedContinuationReason;
  /** Whether the destination cannot be determined statically. */
  opaque: boolean;
  /** Best-effort destination for a non-opaque continuation. */
  continuesAt?: {
    /** Absolute path containing the destination. */
    file: AbsolutePath;
    /** Range of the destination declaration. */
    range: OffsetRange;
    /** Human-readable destination label. */
    label: NodeLabel;
  };
};

/** Directed edge between forward usage nodes. */
export type UsageEdge = {
  /** Source usage node identifier. */
  from: NodeId;
  /** Target usage node identifier. */
  to: NodeId;
  /** Classification of the usage relationship. */
  kind: UsageEdgeKind;
};

/** Classification of a forward usage edge. */
export type UsageEdgeKind =
  /** A usage reads or writes the tracked value. */
  | "read"
  /** An importer uses an exported tracked value. */
  | "import"
  /** A value continues toward another known location. */
  | "continuation";

/**
 * Slice result produced by the backward slicer before assembly.
 */
export type SliceResult = {
  /** Flat list of dependency nodes across all files. */
  nodes: DependencyNode[];
  /** Directed dependency edges between nodes. */
  edges: DependencyEdge[];
  /** Visited node IDs to prevent reprocessing. */
  visitedRanges: Set<NodeId>;
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
 * Worklist classification for binding resolution in the slicer.
 */
export type BindingKind =
  /** A local variable binding inside a function or block scope. */
  | "local-variable"
  /** A function declaration or expression binding. */
  | "function"
  /** A parameter binding inside a function signature. */
  | "parameter"
  /** An import specifier resolved to a project file. */
  | "import-resolved"
  /** An import specifier resolved to an ignored file. */
  | "import-ignored"
  /** An import specifier that failed to resolve. */
  | "import-failed"
  /** A module-scope (global) declaration was found. */
  | "global-found"
  /** A module-scope (global) declaration was missing. */
  | "global-missing"
  /** A re-export specifier to follow to its source file. */
  | "re-export";

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
  | "this-call"
  /** `require(expr)` — module target unknown statically. */
  | "dynamic-require"
  /** Forward traversal reached its configured safety cap. */
  | "usage-cap-reached"
  /** A call target could not be resolved by normal or plugin logic. */
  | "unresolved-call-target";

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
   *
   * @param issue Issue entry to record.
   */
  readonly add: (issue: TrackerIssue) => void;

  /**
   * Returns a shallow copy of all collected issues.
   *
   * @returns A new array containing all collected issues.
   */
  readonly getAll: () => TrackerIssue[];

  /**
   * Clears all collected issues.
   */
  readonly clear: () => void;
}

/**
 * Thrown when a start-point range does not map to any AST node.
 */
export class StartPointNotFoundError extends Error {
  /** Absolute path to the file that was searched. */
  readonly file: AbsolutePath;
  /** Requested offset range that could not be resolved. */
  readonly requestedRange: OffsetRange;

  /**
   * Create a start-point-not-found error with the requested range details.
   *
   * @param file Absolute path of the file that was searched.
   * @param requestedRange Start-point range that could not be resolved.
   */
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

  /**
   * Create a parse error with the raw parser errors attached.
   *
   * @param file Absolute path of the file that failed to parse.
   * @param oxcErrors Raw error list returned by oxc-parser.
   */
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

  /**
   * Create a cyclic-resolution error with the cycle path.
   *
   * @param cycle Ordered list of absolute paths that form the cycle.
   */
  constructor(cycle: AbsolutePath[]) {
    super("Cyclic resolution detected.");
    this.name = "CyclicResolutionError";
    this.cycle = cycle;
  }
}

/**
 * Thrown when a virtual file key is not an absolute virtual path.
 */
export class InvalidVirtualPathError extends Error {
  /** Offending virtual key supplied by the caller. */
  readonly invalidPath: AbsolutePath;

  /**
   * Create an invalid-virtual-path error with the offending key.
   *
   * @param invalidPath Virtual file key that is not absolute.
   */
  constructor(invalidPath: AbsolutePath) {
    super(`Virtual file path must start with '/': ${invalidPath}`);
    this.name = "InvalidVirtualPathError";
    this.invalidPath = invalidPath;
  }
}
