import { walkAst } from "@/helpers";
import { collectExports } from "@/helpers/module-boundary";
import { buildScopes, resolveBindingInScopes } from "@/helpers/scope";
import type { IParser } from "@/parse";
import type { IProjectIndex } from "@/project";
import type {
  AbsolutePath,
  AstNode,
  FunctionNode,
  NodeId,
  OffsetRange,
  ParsedFile,
  ReferenceSite,
  Scope,
  SourceText,
  TrackerIssue,
  UsageContinuation,
  UsageKind,
  UsageNode,
  UsageNodeLimit,
  UsageSeed,
  UsageSliceResult,
} from "@/types";
import { StartPointNotFoundError } from "@/types";
import { ReferenceFinder } from "@/usage/ReferenceFinder";
import { UsageSeedExpander } from "@/usage/UsageSeedExpander";
import type { IUsageSlicer } from "@/usage/UsageSlicer";
import { assertNever } from "assert-never";

const DEFAULT_USAGE_NODE_LIMIT: UsageNodeLimit = 10_000;

/**
 * Copy an AST node's source offsets into a range.
 * @param node AST node whose source offsets are copied.
 * @returns A range with the node's start and end offsets.
 */
const toRange = (node: AstNode): OffsetRange => ({
  start: node.start,
  end: node.end,
});

/**
 * Build a stable usage-node ID from its file path and source range.
 * @param file Absolute path of the file being processed.
 * @param range Source range being inspected.
 * @returns A stable ID combining the file path and range offsets.
 */
const buildNodeId = (file: AbsolutePath, range: OffsetRange): NodeId =>
  `${file}:${range.start}:${range.end}`;

/**
 * Check whether an AST node is a supported function form.
 * @param node Candidate function node.
 * @returns True when the node is a supported function declaration or expression.
 */
const isFunctionNode = (node: AstNode): node is FunctionNode => {
  switch (node.type) {
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
    case "TSDeclareFunction":
    case "TSEmptyBodyFunctionExpression":
      return true;
    default:
      return false;
  }
};

/**
 * Check whether a top-level statement exports bindings.
 * @param node Candidate top-level export statement.
 * @returns True when the node is an ESM export statement.
 */
const isExportStatement = (node: AstNode): boolean => {
  switch (node.type) {
    case "ExportNamedDeclaration":
    case "ExportDefaultDeclaration":
    case "ExportAllDeclaration":
      return true;
    default:
      return false;
  }
};

/**
 * Check whether a statement may introduce an import or re-export boundary.
 * @param node Candidate import, variable, or re-export statement.
 * @returns True when the statement may import or re-export a binding.
 */
const isImportBoundary = (node: AstNode): boolean => {
  switch (node.type) {
    case "ImportDeclaration":
      return true;
    case "VariableDeclaration":
      return node.declarations.some((declaration) => declaration.init?.type === "CallExpression");
    case "ExportNamedDeclaration":
    case "ExportAllDeclaration":
      return true;
    default:
      return false;
  }
};

/**
 * Read a node's identifier name, or return null for other node types.
 * @param node Candidate identifier node.
 * @returns The identifier name, or null for another node type.
 */
const identifierName = (node: AstNode | null | undefined): SourceText | null =>
  node?.type === "Identifier" ? node.name : null;

/**
 * Check whether an AST subtree contains an identifier with the requested name.
 * @param root Root AST node of the subtree to inspect.
 * @param name Binding or exported name to find.
 * @returns True when the subtree contains the named identifier.
 */
const containsIdentifier = (root: AstNode, name: SourceText): boolean => {
  let found = false;
  walkAst(root, (node) => {
    if (node.type === "Identifier" && node.name === name) {
      found = true;
    }
  });
  return found;
};

/**
 * Find a function declaration or function-valued variable initializer for a binding.
 * @param binding AST node that declares the tracked binding.
 * @returns The function bound by the node, or null when it is not function-valued.
 */
