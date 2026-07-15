import { assertNever } from "assert-never";
import { visitorKeys } from "oxc-parser";

import type { CallExpression } from "@oxc-project/types";

import type {
  AbsolutePath,
  AstNode,
  BindingKind,
  DependencyEdge,
  DependencyKind,
  DependencyNode,
  EdgeKind,
  FunctionNode,
  IIssueCollector,
  IssueKind,
  IssueResolution,
  NodeId,
  OffsetRange,
  ParsedFile,
  ResolveResult,
  SeedNode,
  SliceResult,
  SourceText,
} from "@/types";
import type { IParser, IResolver, IShaker } from "@/types";

import { isAstNode, walkAst } from "@/helpers/ast-walker";
import { BindingResolver } from "@/slice/BindingResolver";
import { SeedExpander } from "@/slice/SeedExpander";
import { StartPointNotFoundError } from "@/types";

/**
 * Work item representing a named binding lookup.
 */
type IdentifierWorkItem = {
  /** Work item classification. */
  kind: "identifier";
  /** Binding name to resolve. */
  name: SourceText;
  /** File containing the reference. */
  file: AbsolutePath;
  /** AST node representing lookup context. */
  scopeNode: AstNode;
  /** AST node where the reference appears. */
  referenceNode: AstNode;
  /** Owning dependency node ID for edge creation. */
  ownerNodeId: NodeId;
  /** Edge kind to use when linking the dependency. */
  edgeKind: EdgeKind;
  /** Call expression when the reference is a callee. */
  callSite?: CallExpression;
  /** True when the owner is a nested function (closure edge candidates). */
  ownerIsNestedFunction: boolean;
};

/**
 * Work item representing a direct function node dependency.
 */
type InlineFunctionWorkItem = {
  /** Work item classification. */
  kind: "inline-function";
  /** Function node to process. */
  node: FunctionNode;
  /** File containing the function. */
  file: AbsolutePath;
  /** AST node representing lookup context. */
  scopeNode: AstNode;
  /** Owning dependency node ID for edge creation. */
  ownerNodeId: NodeId;
  /** Edge kind to use when linking the dependency. */
  edgeKind: EdgeKind;
  /** True when the owner is a nested function (closure edge candidates). */
  ownerIsNestedFunction: boolean;
};

/**
 * Worklist entry for the backward slicer.
 */
type WorkItem = IdentifierWorkItem | InlineFunctionWorkItem;

/**
 * Export lookup result for a specific name.
 */
type ExportLookup =
  | {
      /** Indicates a direct declaration export. */
      kind: "declaration";
      /** Declared AST node to use as the binding. */
      node: AstNode;
    }
  | {
      /** Indicates a re-exported binding to follow. */
      kind: "re-export";
      /** Export declaration node to record as a re-export node. */
      node: AstNode;
      /** Source specifier for the re-export. */
      source: SourceText;
      /** Local name to resolve in the re-export target. */
      localName: SourceText;
    };

/**
 * Check whether a value is a function AST node.
 *
 * @param node AST node to inspect.
 * @returns True when the node is a function expression or declaration.
 */
const isFunctionNode = (node: AstNode): node is FunctionNode =>
  node.type === "FunctionDeclaration" ||
  node.type === "FunctionExpression" ||
  node.type === "ArrowFunctionExpression" ||
  node.type === "TSDeclareFunction" ||
  node.type === "TSEmptyBodyFunctionExpression";

/**
 * Build a stable node ID from file and range.
 *
 * @param file Absolute file path containing the node.
 * @param range Node range in the source file.
 * @returns Stable node ID string.
 */
const buildNodeId = (file: AbsolutePath, range: OffsetRange): NodeId =>
  `${file}:${range.start}:${range.end}`;

/**
 * Convert a node to its offset range.
 *
 * @param node AST node to convert.
 * @returns Offset range matching the node span.
 */
const rangeFromNode = (node: AstNode): OffsetRange => ({ start: node.start, end: node.end });

/**
 * Extract a label for a node from source text.
 *
 * @param source Source text containing the node.
 * @param range Range of the node within the source.
 * @returns Label slice for the node.
 */
const extractLabel = (source: SourceText, range: OffsetRange): SourceText =>
  source.slice(range.start, range.end);

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
 * Find the smallest node containing the target range.
 *
 * @param root Root AST node to search.
 * @param range Range to locate.
 * @returns Smallest containing node or null when none found.
 */
const findSmallestContainingNode = (root: AstNode, range: OffsetRange): AstNode | null => {
  let match: AstNode | null = null;

  walkAst(root, (node) => {
    if (!containsRange(node, range)) {
      return;
    }

    if (!match) {
      match = node;
      return;
    }

    const matchSize = match.end - match.start;
    const nodeSize = node.end - node.start;

    if (nodeSize < matchSize) {
      match = node;
    }
  });

  return match;
};

/**
 * Check whether an AST node can serve as a seed statement.
 *
 * @param node Node to inspect.
 * @returns True when the node is a supported seed node.
 */
const isSeedNode = (node: AstNode): node is SeedNode =>
  node.type === "ReturnStatement" ||
  node.type === "VariableDeclaration" ||
  node.type === "ExpressionStatement" ||
  node.type === "IfStatement" ||
  node.type === "SwitchStatement" ||
  node.type === "WhileStatement" ||
  node.type === "DoWhileStatement" ||
  node.type === "ForStatement" ||
  node.type === "ForInStatement" ||
  node.type === "ForOfStatement";

/**
 * Locate the seed node and optional sub-expression range from a start point.
 *
 * @param parsedFile Parsed file containing the start point.
 * @param startPoint Start-point range to locate.
 * @returns Seed node and optional sub-expression range.
 * @throws {StartPointNotFoundError} When no seed statement is found.
 */
