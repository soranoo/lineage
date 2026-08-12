import { assertNever } from "assert-never";

import { collectExports } from "@/helpers/module-boundary";
import { walkAst } from "@/helpers";
import { buildScopes, resolveBindingInScopes } from "@/helpers/scope";
import { ReferenceFinder } from "@/usage/ReferenceFinder";
import { UsageSeedExpander } from "@/usage/UsageSeedExpander";
import type { IProjectIndex } from "@/project";
import type { IParser } from "@/parse";
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
import type { IUsageSlicer } from "@/usage/UsageSlicer";

const DEFAULT_USAGE_NODE_LIMIT: UsageNodeLimit = 10_000;

const toRange = (node: AstNode): OffsetRange => ({ start: node.start, end: node.end });

const buildNodeId = (file: AbsolutePath, range: OffsetRange): NodeId =>
  `${file}:${range.start}:${range.end}`;

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

const identifierName = (node: AstNode | null | undefined): SourceText | null =>
  node?.type === "Identifier" ? node.name : null;

const containsIdentifier = (root: AstNode, name: SourceText): boolean => {
  let found = false;
  walkAst(root, (node) => {
    if (node.type === "Identifier" && node.name === name) {
      found = true;
    }
  });
  return found;
};

const findFunctionForBinding = (binding: AstNode): AstNode | null => {
  if (isFunctionNode(binding)) {
    return binding;
  }

  if (binding.type === "VariableDeclarator" && binding.init !== null) {
    return isFunctionNode(binding.init) ? binding.init : null;
  }

  return null;
};

const findPatternBinding = (pattern: AstNode, name?: SourceText): AstNode | null => {
  let result: AstNode | null = null;
  walkAst(pattern, (node, parent) => {
    if (result !== null || node.type !== "Identifier" || (name !== undefined && node.name !== name)) {
      return;
    }

    if (parent?.type === "Property" && parent.key === node && parent.value !== node) {
      return;
    }

    result = node;
  });
  return result;
};

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
    const queue: Array<{ seed: UsageSeed; addStart: boolean }> = [
      { seed: initialSeed, addStart: true },
    ];
    const visited = new Set<SourceText>();
    let capReached = false;

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

    const addEdge = (from: UsageNode, to: UsageNode, kind: "read" | "import" | "continuation"): void => {
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
        this.enqueueImporters(
          seed,
          parsed,
          anchorNode,
          parsedFiles,
          queue,
          addNode,
          addEdge,
        );
      }
    }

    return { nodes, edges, issues };
  };

  /** Build an identity-based parent lookup for context classification. */
  private readonly buildParentMap = (root: AstNode): Map<AstNode, AstNode | null> => {
    const parents = new Map<AstNode, AstNode | null>();
    walkAst(root, (node, parent) => parents.set(node, parent));
    return parents;
  };

  /** Classify one direct reference and compute a best-effort continuation. */
  private readonly classifyReference = (
    reference: ReferenceSite,
    parents: ReadonlyMap<AstNode, AstNode | null>,
    parsedFile: ParsedFile,
    scopeNode: AstNode,
  ): { kind: UsageKind; continuation?: UsageContinuation } => {
    const parent = parents.get(reference.node) ?? null;
    switch (reference.parentContext) {
      case "declarator":
        return this.continuationResult("reassignment", false, this.findDeclaratorDestination(parent, parsedFile));
      case "destructure":
        return this.continuationResult("destructure", false, this.findDeclaratorDestination(parent, parsedFile));
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

  /** Classify a read that may be an assignment RHS or an invoked callee. */
  private readonly classifyReadReference = (
    reference: ReferenceSite,
    parent: AstNode | null,
    parents: ReadonlyMap<AstNode, AstNode | null>,
    parsedFile: ParsedFile,
    scopeNode: AstNode,
  ): { kind: UsageKind; continuation?: UsageContinuation } => {
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

  /** Build a classified terminal node result. */
  private readonly continuationResult = (
    reason: UsageContinuation["reason"],
    opaque: boolean,
    continuesAt: UsageContinuation["continuesAt"],
  ): { kind: UsageKind; continuation: UsageContinuation } => ({
    kind: "untraced-continuation",
    continuation: { reason, opaque, ...(continuesAt === undefined ? {} : { continuesAt }) },
  });

  /** Locate the fresh or existing binding receiving an assignment. */
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

  /** Find the destination declaration for a declarator reference. */
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

    return { file: parsedFile.absolutePath, range: toRange(binding), label: parsedFile.source.slice(binding.start, binding.end) };
  };

  /** Find the local function parameter receiving a call argument. */
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

  /** Find a declaration receiving a captured call result. */
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

  /** Enqueue direct and transitive importer aliases for an exported seed. */
  private readonly enqueueImporters = (
    seed: UsageSeed,
    parsedFile: ParsedFile,
    sourceNode: UsageNode,
    parsedFiles: Map<AbsolutePath, ParsedFile>,
    queue: Array<{ seed: UsageSeed; addStart: boolean }>,
    addNode: (
      file: AbsolutePath,
      node: AstNode,
      kind: UsageKind,
      continuation?: UsageContinuation,
    ) => UsageNode | null,
    addEdge: (from: UsageNode, to: UsageNode, kind: "read" | "import" | "continuation") => void,
  ): void => {
    const exported = collectExports(parsedFile.ast).find((binding) => binding.localName === seed.name);
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

    for (const importer of this.projectIndex.findImporters(parsedFile.absolutePath, exported.exportedName)) {
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
          seed: this.seedExpander.fromBinding(importerFile, importer.localAlias, importInfo.bindingNode),
          addStart: false,
        });
      }
    }
  };

  /** Find a file in the caller map or parser cache. */
  private readonly getParsedFile = (
    file: AbsolutePath,
    parsedFiles: Map<AbsolutePath, ParsedFile>,
  ): ParsedFile | null => parsedFiles.get(file) ?? this.parser.getCache().get(file) ?? null;

  /** Locate the top-level export boundary containing a local binding. */
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

  /** Locate an import or re-export statement and its local binding, if any. */
  private readonly findImportBoundary = (
    ast: AstNode,
    alias: SourceText,
  ): { boundary: AstNode; bindingNode: AstNode | null } | null => {
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

  /** Build scopes for a parsed file. */
  private readonly buildScopesFor = (parsedFile: ParsedFile) =>
    // The shared scope builder is kept behind this method to centralize call-site resolution.
    this.referenceFinderScopes(parsedFile);

  /** Resolve a name from the shared lexical scope list. */
  private readonly resolveName = (
    name: SourceText,
    node: AstNode,
    scopes: Scope[],
  ) => {
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

  /** Resolve scopes through the shared lexical scope implementation. */
  private readonly referenceFinderScopes = (parsedFile: ParsedFile) => {
    // Importing the helper here avoids a second scope implementation in the slicer.
    return buildScopes(parsedFile.ast);
  };

  /** Check whether one scope is contained by another. */
  private readonly isWithinScope = (inner: AstNode, outer: AstNode): boolean =>
    inner.start >= outer.start && inner.end <= outer.end;
}