const findFunctionForBinding = (binding: AstNode): AstNode | null => {
  if (isFunctionNode(binding)) {
    return binding;
  }

  if (binding.type === "VariableDeclarator" && binding.init !== null) {
    return isFunctionNode(binding.init) ? binding.init : null;
  }

  return null;
};

/**
 * Find the first binding identifier in a pattern, optionally matching a name.
 * @param pattern Binding pattern to inspect.
 * @param name Optional identifier name to match in the pattern.
 * @returns The first matching binding identifier, or null when none exists.
 */
const findPatternBinding = (pattern: AstNode, name?: SourceText): AstNode | null => {
  let result: AstNode | null = null;
  walkAst(pattern, (node, parent) => {
    if (
      result !== null ||
      node.type !== "Identifier" ||
      (name !== undefined && node.name !== name)
    ) {
      return;
    }

    if (parent?.type === "Property" && parent.key === node && parent.value !== node) {
      return;
    }

    result = node;
  });
  return result;
};

/**
 * Check whether a call invokes a member of the global `console` object.
 * @param call Call expression being inspected.
 * @returns True when the call invokes a member of `console`.
 */
const isConsoleCall = (call: AstNode): boolean =>
  call.type === "CallExpression" &&
  call.callee.type === "MemberExpression" &&
  call.callee.object.type === "Identifier" &&
  call.callee.object.name === "console";

/** Performs a flat forward reference scan with optional import-graph hops. */
export class ForwardSlicer implements IUsageSlicer {
  private readonly parser: IParser;
  private readonly projectIndex: IProjectIndex;
  private readonly referenceFinder: ReferenceFinder;
  private readonly seedExpander: UsageSeedExpander;
  private readonly maxUsageNodes: UsageNodeLimit;

  /**
   * Create a forward slicer with parser and reverse-import collaborators.
   *
   * @param parser Parser/cache used for importer files.
   * @param projectIndex Reverse-import index used only for export hops.
   * @param maxUsageNodes Maximum number of nodes before traversal stops.
   */
  constructor(
    parser: IParser,
    projectIndex: IProjectIndex,
    maxUsageNodes: UsageNodeLimit = DEFAULT_USAGE_NODE_LIMIT,
  ) {
    this.parser = parser;
    this.projectIndex = projectIndex;
    this.referenceFinder = new ReferenceFinder();
    this.seedExpander = new UsageSeedExpander();
    this.maxUsageNodes = maxUsageNodes;
  }