const findSeedNode = (
  parsedFile: ParsedFile,
  startPoint: OffsetRange,
): { seedNode: SeedNode; subExprRange: OffsetRange | null } => {
  const root = parsedFile.ast;
  const innerNode = findSmallestContainingNode(root, startPoint);

  if (!innerNode) {
    throw new StartPointNotFoundError(parsedFile.absolutePath, startPoint);
  }

  const seedCandidates: SeedNode[] = [];

  walkAst(root, (node) => {
    if (!containsRange(node, startPoint)) {
      return;
    }

    if (!isSeedNode(node)) {
      return;
    }

    seedCandidates.push(node);
  });

  if (seedCandidates.length === 0) {
    throw new StartPointNotFoundError(parsedFile.absolutePath, startPoint);
  }

  const [firstSeedNode, ...otherSeedNodes] = seedCandidates;

  if (!firstSeedNode) {
    throw new StartPointNotFoundError(parsedFile.absolutePath, startPoint);
  }

  let selectedSeedNode: SeedNode = firstSeedNode;

  for (const candidate of otherSeedNodes) {
    const currentSize = selectedSeedNode.end - selectedSeedNode.start;
    const nextSize = candidate.end - candidate.start;

    if (nextSize < currentSize) {
      selectedSeedNode = candidate;
    }
  }

  const subExprRange =
    innerNode.start === selectedSeedNode.start && innerNode.end === selectedSeedNode.end
      ? null
      : { start: innerNode.start, end: innerNode.end };

  return { seedNode: selectedSeedNode, subExprRange };
};

/**
 * Walk an AST subtree with optional child-skip logic.
 *
 * @param root Root AST node to traverse.
 * @param visit Callback invoked for each node.
 * @param shouldSkipChildren Callback to skip traversing node children.
 */
const walkAstWithSkip = (
  root: AstNode,
  visit: (node: AstNode, parent: AstNode | null) => void,
  shouldSkipChildren: (node: AstNode) => boolean,
): void => {
  const seen = new Set<AstNode>();

  const traverse = (node: AstNode, parent: AstNode | null): void => {
    if (seen.has(node)) {
      return;
    }

    seen.add(node);
    visit(node, parent);

    if (shouldSkipChildren(node)) {
      return;
    }

    const keys = visitorKeys[node.type];

    if (!keys) {
      return;
    }

    for (const key of keys) {
      if (key === "parent") {
        continue;
      }

      const value = Reflect.get(node, key);

      if (Array.isArray(value)) {
        for (const entry of value) {
          if (isAstNode(entry)) {
            traverse(entry, node);
          }
        }
        continue;
      }

      if (isAstNode(value)) {
        traverse(value, node);
      }
    }
  };

  traverse(root, null);
};

/**
 * Check whether an identifier node represents a reference (not a binding).
 *
 * @param node Identifier node to inspect.
 * @param parent Parent AST node of the identifier.
 * @returns True when the identifier represents a read/reference.
 */
const isReferenceIdentifier = (node: AstNode, parent: AstNode | null): boolean => {
  if (parent === null) {
    return true;
  }

  switch (parent.type) {
    case "VariableDeclarator":
      return parent.id !== node;
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
    case "TSDeclareFunction":
    case "TSEmptyBodyFunctionExpression":
      if (parent.id === node) {
        return false;
      }
      return !parent.params.some((param) => param === node);
    case "ImportSpecifier":
    case "ImportDefaultSpecifier":
    case "ImportNamespaceSpecifier":
      return parent.local !== node;
    case "ClassDeclaration":
    case "ClassExpression":
      return parent.id !== node;
    case "Property":
      return !(parent.key === node && parent.computed === false);
    case "MemberExpression":
      return !(parent.property === node && parent.computed === false);
    case "AssignmentExpression":
      return parent.left !== node;
    case "UpdateExpression":
      return parent.argument !== node;
    case "ExportSpecifier":
      return parent.local !== node && parent.exported !== node;
    case "CatchClause":
      return parent.param !== node;
    default:
      return true;
  }
};

/**
 * Identifier dependency extracted from an expression.
 */
type IdentifierDependency = {
  /** Identifier name. */
  name: SourceText;
  /** Identifier node reference. */
  node: AstNode;
  /** Edge kind for the dependency. */
  edgeKind: EdgeKind;
  /** Call site when the identifier is a callee. */
  callSite?: CallExpression;
};

/**
 * Collect identifier dependencies from a subtree.
 *
 * @param root AST node to scan.
 * @param range Optional range to constrain identifiers.
 * @param skipNestedFunctions Skip traversal into nested function bodies.
 * @returns Ordered list of identifier dependencies.
 */
const collectIdentifierDependencies = (
  root: AstNode,
  range: OffsetRange | null,
  skipNestedFunctions: boolean,
): IdentifierDependency[] => {
  const dependencies: IdentifierDependency[] = [];
  const seen = new Set<SourceText>();

  walkAstWithSkip(
    root,
    (node, parent) => {
      if (node.type !== "Identifier") {
        return;
      }

      if (range && (node.start < range.start || node.end > range.end)) {
        return;
      }

      if (!isReferenceIdentifier(node, parent)) {
        return;
      }

      if (seen.has(node.name)) {
        return;
      }

      const isCallee = parent?.type === "CallExpression" && parent.callee === node;
      const edgeKind: EdgeKind = isCallee ? "call" : "data-flow";

      dependencies.push({
        name: node.name,
        node,
        edgeKind,
        callSite: isCallee ? parent : undefined,
      });
      seen.add(node.name);
    },
    (node) => skipNestedFunctions && isFunctionNode(node),
  );

  return dependencies;
};

/**
 * Collect inline function expressions nested inside a subtree.
 *
 * @param root AST node to scan.
 * @param range Optional range to constrain matches.
 * @returns List of inline function nodes.
 */
