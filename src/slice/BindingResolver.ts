import { visitorKeys } from "oxc-parser";
import assertNever from "assert-never";

import type { AstNode, ParsedFile, SourceText } from "@/types";

import { isAstNode } from "@/helpers/ast-walker";

/**
 * Scope classification used during binding lookup.
 */
type ScopeKind = "program" | "function" | "block";

/**
 * Scope container with collected bindings.
 */
type Scope = {
  /** AST node that owns the scope. */
  node: AstNode;
  /** Scope classification. */
  kind: ScopeKind;
  /** Binding map keyed by identifier name. */
  bindings: Map<SourceText, AstNode>;
};

/**
 * Function-like nodes that introduce function scopes.
 */
type FunctionScopeNode = Extract<
  AstNode,
  {
    type:
      | "FunctionDeclaration"
      | "FunctionExpression"
      | "ArrowFunctionExpression"
      | "TSDeclareFunction"
      | "TSEmptyBodyFunctionExpression";
  }
>;

/**
 * Program root node type.
 */
type ProgramNode = Extract<AstNode, { type: "Program" }>;

/**
 * Binding lookup result including the owning scope.
 */
type ResolvedBinding = {
  /** AST node that defines the binding. */
  node: AstNode;
  /** Scope kind where the binding was declared. */
  scopeKind: ScopeKind;
  /** Scope node that owns the binding. */
  scopeNode: AstNode;
};

/**
 * Create a new scope record.
 *
 * @param node AST node that owns the scope.
 * @param kind Scope classification for the node.
 * @returns Initialized scope record.
 */
const createScope = (node: AstNode, kind: ScopeKind): Scope => ({
  node,
  kind,
  bindings: new Map<SourceText, AstNode>(),
});

/**
 * Check whether a node represents a function-like scope.
 *
 * @param node AST node to inspect.
 * @returns True when the node defines a function scope.
 */
const isFunctionScopeNode = (node: AstNode): node is FunctionScopeNode =>
  node.type === "FunctionDeclaration" ||
  node.type === "FunctionExpression" ||
  node.type === "ArrowFunctionExpression" ||
  node.type === "TSDeclareFunction" ||
  node.type === "TSEmptyBodyFunctionExpression";

/**
 * Check whether a node represents a block scope.
 *
 * @param node AST node to inspect.
 * @returns True when the node defines a block scope.
 */
const isBlockScopeNode = (node: AstNode): boolean => node.type === "BlockStatement";

/**
 * Check whether a node is the program root.
 *
 * @param node AST node to inspect.
 * @returns True when the node is the program root.
 */
const isProgramNode = (node: AstNode): node is ProgramNode => node.type === "Program";

/**
 * Find the nearest non-block scope in a scope stack.
 *
 * @param scopeStack Active scope stack.
 * @returns Nearest function or program scope.
 */
const findNearestNonBlockScope = (scopeStack: Scope[]): Scope => {
  for (let index = scopeStack.length - 1; index >= 0; index -= 1) {
    const scope = scopeStack[index];
    if (scope && scope.kind !== "block") {
      return scope;
    }
  }

  const fallback = scopeStack[0];

  if (!fallback) {
    throw new Error("Scope stack is empty.");
  }

  return fallback;
};

/**
 * Register bindings declared by the current node into the scope stack.
 *
 * @param node AST node that may declare bindings.
 * @param scopeStack Active scope stack.
 */
const registerBindings = (node: AstNode, scopeStack: Scope[]): void => {
  const currentScope = scopeStack[scopeStack.length - 1];

  if (!currentScope) {
    return;
  }

  switch (node.type) {
    case "VariableDeclaration": {
      const targetScope = node.kind === "var" ? findNearestNonBlockScope(scopeStack) : currentScope;

      for (const declarator of node.declarations) {
        if (declarator.id.type !== "Identifier") {
          continue;
        }

        targetScope.bindings.set(declarator.id.name, declarator);
      }
      return;
    }
    case "FunctionDeclaration":
      if (node.id !== null) {
        currentScope.bindings.set(node.id.name, node);
      }
      return;
    case "ClassDeclaration":
      if (node.id !== null) {
        currentScope.bindings.set(node.id.name, node);
      }
      return;
    case "ImportDeclaration": {
      const programScope = scopeStack.find((scope) => scope.kind === "program") ?? currentScope;

      for (const specifier of node.specifiers) {
        switch (specifier.type) {
          case "ImportSpecifier":
          case "ImportDefaultSpecifier":
          case "ImportNamespaceSpecifier":
            programScope.bindings.set(specifier.local.name, node);
            break;
          default:
            assertNever(specifier);
        }
      }
      return;
    }
    default:
      return;
  }
};