  /**
   * Scan direct references and importer aliases from one declaration.
   *
   * @param entryFile Absolute path containing the start declaration.
   * @param startPoint Character range identifying the declaration.
   * @param parsedFiles Parsed files available to the scan.
   * @returns Usage nodes, edges, and issues discovered by the scan.
   * @throws {StartPointNotFoundError} When the entry file or seed is absent.
   */
  readonly slice = (
    entryFile: AbsolutePath,
    startPoint: OffsetRange,
    parsedFiles: Map<AbsolutePath, ParsedFile>,
  ): UsageSliceResult => {
    const entryParsed = parsedFiles.get(entryFile) ?? this.parser.getCache().get(entryFile);
    if (entryParsed === undefined) {
      throw new StartPointNotFoundError(entryFile, startPoint);
    }

    const initialSeed = this.seedExpander.expand(entryParsed, startPoint);
    const nodes: UsageNode[] = [];
    const edges: UsageSliceResult["edges"] = [];
    const issues: TrackerIssue[] = [];
    const nodeById = new Map<NodeId, UsageNode>();
    const queue: Array<{
      /** Binding to scan for direct references. */
      seed: UsageSeed;
      /** Whether to include the declaration itself as a start-point node. */
      addStart: boolean;
    }> = [{ seed: initialSeed, addStart: true }];
    const visited = new Set<SourceText>();
    let capReached = false;

    /**
     * Reuse or create a usage node, stopping when the configured node limit is reached.
     * @param file Absolute path containing the usage node.
     * @param node Reference or declaration represented by the usage node.
     * @param kind How the reference or declaration uses the tracked value.
     * @param continuation Known destination or terminal continuation details.
     * @returns The existing or new usage node, or null after the node limit is reached.
     */
    const addNode = (
      file: AbsolutePath,
      node: AstNode,
      kind: UsageKind,
      continuation?: UsageContinuation,
    ): UsageNode | null => {
      const range = toRange(node);
      const id = buildNodeId(file, range);
      const existing = nodeById.get(id);
      if (existing !== undefined) {
        return existing;
      }

      if (nodes.length >= this.maxUsageNodes) {
        if (!capReached) {
          issues.push({
            kind: "usage-cap-reached",
            message: `Forward usage node cap reached at ${this.maxUsageNodes}.`,
            file,
            range,
            resolution: "leaf",
          });
          capReached = true;
        }
        return null;
      }

      const parsed = parsedFiles.get(file) ?? this.parser.getCache().get(file);
      const label = parsed?.source.slice(node.start, node.end) ?? "";
      const usageNode: UsageNode = { id, file, range, label, kind, continuation };
      nodes.push(usageNode);
      nodeById.set(id, usageNode);
      return usageNode;
    };

    /**
     * Add a graph edge unless the same relationship was already recorded.
     * @param from Source usage node of the graph edge.
     * @param to Target usage node of the graph edge.
     * @param kind Whether the relationship is a read, import, or continuation.
     */
    const addEdge = (
      from: UsageNode,
      to: UsageNode,
      kind: "read" | "import" | "continuation",
    ): void => {
      if (!edges.some((edge) => edge.from === from.id && edge.to === to.id && edge.kind === kind)) {
        edges.push({ from: from.id, to: to.id, kind });
      }
    };

    while (queue.length > 0 && !capReached) {
      const item = queue.shift();
      if (item === undefined) {
        break;
      }

      const { seed, addStart } = item;
      const visitKey = `${seed.file}:${seed.name}:${seed.scopeNode.start}:${seed.scopeNode.end}`;
      if (visited.has(visitKey)) {
        continue;
      }
      visited.add(visitKey);

      const parsed = parsedFiles.get(seed.file) ?? this.parser.getCache().get(seed.file);
      if (parsed === undefined) {
        continue;
      }

      const file = parsed.absolutePath;
      const startNode = addStart ? addNode(file, seed.declaration, "start-point") : null;
      const parents = this.buildParentMap(parsed.ast);
      const references = this.referenceFinder.find(seed.name, seed.scopeNode, parsed);

      for (const reference of references) {
        const classified = this.classifyReference(reference, parents, parsed, seed.scopeNode);
        const usageNode = addNode(file, reference.node, classified.kind, classified.continuation);
        if (usageNode === null) {
          break;
        }

        if (startNode !== null) {
          addEdge(
            startNode,
            usageNode,
            classified.kind === "untraced-continuation" ? "continuation" : "read",
          );
        }
      }

      const anchorNode =
        startNode ??
        (() => {
          const importInfo = this.findImportBoundary(parsed.ast, seed.name);
          return importInfo === null
            ? null
            : (nodeById.get(buildNodeId(file, toRange(importInfo.boundary))) ?? null);
        })();

      if (anchorNode !== null) {
        this.enqueueImporters(seed, parsed, anchorNode, parsedFiles, queue, addNode, addEdge);
      }
    }

    return { nodes, edges, issues };
  };

  /**
   * Build an identity-based parent lookup for context classification.
   * @param root Root AST node of the subtree to inspect.
   * @returns A map from each visited AST node to its parent.
   */
  private readonly buildParentMap = (root: AstNode): Map<AstNode, AstNode | null> => {
    const parents = new Map<AstNode, AstNode | null>();
    walkAst(root, (node, parent) => parents.set(node, parent));
    return parents;
  };