const collectInlineFunctions = (root: AstNode, range: OffsetRange | null): FunctionNode[] => {
  const functions: FunctionNode[] = [];

  walkAstWithSkip(
    root,
    (node) => {
      if (!isFunctionNode(node)) {
        return;
      }

      if (range && (node.start < range.start || node.end > range.end)) {
        return;
      }

      functions.push(node);
    },
    (node) => isFunctionNode(node),
  );

  return functions;
};

/**
 * Collect return expression nodes for a function.
 *
 * @param fn Function node to inspect.
 * @returns List of return expression nodes.
 */
const collectReturnExpressions = (fn: FunctionNode): AstNode[] => {
  if (fn.type === "ArrowFunctionExpression" && fn.body.type !== "BlockStatement") {
    return [fn.body];
  }

  const expressions: AstNode[] = [];
  const body = fn.body;

  if (!body || body.type !== "BlockStatement") {
    return expressions;
  }

  walkAstWithSkip(
    body,
    (node) => {
      if (node.type !== "ReturnStatement") {
        return;
      }

      if (node.argument) {
        expressions.push(node.argument);
      }
    },
    (node) => node !== body && isFunctionNode(node),
  );

  return expressions;
};

/**
 * Collect top-level statements from a function body.
 *
 * @param fn Function node to inspect.
 * @returns Statement list for the function body.
 */
const collectFunctionStatements = (fn: FunctionNode): AstNode[] => {
  if (fn.type === "ArrowFunctionExpression") {
    return fn.body.type === "BlockStatement" ? fn.body.body : [];
  }

  return fn.body?.body ?? [];
};

/**
 * Find the nearest enclosing function for a node.
 *
 * @param root Program AST to search.
 * @param target Target node to locate.
 * @returns Enclosing function node or null.
 */
const findEnclosingFunction = (root: AstNode, target: AstNode): FunctionNode | null => {
  let match: FunctionNode | null = null;

  walkAst(root, (node) => {
    if (!isFunctionNode(node)) {
      return;
    }

    if (node.start > target.start || node.end < target.end) {
      return;
    }

    if (node === target) {
      return;
    }

    if (!match) {
      match = node;
      return;
    }

    const matchSize = match.end - match.start;
    const nodeSize = node.end - node.start;

    if (nodeSize < matchSize) {
      match = node;
    }
  });

  return match;
};

/**
 * Find an exported binding in a parsed file.
 *
 * @param parsedFile Parsed file to inspect.
 * @param exportedName Exported name to locate.
 * @returns Export lookup result or null if not found.
 */
const findExportedBinding = (
  parsedFile: ParsedFile,
  exportedName: SourceText,
): ExportLookup | null => {
  const program = parsedFile.ast;

  if (program.type !== "Program") {
    return null;
  }

  for (const statement of program.body) {
    if (statement.type !== "ExportNamedDeclaration") {
      continue;
    }

    if (statement.declaration) {
      const declaration = statement.declaration;

      if (declaration.type === "FunctionDeclaration" && declaration.id?.name === exportedName) {
        return { kind: "declaration", node: declaration };
      }

      if (declaration.type === "ClassDeclaration" && declaration.id?.name === exportedName) {
        return { kind: "declaration", node: declaration };
      }

      if (declaration.type === "VariableDeclaration") {
        for (const declarator of declaration.declarations) {
          if (declarator.id.type === "Identifier" && declarator.id.name === exportedName) {
            return { kind: "declaration", node: declarator };
          }
        }
      }
    }

    if (statement.source && statement.specifiers.length > 0) {
      for (const specifier of statement.specifiers) {
        if (specifier.type !== "ExportSpecifier") {
          continue;
        }

        const exported =
          specifier.exported.type === "Identifier"
            ? specifier.exported.name
            : specifier.exported.type === "Literal" && typeof specifier.exported.value === "string"
              ? specifier.exported.value
              : null;

        if (exported === exportedName) {
          const localName =
            specifier.local.type === "Identifier"
              ? specifier.local.name
              : specifier.local.type === "Literal" && typeof specifier.local.value === "string"
                ? specifier.local.value
                : null;

          if (!localName) {
            continue;
          }

          return {
            kind: "re-export",
            node: statement,
            source: statement.source.value,
            localName,
          };
        }
      }
    }
  }

  return null;
};

/**
 * Extract the imported name from an import specifier.
 *
 * @param specifier Import specifier to inspect.
 * @returns Imported name string or null if unavailable.
 */
const getImportSpecifierName = (specifier: AstNode): SourceText | null => {
  if (specifier.type === "ImportSpecifier") {
    if (specifier.imported.type === "Identifier") {
      return specifier.imported.name;
    }

    if (specifier.imported.type === "Literal" && typeof specifier.imported.value === "string") {
      return specifier.imported.value;
    }

    return null;
  }

  if (specifier.type === "ImportDefaultSpecifier") {
    return "default";
  }

  if (specifier.type === "ImportNamespaceSpecifier") {
    return "*";
  }

  return null;
};

/**
 * Resolve the imported name from an import declaration.
 *
 * @param importNode Import declaration node.
 * @param localName Local binding name used in the file.
 * @returns Imported name or null when not found.
 */
const findImportBindingName = (importNode: AstNode, localName: SourceText): SourceText | null => {
  if (importNode.type !== "ImportDeclaration") {
    return null;
  }

  for (const specifier of importNode.specifiers) {
    if (specifier.local.name !== localName) {
      continue;
    }

    return getImportSpecifierName(specifier);
  }

  return null;
};

/**
 * Build an issue entry and add it to the collector.
 *
 * @param collector Issue collector to receive the issue.
 * @param kind Issue kind to emit.
 * @param range Source range for the issue.
 * @param file File path for the issue.
 * @param matchedPattern Optional ignore pattern that was matched.
 */
