import { isAstNode } from "@/helpers/ast-walker";
import type { AstNode, Scope, SourceText } from "@/types";
import { assertNever } from "assert-never";
import { visitorKeys } from "oxc-parser";

/**
 * Create an empty scope for an AST container.
 *
 * @param node AST node that owns the scope.
 * @param kind Scope classification.
 * @returns Scope with an empty binding map.
 */
const createScope = (node: AstNode, kind: Scope["kind"]): Scope => ({
  node,
  kind,
  bindings: new Map<SourceText, AstNode>(),
});

/**
 * Find the nearest function or program scope for `var` declarations.
 *
 * @param scopeStack Active scope stack.
 * @returns Nearest non-block scope.
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
 * Add identifiers bound by a destructuring pattern to the target scope.
 * @param pattern Binding pattern to inspect.
 * @param scope Lexical scope receiving the binding.
 */
const registerPatternBindings = (pattern: AstNode, scope: Scope): void => {
  switch (pattern.type) {
    case "Identifier": {
      scope.bindings.set(pattern.name, pattern);
      break;
    }
    case "RestElement": {
      registerPatternBindings(pattern.argument, scope);
      break;
    }
    case "AssignmentPattern": {
      registerPatternBindings(pattern.left, scope);
      break;
    }
    case "ArrayPattern": {
      for (const element of pattern.elements) {
        if (element) {
          registerPatternBindings(element, scope);
        }
      }
      break;
    }
    case "ObjectPattern":
      {
        for (const property of pattern.properties) {
          registerPatternBindings(
            property.type === "RestElement" ? property.argument : property.value,
            scope,
          );
        }
      }
      break;
  }
};

/**
 * Register declarations encountered at the current traversal position.
 *
 * @param node AST node that may introduce a binding.
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
        if (declarator.id.type === "Identifier") {
          targetScope.bindings.set(declarator.id.name, declarator);
        } else {
          registerPatternBindings(declarator.id, targetScope);
        }
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
 * Register parameters in a function scope.
 *
 * @param node Function-like AST node.
 * @param scope Function scope receiving parameter bindings.
 */
const registerFunctionParams = (node: AstNode, scope: Scope): void => {
  switch (node.type) {
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
    case "TSDeclareFunction":
    case "TSEmptyBodyFunctionExpression":
      for (const parameter of node.params) {
        if (parameter.type === "Identifier") {
          scope.bindings.set(parameter.name, parameter);
        }
      }
      return;
    default:
      return;
  }
};

/**
 * Build scopes and their bindings for a parsed AST.
 *
 * @param root AST root to inspect.
 * @returns All program, function, and block scopes in traversal order.
 */
export const buildScopes = (root: AstNode): Scope[] => {
  if (root.type !== "Program") {
    return [];
  }

  const scopes: Scope[] = [];
  const programScope = createScope(root, "program");
  scopes.push(programScope);

  /**
   * Register declarations while descending through nested lexical scopes.
   * @param node Current AST node whose declarations are registered.
   * @param scopeStack Active lexical scopes from outermost to innermost.
   */
  const traverse = (node: AstNode, scopeStack: Scope[]): void => {
    registerBindings(node, scopeStack);

    let nextScope: Scope | null = null;
    switch (node.type) {
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
      case "TSDeclareFunction":
      case "TSEmptyBodyFunctionExpression":
        nextScope = createScope(node, "function");
        registerFunctionParams(node, nextScope);
        break;
      case "BlockStatement":
        nextScope = createScope(node, "block");
        break;
      case "CatchClause":
        nextScope = createScope(node, "block");
        if (node.param) {
          registerPatternBindings(node.param, nextScope);
        }
        break;
      default:
        break;
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
 * Find the scope owned by a specific AST node.
 *
 * @param scopes Scopes previously produced by `buildScopes`.
 * @param node AST node that should own the scope.
 * @returns The matching scope, or null when the node is not a scope.
 */
export const findScopeByNode = (scopes: Scope[], node: AstNode): Scope | null =>
  scopes.find((scope) => scope.node === node) ?? null;

/**
 * Resolve a name using scopes that contain a reference node.
 *
 * @param name Binding name to resolve.
 * @param referenceNode AST node where the name is used.
 * @param scopes Scopes previously produced by `buildScopes`.
 * @returns Declaring scope and binding node, or null when unresolved.
 */
export const resolveBindingInScopes = (
  name: SourceText,
  referenceNode: AstNode,
  scopes: Scope[],
): {
  /** AST node that declares the resolved name. */
  binding: AstNode;
  /** Scope that owns the resolved binding. */
  scope: Scope;
} | null => {
  const candidates = scopes
    .filter(
      (scope) => scope.node.start <= referenceNode.start && scope.node.end >= referenceNode.end,
    )
    .sort((left, right) => {
      const leftSize = left.node.end - left.node.start;
      const rightSize = right.node.end - right.node.start;
      return leftSize - rightSize;
    });

  for (const scope of candidates) {
    const binding = scope.bindings.get(name);
    if (binding) {
      return { binding, scope };
    }
  }

  return null;
};