  /**
   * Classify one direct reference and compute a best-effort continuation.
   * @param reference Direct binding reference to classify.
   * @param parents Lookup from AST nodes to their parents.
   * @param parsedFile Parsed source file containing the relevant AST node.
   * @param scopeNode AST node that owns the lexical scope.
   * @returns The usage kind and any continuation for the direct reference.
   */
  private readonly classifyReference = (
    reference: ReferenceSite,
    parents: ReadonlyMap<AstNode, AstNode | null>,
    parsedFile: ParsedFile,
    scopeNode: AstNode,
  ): {
    /** Classification assigned to this reference. */
    kind: UsageKind;
    /** Next known location or reason traversal stops at this reference. */
    continuation?: UsageContinuation;
  } => {
    const parent = parents.get(reference.node) ?? null;
    switch (reference.parentContext) {
      case "declarator":
        return this.continuationResult(
          "reassignment",
          false,
          this.findDeclaratorDestination(parent, parsedFile),
        );
      case "destructure":
        return this.continuationResult(
          "destructure",
          false,
          this.findDeclaratorDestination(parent, parsedFile),
        );
      case "call-argument":
        if (parent !== null && isConsoleCall(parent)) {
          return { kind: "read-reference" };
        }
        return this.continuationResult(
          "call-argument",
          this.findCallParameter(parent, reference.node, parsedFile, scopeNode) === undefined,
          this.findCallParameter(parent, reference.node, parsedFile, scopeNode),
        );
      case "return":
        return this.continuationResult("return-value", false, undefined);
      case "property-write":
        return this.continuationResult("property-write", true, undefined);
      case "spread":
        return this.continuationResult("spread", true, undefined);
      case "write":
        return { kind: "write-reference" };
      case "read":
        return this.classifyReadReference(reference, parent, parents, parsedFile, scopeNode);
      default:
        return assertNever(reference.parentContext);
    }
  };

  /**
   * Classify a read that may be an assignment RHS or an invoked callee.
   * @param reference Direct binding reference to classify.
   * @param parent Parent AST node, when one exists.
   * @param parents Lookup from AST nodes to their parents.
   * @param parsedFile Parsed source file containing the relevant AST node.
   * @param scopeNode AST node that owns the lexical scope.
   * @returns The read usage kind and any continuation destination.
   */
  private readonly classifyReadReference = (
    reference: ReferenceSite,
    parent: AstNode | null,
    parents: ReadonlyMap<AstNode, AstNode | null>,
    parsedFile: ParsedFile,
    scopeNode: AstNode,
  ): {
    /** Classification assigned to this read. */
    kind: UsageKind;
    /** Next known location or reason traversal stops at this read. */
    continuation?: UsageContinuation;
  } => {
    if (parent?.type === "AssignmentExpression" && parent.right === reference.node) {
      const destination =
        parent.left.type === "Identifier"
          ? this.findAssignmentDestination(parent.left, parsedFile, scopeNode)
          : undefined;
      return this.continuationResult("reassignment", destination === undefined, destination);
    }

    if (
      (parent?.type === "CallExpression" || parent?.type === "NewExpression") &&
      parent.callee === reference.node
    ) {
      const destination = this.findInvocationDestination(parent, parents, parsedFile);
      return this.continuationResult("invoked", false, destination);
    }

    return { kind: "read-reference" };
  };

  /**
   * Build a classified terminal node result.
   * @param reason Reason attached to this range or continuation.
   * @param opaque Whether the destination cannot be determined statically.
   * @param continuesAt Known destination of the continued value, if any.
   * @returns A terminal usage classification with its continuation details.
   */
  private readonly continuationResult = (
    reason: UsageContinuation["reason"],
    opaque: boolean,
    continuesAt: UsageContinuation["continuesAt"],
  ): {
    /** Terminal usage classification for an untraced continuation. */
    kind: UsageKind;
    /** Reason and optional destination for the terminal usage. */
    continuation: UsageContinuation;
  } => ({
    kind: "untraced-continuation",
    continuation: { reason, opaque, ...(continuesAt === undefined ? {} : { continuesAt }) },
  });