const emitIssue = (
  collector: IIssueCollector,
  kind: IssueKind,
  range: OffsetRange,
  file: AbsolutePath,
  matchedPattern?: SourceText | RegExp,
): void => {
  const messages: Record<IssueKind, SourceText> = {
    "unresolved-dependency": "Unresolved dependency.",
    "ignored-path": "Ignored dependency path.",
    "dynamic-import": "Dynamic import detected.",
    "computed-property": "Computed property access detected.",
    eval: "eval call detected.",
    "arguments-object": "arguments object usage detected.",
    "rest-spread-unknown": "Rest/spread usage detected.",
    "indirect-call": "Indirect call detected.",
    "prototype-mutation": "Prototype mutation detected.",
    "this-call": "this-call detected.",
  };

  const resolutions: Record<IssueKind, IssueResolution> = {
    "unresolved-dependency": "leaf",
    "ignored-path": "leaf",
    "dynamic-import": "included",
    "computed-property": "included",
    eval: "included",
    "arguments-object": "included",
    "rest-spread-unknown": "included",
    "indirect-call": "included",
    "prototype-mutation": "flagged-only",
    "this-call": "included",
  };

  collector.add({
    kind,
    message: messages[kind],
    file,
    range,
    resolution: resolutions[kind],
    matchedPattern,
  });
};

/**
 * Determine the binding kind for a resolved declaration.
 *
 * @param node Resolved declaration node.
 * @param scopeKind Scope classification for the node.
 * @returns Binding kind classification.
 */
const classifyBinding = (
  node: AstNode,
  scopeKind: "program" | "function" | "block",
): BindingKind => {
  if (node.type === "ImportDeclaration") {
    return "import-resolved";
  }

  if (isFunctionNode(node)) {
    return "function";
  }

  if (node.type === "VariableDeclarator") {
    return scopeKind === "program" ? "global-found" : "local-variable";
  }

  if (node.type === "ClassDeclaration") {
    return "global-found";
  }

  if (node.type === "Identifier") {
    return "parameter";
  }

  return "global-missing";
};

/**
 * Backward slicer implementing the worklist algorithm.
 */
export class BackwardSlicer {
  private readonly parser: IParser;
  private readonly resolver: IResolver;
  private readonly shaker: IShaker;
  private readonly collector: IIssueCollector;
  private readonly seedExpander: SeedExpander;

  /**
   * Initialize a backward slicer with the required collaborators.
   *
   * @param parser Parser used to load and cache ASTs.
   * @param resolver Resolver used for import bindings.
   * @param shaker Shaker used for intra-function pruning.
   * @param collector Issue collector to receive slice issues.
   */
  constructor(parser: IParser, resolver: IResolver, shaker: IShaker, collector: IIssueCollector) {
    this.parser = parser;
    this.resolver = resolver;
    this.shaker = shaker;
    this.collector = collector;
    this.seedExpander = new SeedExpander();
  }