/**
 * Register function parameters into a scope.
 *
 * @param node Function AST node.
 * @param scope Scope to populate with parameter bindings.
 */
const registerFunctionParams = (node: AstNode, scope: Scope): void => {
  if (!isFunctionScopeNode(node)) {
    return;
  }

  for (const param of node.params) {
    if (param.type !== "Identifier") {
      continue;
    }

    scope.bindings.set(param.name, param);
  }
};

/**
 * Build a list of scopes with bindings for the provided AST.
 *
 * @param root Program AST to analyze.
 * @returns Collected scopes with declared bindings.
 */
const buildScopes = (root: AstNode): Scope[] => {
  const scopes: Scope[] = [];

  if (!isProgramNode(root)) {
    return scopes;
  }

  const programScope = createScope(root, "program");
  scopes.push(programScope);

  const traverse = (node: AstNode, scopeStack: Scope[]): void => {
    registerBindings(node, scopeStack);

    let nextScope: Scope | null = null;

    if (isFunctionScopeNode(node)) {
      nextScope = createScope(node, "function");
      registerFunctionParams(node, nextScope);
    } else if (isBlockScopeNode(node)) {
      nextScope = createScope(node, "block");
    }

    if (nextScope) {
      scopeStack.push(nextScope);
      scopes.push(nextScope);
    }

    const keys = visitorKeys[node.type];

    if (keys) {
      for (const key of keys) {
        if (key === "parent") {
          continue;
        }

        const value = Reflect.get(node, key);

        if (Array.isArray(value)) {
          for (const entry of value) {
            if (isAstNode(entry)) {
              traverse(entry, scopeStack);
            }
          }
          continue;
        }

        if (isAstNode(value)) {
          traverse(value, scopeStack);
        }
      }
    }

    if (nextScope) {
      scopeStack.pop();
    }
  };

  for (const statement of root.body) {
    traverse(statement, [programScope]);
  }

  return scopes;
};

/**
 * Check whether a candidate scope fully contains a target node range.
 *
 * @param scopeNode Scope node to test.
 * @param targetNode Target node to locate within the scope.
 * @returns True when the scope contains the target node range.
 */
const scopeContainsNode = (scopeNode: AstNode, targetNode: AstNode): boolean =>
  scopeNode.start <= targetNode.start && scopeNode.end >= targetNode.end;

/**
 * Sort scopes by ascending size to locate the innermost scope first.
 *
 * @param scopes Scope list to sort.
 * @returns Sorted scope list.
 */
const sortScopesBySize = (scopes: Scope[]): Scope[] =>
  [...scopes].sort((left, right) => {
    const leftSize = left.node.end - left.node.start;
    const rightSize = right.node.end - right.node.start;

    return leftSize - rightSize;
  });

/**
 * Resolves a name to a declaration node within a scope chain.
 */
export class BindingResolver {
  /**
   * Resolve `name` to its declaration node and scope kind.
   *
   * @param name Binding name to resolve.
   * @param scopeNode AST node representing the lookup context.
   * @param parsedFile Parsed file containing the binding.
   * @returns Resolved binding info or null when not found.
   */
  readonly resolveWithScope = (
    name: SourceText,
    scopeNode: AstNode,
    parsedFile: ParsedFile,
  ): ResolvedBinding | null => {
    const scopes = buildScopes(parsedFile.ast);
    const candidates = sortScopesBySize(
      scopes.filter((scope) => scopeContainsNode(scope.node, scopeNode)),
    );

    for (const scope of candidates) {
      const binding = scope.bindings.get(name);

      if (binding !== undefined) {
        return { node: binding, scopeKind: scope.kind, scopeNode: scope.node };
      }
    }

    return null;
  };

  /**
   * Resolve `name` to its declaration node within the scope chain.
   *
   * @param name Binding name to resolve.
   * @param scopeNode AST node representing the lookup context.
   * @param parsedFile Parsed file containing the binding.
   * @returns Declaration node or null when not found.
   */
  readonly resolve = (
    name: SourceText,
    scopeNode: AstNode,
    parsedFile: ParsedFile,
  ): AstNode | null => this.resolveWithScope(name, scopeNode, parsedFile)?.node ?? null;
}