  /**
   * Locate the fresh or existing binding receiving an assignment.
   * @param target AST node or binding to locate.
   * @param parsedFile Parsed source file containing the relevant AST node.
   * @param scopeNode AST node that owns the lexical scope.
   * @returns The resolved assignment target, or undefined when it cannot be followed.
   */
  private readonly findAssignmentDestination = (
    target: AstNode,
    parsedFile: ParsedFile,
    scopeNode: AstNode,
  ): UsageContinuation["continuesAt"] => {
    if (target.type !== "Identifier") {
      return undefined;
    }

    const resolved = resolveBindingInScopes(target.name, target, buildScopes(parsedFile.ast));
    if (resolved === null || !this.isWithinScope(resolved.scope.node, scopeNode)) {
      return undefined;
    }

    return {
      file: parsedFile.absolutePath,
      range: toRange(resolved.binding),
      label: parsedFile.source.slice(resolved.binding.start, resolved.binding.end),
    };
  };

  /**
   * Find the destination declaration for a declarator reference.
   * @param parent Parent AST node, when one exists.
   * @param parsedFile Parsed source file containing the relevant AST node.
   * @returns The declarator's bound name and source range, when known.
   */
  private readonly findDeclaratorDestination = (
    parent: AstNode | null,
    parsedFile: ParsedFile,
  ): UsageContinuation["continuesAt"] => {
    if (parent === null || parent.type !== "VariableDeclarator") {
      return undefined;
    }

    const name = identifierName(parent.id);
    const binding = name === null ? findPatternBinding(parent.id) : parent.id;
    if (binding === null) {
      return undefined;
    }

    return {
      file: parsedFile.absolutePath,
      range: toRange(binding),
      label: parsedFile.source.slice(binding.start, binding.end),
    };
  };

  /**
   * Find the local function parameter receiving a call argument.
   * @param call Call expression being inspected.
   * @param argument Call argument whose parameter should be found.
   * @param parsedFile Parsed source file containing the relevant AST node.
   * @param scopeNode AST node that owns the lexical scope.
   * @returns The corresponding local function parameter, when it can be resolved.
   */
  private readonly findCallParameter = (
    call: AstNode | null,
    argument: AstNode,
    parsedFile: ParsedFile,
    scopeNode: AstNode,
  ): UsageContinuation["continuesAt"] => {
    if (call?.type !== "CallExpression" && call?.type !== "NewExpression") {
      return undefined;
    }

    if (call.callee.type !== "Identifier") {
      return undefined;
    }

    const argumentIndex = call.arguments.findIndex((entry) => entry === argument);
    if (argumentIndex < 0) {
      return undefined;
    }

    const scopes = this.buildScopesFor(parsedFile);
    const resolved = this.resolveName(call.callee.name, call.callee, scopes);
    if (resolved === null || !this.isWithinScope(resolved.scopeNode, scopeNode)) {
      return undefined;
    }

    const functionNode = findFunctionForBinding(resolved.binding);
    if (functionNode === null || !isFunctionNode(functionNode)) {
      return undefined;
    }

    const parameter = functionNode.params[argumentIndex];
    if (parameter?.type !== "Identifier") {
      return undefined;
    }

    return { file: parsedFile.absolutePath, range: toRange(parameter), label: parameter.name };
  };