  /**
   * Slice dependencies backward from the provided start point.
   *
   * @param entryFile Absolute entry file path.
   * @param startPoint Start-point range within the entry file.
   * @param parsedFiles Parsed file map keyed by absolute path.
   * @returns Slice result containing nodes, edges, and visited IDs.
   * @throws {StartPointNotFoundError} When the start point does not map to any node.
   */
  readonly slice = (
    entryFile: AbsolutePath,
    startPoint: OffsetRange,
    parsedFiles: Map<AbsolutePath, ParsedFile>,
  ): SliceResult => {
    const entryParsed = parsedFiles.get(entryFile);

    if (!entryParsed) {
      throw new StartPointNotFoundError(entryFile, startPoint);
    }

    const bindingResolver = new BindingResolver();
    const nodes: DependencyNode[] = [];
    const edges: DependencyEdge[] = [];
    const nodeById = new Map<NodeId, DependencyNode>();
    const visited = new Set<NodeId>();

    /**
     * Add or update a dependency node for the provided AST node.
     *
     * @param node AST node to record.
     * @param file Absolute file path containing the node.
     * @param kind Dependency node classification.
     * @param shaken Whether the node is marked as shaken.
     * @param source Source text for label extraction.
     * @returns The created or existing dependency node.
     */
    const addNode = (
      node: AstNode,
      file: AbsolutePath,
      kind: DependencyKind,
      shaken: boolean,
      source: SourceText,
    ): DependencyNode => {
      const range = rangeFromNode(node);
      const id = buildNodeId(file, range);
      const existing = nodeById.get(id);

      if (existing) {
        if (shaken && !existing.shaken) {
          existing.shaken = true;
        }
        if (existing.kind !== kind && (kind === "ignored-leaf" || kind === "unresolved-leaf")) {
          existing.kind = kind;
        }
        return existing;
      }

      const created: DependencyNode = {
        id,
        file,
        range,
        label: extractLabel(source, range),
        kind,
        shaken,
      };

      nodes.push(created);
      nodeById.set(id, created);
      return created;
    };

    /**
     * Record an edge between dependency nodes.
     *
     * @param fromId Source node ID.
     * @param toId Target node ID.
     * @param kind Edge kind classification.
     */
    const addEdge = (fromId: NodeId, toId: NodeId, kind: EdgeKind): void => {
      edges.push({ from: fromId, to: toId, kind });
    };

    /**
     * Build a work item from an identifier dependency.
     *
     * @param dependency Identifier dependency to enqueue.
     * @param ownerNodeId Owning dependency node ID.
     * @param file Absolute file path containing the dependency.
     * @param scopeNode AST node representing the lookup context.
     * @param ownerIsNestedFunction Whether the owner is a nested function.
     * @returns Identifier work item for the queue.
     */
    const buildWorkItem = (
      dependency: IdentifierDependency,
      ownerNodeId: NodeId,
      file: AbsolutePath,
      scopeNode: AstNode,
      ownerIsNestedFunction: boolean,
    ): IdentifierWorkItem => ({
      kind: "identifier",
      name: dependency.name,
      file,
      scopeNode,
      referenceNode: dependency.node,
      ownerNodeId,
      edgeKind: dependency.edgeKind,
      callSite: dependency.callSite,
      ownerIsNestedFunction,
    });

    /**
     * Build a work item for an inline function dependency.
     *
     * @param node Function node to process.
     * @param ownerNodeId Owning dependency node ID.
     * @param file Absolute file path containing the function.
     * @param scopeNode AST node representing the lookup context.
     * @param edgeKind Edge kind to use for the dependency edge.
     * @param ownerIsNestedFunction Whether the owner is a nested function.
     * @returns Inline function work item for the queue.
     */
    const createInlineFunctionWorkItem = (
      node: FunctionNode,
      ownerNodeId: NodeId,
      file: AbsolutePath,
      scopeNode: AstNode,
      edgeKind: EdgeKind,
      ownerIsNestedFunction: boolean,
    ): InlineFunctionWorkItem => ({
      kind: "inline-function",
      node,
      file,
      scopeNode,
      ownerNodeId,
      edgeKind,
      ownerIsNestedFunction,
    });

    /**
     * Add nodes corresponding to shaken statements inside a function body.
     *
     * @param fn Function node being shaken.
     * @param file Absolute file path containing the function.
     * @param source Source text for label extraction.
     * @param shakenRanges Ranges identified as shaken by the shaker.
     */
    const addShakenNodes = (
      fn: FunctionNode,
      file: AbsolutePath,
      source: SourceText,
      shakenRanges: Set<OffsetRange>,
    ): void => {
      const statements = collectFunctionStatements(fn);

      for (const statement of statements) {
        const range = rangeFromNode(statement);
        const isShaken = [...shakenRanges].some(
          (candidate) => candidate.start === range.start && candidate.end === range.end,
        );

        if (!isShaken) {
          continue;
        }

        if (statement.type === "VariableDeclaration") {
          addNode(statement, file, "variable", true, source);
          continue;
        }

        if (
          statement.type === "ExpressionStatement" &&
          statement.expression.type === "CallExpression"
        ) {
          addNode(statement, file, "call-site", true, source);
        }
      }
    };

    /**
     * Add or update a dependency node for a resolved declaration.
     *
     * @param resolved Resolved AST node.
     * @param file Absolute file path containing the node.
     * @param source Source text for label extraction.
     * @param kind Dependency node classification.
     * @param shaken Whether the node is marked as shaken.
     * @returns The created or existing dependency node.
     */
    const handleResolvedNode = (
      resolved: AstNode,
      file: AbsolutePath,
      source: SourceText,
      kind: DependencyKind,
      shaken: boolean,
    ): DependencyNode => addNode(resolved, file, kind, shaken, source);

    /**
     * Resolve an import specifier and determine the imported binding name.
     *
     * @param importNode Import declaration node.
     * @param localName Local binding name to resolve.
     * @param fromFile Absolute path of the importing file.
     * @returns Resolver result and imported name.
     */
    const resolveImportTarget = (
      importNode: AstNode,
      localName: SourceText,
      fromFile: AbsolutePath,
    ): { result: ResolveResult; importedName: SourceText | null } => {
      if (importNode.type !== "ImportDeclaration") {
        return { result: { kind: "failed" }, importedName: null };
      }

      const importedName = findImportBindingName(importNode, localName);
      const specifier = importNode.source.value;
      return { result: this.resolver.resolve(specifier, fromFile), importedName };
    };

    /**
     * Process a resolved function declaration or expression.
     *
     * @param fnNode Function node to process.
     * @param file Absolute file path containing the function.
     * @param source Source text for label extraction.
     * @param ownerNodeId Owning dependency node ID.
     * @param edgeKind Edge kind linking owner to function.
     * @param callSiteOwnerId Optional call-site owner for parameter binding.
     * @param ownerIsNestedFunction Whether the owner is a nested function.
     * @returns Dependency node representing the function.
     */
    const processResolvedFunction = (
      fnNode: FunctionNode,
      file: AbsolutePath,
      source: SourceText,
      ownerNodeId: NodeId,
      edgeKind: EdgeKind,
      callSiteOwnerId: NodeId | null,
      ownerIsNestedFunction: boolean,
    ): DependencyNode => {
      const functionNode = handleResolvedNode(fnNode, file, source, "function", false);
      addEdge(ownerNodeId, functionNode.id, edgeKind);

      const functionId = functionNode.id;
      if (visited.has(functionId)) {
        return functionNode;
      }

      visited.add(functionId);

      const isNested = findEnclosingFunction(parsedFiles.get(file)?.ast ?? fnNode, fnNode) !== null;
      const shakenRanges = this.shaker.shake(fnNode, source);
      addShakenNodes(fnNode, file, source, shakenRanges);

      const returnExpressions = collectReturnExpressions(fnNode);
      const dependencies: IdentifierDependency[] = [];
      const inlineFunctions: FunctionNode[] = [];

      for (const expression of returnExpressions) {
        if (isFunctionNode(expression)) {
          inlineFunctions.push(expression);
          continue;
        }

        dependencies.push(...collectIdentifierDependencies(expression, null, true));
        inlineFunctions.push(...collectInlineFunctions(expression, null));
      }

      const paramNodes = new Map<SourceText, AstNode>();
      for (const param of fnNode.params) {
        if (param.type === "Identifier") {
          paramNodes.set(param.name, param);
        }
      }

      const usedParamNames = new Set<SourceText>();
      for (const dependency of dependencies) {
        if (paramNodes.has(dependency.name)) {
          usedParamNames.add(dependency.name);
        }
      }

      const paramOwnerId = callSiteOwnerId ?? functionNode.id;
      for (const paramName of usedParamNames) {
        const paramNode = paramNodes.get(paramName);
        if (!paramNode) {
          continue;
        }

        const paramDependency = handleResolvedNode(paramNode, file, source, "parameter", false);
        addEdge(paramOwnerId, paramDependency.id, "param-bind");
      }

      const ownerNestedFlag = isNested || ownerIsNestedFunction;

      for (const inlineFn of inlineFunctions) {
        const workItem = createInlineFunctionWorkItem(
          inlineFn,
          functionNode.id,
          file,
          inlineFn,
          "data-flow",
          true,
        );
        worklist.push(workItem);
      }

      for (const dependency of dependencies) {
        if (usedParamNames.has(dependency.name)) {
          continue;
        }

        const workItem = buildWorkItem(dependency, functionNode.id, file, fnNode, ownerNestedFlag);
        worklist.push(workItem);
      }

      return functionNode;
    };

    /**
     * Resolve edge kind for nested function closure dependencies.
     *
     * @param edgeKind Proposed edge kind.
     * @param ownerIsNested Whether the owner is a nested function.
     * @param ownerScopeNode Scope node for the owner.
     * @param resolvedScopeNode Scope node for the dependency.
     * @returns Adjusted edge kind.
     */
    const resolveEdgeKind = (
      edgeKind: EdgeKind,
      ownerIsNested: boolean,
      ownerScopeNode: AstNode,
      resolvedScopeNode: AstNode,
    ): EdgeKind => {
      if (edgeKind !== "data-flow") {
        return edgeKind;
      }

      if (!ownerIsNested) {
        return edgeKind;
      }

      return resolvedScopeNode === ownerScopeNode ? edgeKind : "closure";
    };

    /**
     * Process a resolved variable declarator.
     *
     * @param declarator Variable declarator node.
     * @param scopeKind Scope classification for the declarator.
     * @param file Absolute file path containing the declarator.
     * @param source Source text for label extraction.
     * @param ownerNodeId Owning dependency node ID.
     * @param edgeKind Edge kind linking owner to declarator.
     * @param ownerIsNestedFunction Whether the owner is a nested function.
     * @param ownerScopeNode Scope node for the owner.
     * @param resolvedScopeNode Scope node for the declarator.
     * @returns Dependency node representing the variable.
     */
    const processResolvedVariable = (
      declarator: AstNode,
      scopeKind: "program" | "function" | "block",
      file: AbsolutePath,
      source: SourceText,
      ownerNodeId: NodeId,
      edgeKind: EdgeKind,
      ownerIsNestedFunction: boolean,
      ownerScopeNode: AstNode,
      resolvedScopeNode: AstNode,
    ): DependencyNode => {
      const kind: DependencyKind = scopeKind === "program" ? "global" : "variable";
      const variableNode = handleResolvedNode(declarator, file, source, kind, false);
      const ownerIsNestedScope =
        ownerIsNestedFunction ||
        (isFunctionNode(ownerScopeNode) &&
          findEnclosingFunction(parsedFiles.get(file)?.ast ?? ownerScopeNode, ownerScopeNode) !==
            null);
      const resolvedEdgeKind = resolveEdgeKind(
        edgeKind,
        ownerIsNestedScope,
        ownerScopeNode,
        resolvedScopeNode,
      );
      addEdge(ownerNodeId, variableNode.id, resolvedEdgeKind);

      if (visited.has(variableNode.id)) {
        return variableNode;
      }

      visited.add(variableNode.id);

      if (declarator.type === "VariableDeclarator" && declarator.init) {
        const deps = collectIdentifierDependencies(declarator.init, null, true);
        const inlineFns = collectInlineFunctions(declarator.init, null);

        for (const inlineFn of inlineFns) {
          const workItem = createInlineFunctionWorkItem(
            inlineFn,
            variableNode.id,
            file,
            declarator,
            "data-flow",
            false,
          );
          worklist.push(workItem);
        }

        for (const dep of deps) {
          const workItem = buildWorkItem(dep, variableNode.id, file, declarator, false);
          worklist.push(workItem);
        }
      }

      return variableNode;
    };

    /**
     * Process a resolved class declaration and include class method nodes.
     *
     * @param classNode Class declaration node.
     * @param file Absolute file path containing the class.
     * @param source Source text for label extraction.
     * @param ownerNodeId Owning dependency node ID.
     * @param edgeKind Edge kind linking owner to class.
     * @param ownerIsNestedFunction Whether the owner is a nested function.
     * @param ownerScopeNode Scope node for the owner.
     * @param resolvedScopeNode Scope node for the class declaration.
     * @returns Dependency node representing the class declaration.
     */
    const processResolvedClass = (
      classNode: AstNode,
      file: AbsolutePath,
      source: SourceText,
      ownerNodeId: NodeId,
      edgeKind: EdgeKind,
      ownerIsNestedFunction: boolean,
      ownerScopeNode: AstNode,
      resolvedScopeNode: AstNode,
    ): DependencyNode => {
      const classDependency = handleResolvedNode(classNode, file, source, "global", false);
      const ownerIsNestedScope =
        ownerIsNestedFunction ||
        (isFunctionNode(ownerScopeNode) &&
          findEnclosingFunction(parsedFiles.get(file)?.ast ?? ownerScopeNode, ownerScopeNode) !==
            null);
      const resolvedEdgeKind = resolveEdgeKind(
        edgeKind,
        ownerIsNestedScope,
        ownerScopeNode,
        resolvedScopeNode,
      );
      addEdge(ownerNodeId, classDependency.id, resolvedEdgeKind);

      if (visited.has(classDependency.id)) {
        return classDependency;
      }

      visited.add(classDependency.id);

      if (classNode.type !== "ClassDeclaration") {
        return classDependency;
      }

      for (const element of classNode.body.body) {
        if (element.type !== "MethodDefinition") {
          continue;
        }

        const methodNode = handleResolvedNode(element, file, source, "function", false);
        addEdge(classDependency.id, methodNode.id, "data-flow");

        if (!isFunctionNode(element.value)) {
          continue;
        }

        processResolvedFunction(
          element.value,
          file,
          source,
          methodNode.id,
          "data-flow",
          null,
          false,
        );
      }

      return classDependency;
    };

    /**
     * Process a resolved parameter binding.
     *
     * @param paramNode Parameter identifier node.
     * @param file Absolute file path containing the parameter.
     * @param source Source text for label extraction.
     * @param ownerNodeId Owning dependency node ID.
     * @param edgeKind Edge kind linking owner to parameter.
     * @param ownerIsNestedFunction Whether the owner is a nested function.
     * @param ownerScopeNode Scope node for the owner.
     * @param resolvedScopeNode Scope node for the parameter.
     * @returns Dependency node representing the parameter.
     */
    const processResolvedParameter = (
      paramNode: AstNode,
      file: AbsolutePath,
      source: SourceText,
      ownerNodeId: NodeId,
      edgeKind: EdgeKind,
      ownerIsNestedFunction: boolean,
      ownerScopeNode: AstNode,
      resolvedScopeNode: AstNode,
    ): DependencyNode => {
      const parameterNode = handleResolvedNode(paramNode, file, source, "parameter", false);
      const ownerIsNestedScope =
        ownerIsNestedFunction ||
        (isFunctionNode(ownerScopeNode) &&
          findEnclosingFunction(parsedFiles.get(file)?.ast ?? ownerScopeNode, ownerScopeNode) !==
            null);
      const resolvedEdgeKind = resolveEdgeKind(
        edgeKind,
        ownerIsNestedScope,
        ownerScopeNode,
        resolvedScopeNode,
      );
      addEdge(ownerNodeId, parameterNode.id, resolvedEdgeKind);

      if (!visited.has(parameterNode.id)) {
        visited.add(parameterNode.id);
      }

      return parameterNode;
    };

    /**
     * Process an import binding and follow its resolved target.
     *
     * @param importNode Import declaration node.
     * @param localName Local binding name used by the importer.
     * @param file Absolute path of the importing file.
     * @param source Source text for label extraction.
     * @param ownerNodeId Owning dependency node ID.
     * @param callSiteOwnerId Optional call-site owner for parameter binding.
     * @returns Dependency node representing the import declaration.
     */
    const processImportBinding = (
      importNode: AstNode,
      localName: SourceText,
      file: AbsolutePath,
      source: SourceText,
      ownerNodeId: NodeId,
      callSiteOwnerId: NodeId | null,
    ): DependencyNode => {
      const importDependency = handleResolvedNode(importNode, file, source, "import", false);
      addEdge(ownerNodeId, importDependency.id, "import");

      const { result, importedName } = resolveImportTarget(importNode, localName, file);

      switch (result.kind) {
        case "resolved": {
          if (!importedName) {
            return importDependency;
          }

          const targetFile = result.absolutePath;
          const targetParsed = parsedFiles.get(targetFile);

          if (!targetParsed) {
            emitIssue(this.collector, "unresolved-dependency", rangeFromNode(importNode), file);
            handleResolvedNode(importNode, file, source, "unresolved-leaf", false);
            return importDependency;
          }

          let lookup = findExportedBinding(targetParsed, importedName);

          while (lookup && lookup.kind === "re-export") {
            const reExportNode = handleResolvedNode(
              lookup.node,
              targetFile,
              targetParsed.source,
              "re-export",
              false,
            );
            addEdge(importDependency.id, reExportNode.id, "import");

            const nextResult = this.resolver.resolve(lookup.source, targetFile);

            if (nextResult.kind !== "resolved") {
              emitIssue(
                this.collector,
                "unresolved-dependency",
                rangeFromNode(lookup.node),
                targetFile,
              );
              handleResolvedNode(
                lookup.node,
                targetFile,
                targetParsed.source,
                "unresolved-leaf",
                false,
              );
              return importDependency;
            }

            const nextParsed = parsedFiles.get(nextResult.absolutePath);

            if (!nextParsed) {
              emitIssue(
                this.collector,
                "unresolved-dependency",
                rangeFromNode(lookup.node),
                targetFile,
              );
              handleResolvedNode(
                lookup.node,
                targetFile,
                targetParsed.source,
                "unresolved-leaf",
                false,
              );
              return importDependency;
            }

            lookup = findExportedBinding(nextParsed, lookup.localName);

            if (lookup?.kind === "declaration") {
              const bindingNode = lookup.node;
              const binding = handleResolvedNode(
                bindingNode,
                nextParsed.absolutePath,
                nextParsed.source,
                isFunctionNode(bindingNode) ? "function" : "variable",
                false,
              );
              addEdge(importDependency.id, binding.id, "import");

              if (isFunctionNode(bindingNode)) {
                processResolvedFunction(
                  bindingNode,
                  nextParsed.absolutePath,
                  nextParsed.source,
                  importDependency.id,
                  "import",
                  callSiteOwnerId,
                  false,
                );
              } else if (bindingNode.type === "VariableDeclarator") {
                processResolvedVariable(
                  bindingNode,
                  "program",
                  nextParsed.absolutePath,
                  nextParsed.source,
                  importDependency.id,
                  "import",
                  false,
                  importNode,
                  bindingNode,
                );
              }
            }
          }

          if (lookup && lookup.kind === "declaration") {
            const bindingNode = lookup.node;
            const binding = handleResolvedNode(
              bindingNode,
              targetFile,
              targetParsed.source,
              isFunctionNode(bindingNode) ? "function" : "variable",
              false,
            );
            addEdge(importDependency.id, binding.id, "import");

            if (isFunctionNode(bindingNode)) {
              processResolvedFunction(
                bindingNode,
                targetFile,
                targetParsed.source,
                importDependency.id,
                "import",
                callSiteOwnerId,
                false,
              );
            } else if (bindingNode.type === "VariableDeclarator") {
              processResolvedVariable(
                bindingNode,
                "program",
                targetFile,
                targetParsed.source,
                importDependency.id,
                "import",
                false,
                importNode,
                bindingNode,
              );
            }
          } else if (!lookup) {
            emitIssue(this.collector, "unresolved-dependency", rangeFromNode(importNode), file);
            handleResolvedNode(importNode, file, source, "unresolved-leaf", false);
          }

          return importDependency;
        }
        case "ignored": {
          emitIssue(
            this.collector,
            "ignored-path",
            rangeFromNode(importNode),
            file,
            result.matchedPattern,
          );
          handleResolvedNode(importNode, file, source, "ignored-leaf", false);
          return importDependency;
        }
        case "failed": {
          emitIssue(this.collector, "unresolved-dependency", rangeFromNode(importNode), file);
          handleResolvedNode(importNode, file, source, "unresolved-leaf", false);
          return importDependency;
        }
        default:
          return assertNever(result);
      }
    };

    /**
     * Emit an unresolved dependency node and issue.
     *
     * @param referenceNode AST node where the unresolved reference occurs.
     * @param file Absolute file path containing the reference.
     * @param source Source text for label extraction.
     * @param ownerNodeId Owning dependency node ID.
     * @param edgeKind Edge kind linking owner to unresolved leaf.
     * @returns Dependency node representing the unresolved leaf.
     */
    const processUnresolved = (
      referenceNode: AstNode,
      file: AbsolutePath,
      source: SourceText,
      ownerNodeId: NodeId,
      edgeKind: EdgeKind,
    ): DependencyNode => {
      emitIssue(this.collector, "unresolved-dependency", rangeFromNode(referenceNode), file);
      const leafNode = handleResolvedNode(referenceNode, file, source, "unresolved-leaf", false);
      addEdge(ownerNodeId, leafNode.id, edgeKind);
      return leafNode;
    };

    const worklist: WorkItem[] = [];

    const { seedNode, subExprRange } = findSeedNode(entryParsed, startPoint);
    const startNode = addNode(seedNode, entryFile, "start-point", false, entryParsed.source);
    visited.add(startNode.id);

    const enclosingFunction = findEnclosingFunction(entryParsed.ast, seedNode);
    if (enclosingFunction) {
      const shakenRanges = this.shaker.shake(enclosingFunction, entryParsed.source);
      addShakenNodes(enclosingFunction, entryFile, entryParsed.source, shakenRanges);
    }

    const seedNames = new Set(this.seedExpander.expand(seedNode, subExprRange));
    const seedDependencies = collectIdentifierDependencies(seedNode, subExprRange, true).filter(
      (dep) => seedNames.has(dep.name),
    );

    for (const dependency of seedDependencies) {
      worklist.push(buildWorkItem(dependency, startNode.id, entryFile, seedNode, false));
    }

    while (worklist.length > 0) {
      const item = worklist.shift();

      if (!item) {
        continue;
      }

      if (item.kind === "inline-function") {
        const parsed = parsedFiles.get(item.file);
        if (!parsed) {
          continue;
        }

        processResolvedFunction(
          item.node,
          item.file,
          parsed.source,
          item.ownerNodeId,
          item.edgeKind,
          null,
          item.ownerIsNestedFunction,
        );
        continue;
      }

      const parsedFile = parsedFiles.get(item.file);

      if (!parsedFile) {
        continue;
      }

      const resolved = bindingResolver.resolveWithScope(item.name, item.scopeNode, parsedFile);

      if (!resolved) {
        processUnresolved(
          item.referenceNode,
          item.file,
          parsedFile.source,
          item.ownerNodeId,
          item.edgeKind,
        );
        continue;
      }

      const bindingKind = classifyBinding(resolved.node, resolved.scopeKind);

      switch (bindingKind) {
        case "local-variable":
        case "global-found": {
          if (resolved.node.type === "ClassDeclaration") {
            processResolvedClass(
              resolved.node,
              item.file,
              parsedFile.source,
              item.ownerNodeId,
              item.edgeKind,
              item.ownerIsNestedFunction,
              item.scopeNode,
              resolved.scopeNode,
            );
            break;
          }

          const dependencyNode = processResolvedVariable(
            resolved.node,
            resolved.scopeKind,
            item.file,
            parsedFile.source,
            item.ownerNodeId,
            item.edgeKind,
            item.ownerIsNestedFunction,
            item.scopeNode,
            resolved.scopeNode,
          );

          if (dependencyNode.kind === "global") {
            visited.add(dependencyNode.id);
          }

          break;
        }
        case "function": {
          const callSiteOwnerId = item.callSite ? item.ownerNodeId : null;
          if (isFunctionNode(resolved.node)) {
            processResolvedFunction(
              resolved.node,
              item.file,
              parsedFile.source,
              item.ownerNodeId,
              item.edgeKind,
              callSiteOwnerId,
              item.ownerIsNestedFunction,
            );
          }
          break;
        }
        case "parameter": {
          processResolvedParameter(
            resolved.node,
            item.file,
            parsedFile.source,
            item.ownerNodeId,
            item.edgeKind,
            item.ownerIsNestedFunction,
            item.scopeNode,
            resolved.scopeNode,
          );
          break;
        }
        case "import-resolved": {
          processImportBinding(
            resolved.node,
            item.name,
            item.file,
            parsedFile.source,
            item.ownerNodeId,
            item.callSite ? item.ownerNodeId : null,
          );
          break;
        }
        case "global-missing": {
          processUnresolved(
            item.referenceNode,
            item.file,
            parsedFile.source,
            item.ownerNodeId,
            item.edgeKind,
          );
          break;
        }
        case "import-ignored":
        case "import-failed":
        case "re-export":
          break;
        default:
          assertNever(bindingKind);
      }
    }

    return { nodes, edges, visitedRanges: visited };
  };
}