  /**
   * Find a declaration receiving a captured call result.
   * @param call Call expression being inspected.
   * @param parents Lookup from AST nodes to their parents.
   * @param parsedFile Parsed source file containing the relevant AST node.
   * @returns The binding receiving a call result, when one exists.
   */
  private readonly findInvocationDestination = (
    call: AstNode,
    parents: ReadonlyMap<AstNode, AstNode | null>,
    parsedFile: ParsedFile,
  ): UsageContinuation["continuesAt"] => {
    const parent = parents.get(call) ?? null;
    if (parent?.type !== "VariableDeclarator" || parent.init !== call) {
      return undefined;
    }
    return this.findDeclaratorDestination(parent, parsedFile);
  };

  /**
   * Enqueue direct and transitive importer aliases for an exported seed.
   * @param seed Binding selected for forward usage tracking.
   * @param parsedFile Parsed source file containing the relevant AST node.
   * @param sourceNode Usage node from which importer hops begin.
   * @param parsedFiles Parsed files supplied for the traversal.
   * @param queue Pending imported bindings to scan.
   * @param addNode Callback that creates or reuses a usage node.
   * @param addEdge Callback that records a relationship between usage nodes.
   */
  private readonly enqueueImporters = (
    seed: UsageSeed,
    parsedFile: ParsedFile,
    sourceNode: UsageNode,
    parsedFiles: Map<AbsolutePath, ParsedFile>,
    queue: Array<{
      /** Imported binding to scan after crossing the module boundary. */
      seed: UsageSeed;
      /** Whether to add a start-point node for the queued binding. */
      addStart: boolean;
    }>,
    addNode: (
      file: AbsolutePath,
      node: AstNode,
      kind: UsageKind,
      continuation?: UsageContinuation,
    ) => UsageNode | null,
    addEdge: (from: UsageNode, to: UsageNode, kind: "read" | "import" | "continuation") => void,
  ): void => {
    const exported = collectExports(parsedFile.ast).find(
      (binding) => binding.localName === seed.name,
    );
    if (exported === undefined) {
      return;
    }

    const boundary = this.findExportBoundary(parsedFile.ast, seed.name);
    if (boundary === null) {
      return;
    }

    const boundaryNode = addNode(parsedFile.absolutePath, boundary, "export-boundary");
    if (boundaryNode === null) {
      return;
    }
    addEdge(sourceNode, boundaryNode, "continuation");

    for (const importer of this.projectIndex.findImporters(
      parsedFile.absolutePath,
      exported.exportedName,
    )) {
      const importerFile = this.getParsedFile(importer.importerFile, parsedFiles);
      if (importerFile === null) {
        continue;
      }

      const importInfo = this.findImportBoundary(importerFile.ast, importer.localAlias);
      if (importInfo === null) {
        continue;
      }

      const importNode = addNode(importer.importerFile, importInfo.boundary, "import-usage");
      if (importNode === null) {
        return;
      }
      addEdge(boundaryNode, importNode, "import");

      if (importInfo.bindingNode !== null) {
        queue.push({
          seed: this.seedExpander.fromBinding(
            importerFile,
            importer.localAlias,
            importInfo.bindingNode,
          ),
          addStart: false,
        });
      }
    }
  };

  /**
   * Find a file in the caller map or parser cache.
   * @param file Absolute path of the requested parsed file.
   * @param parsedFiles Parsed files supplied for the traversal.
   * @returns The parsed file from the caller map or cache, or null if absent.
   */
  private readonly getParsedFile = (
    file: AbsolutePath,
    parsedFiles: Map<AbsolutePath, ParsedFile>,
  ): ParsedFile | null => parsedFiles.get(file) ?? this.parser.getCache().get(file) ?? null;

  /**
   * Locate the top-level export boundary containing a local binding.
   * @param ast Parsed program or AST root to inspect.
   * @param name Local binding name to find in an export statement.
   * @returns The top-level export statement containing the binding, or null.
   */
  private readonly findExportBoundary = (ast: AstNode, name: SourceText): AstNode | null => {
    if (ast.type !== "Program") {
      return null;
    }

    return (
      ast.body.find(
        (statement) =>
          (isExportStatement(statement) || statement.type === "ExpressionStatement") &&
          containsIdentifier(statement, name),
      ) ?? null
    );
  };

  /**
   * Locate an import or re-export statement and its local binding, if any.
   * @param ast Parsed program or AST root to inspect.
   * @param alias Local alias introduced by an import.
   * @returns The import boundary and local binding for the alias, or null.
   */
  private readonly findImportBoundary = (
    ast: AstNode,
    alias: SourceText,
  ): {
    /** Import or re-export statement containing the local alias. */
    boundary: AstNode;
    /** Local binding introduced by the boundary, if one exists. */
    bindingNode: AstNode | null;
  } | null => {
    if (ast.type !== "Program") {
      return null;
    }

    for (const statement of ast.body) {
      if (!isImportBoundary(statement)) {
        continue;
      }

      if (statement.type === "ImportDeclaration") {
        const specifier = statement.specifiers.find((entry) => entry.local.name === alias);
        if (specifier !== undefined) {
          return { boundary: statement, bindingNode: specifier.local };
        }
      }

      if (statement.type === "VariableDeclaration") {
        for (const declaration of statement.declarations) {
          const bindingNode =
            identifierName(declaration.id) === alias
              ? declaration.id
              : findPatternBinding(declaration.id, alias);
          if (bindingNode !== null) {
            return { boundary: statement, bindingNode };
          }
        }
      }

      if (
        statement.type === "ExportNamedDeclaration" &&
        statement.source !== null &&
        statement.specifiers.some((specifier) => identifierName(specifier.exported) === alias)
      ) {
        return { boundary: statement, bindingNode: null };
      }

      if (
        statement.type === "ExportAllDeclaration" &&
        (statement.exported === null || identifierName(statement.exported) === alias)
      ) {
        return { boundary: statement, bindingNode: null };
      }
    }

    return null;
  };

  /**
   * Build scopes for a parsed file.
   * @param parsedFile Parsed source file containing the relevant AST node.
   * @returns Lexical scopes built for the parsed file.
   */
  private readonly buildScopesFor = (parsedFile: ParsedFile) =>
    // The shared scope builder is kept behind this method to centralize call-site resolution.
    this.referenceFinderScopes(parsedFile);

  /**
   * Resolve a name from the shared lexical scope list.
   * @param name Binding name to resolve in the provided scopes.
   * @param node Reference node used to select containing scopes.
   * @param scopes Lexical scopes available for name lookup.
   * @returns The binding and owning scope for the name, or null when unresolved.
   */
  private readonly resolveName = (name: SourceText, node: AstNode, scopes: Scope[]) => {
    const candidates = scopes
      .filter((scope) => scope.node.start <= node.start && scope.node.end >= node.end)
      .sort((left, right) => left.node.end - left.node.start - (right.node.end - right.node.start));
    for (const scope of candidates) {
      const binding = scope.bindings.get(name);
      if (binding !== undefined) {
        return { binding, scopeNode: scope.node };
      }
    }
    return null;
  };

  /**
   * Resolve scopes through the shared lexical scope implementation.
   * @param parsedFile Parsed source file containing the relevant AST node.
   * @returns Lexical scopes built by the shared scope helper.
   */
  private readonly referenceFinderScopes = (parsedFile: ParsedFile) => {
    // Importing the helper here avoids a second scope implementation in the slicer.
    return buildScopes(parsedFile.ast);
  };

  /**
   * Check whether one scope is contained by another.
   * @param inner Candidate scope node to test for containment.
   * @param outer Scope node that may contain the candidate.
   * @returns True when the inner node's range is contained by the outer node.
   */
  private readonly isWithinScope = (inner: AstNode, outer: AstNode): boolean =>
    inner.start >= outer.start && inner.end <= outer.end;
}
