import assertNever from "assert-never";

import { isAstNode, walkAst } from "@/helpers";
import { buildScopes } from "@/helpers/scope";
import type { AstNode, LiteralValue, ParsedFile, Scope, ScopeKind, SourceText } from "@/types";

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
 * Convert a statically known literal into a member-property name.
 *
 * @param value Literal value to convert.
 * @returns Property name representation.
 */
const toPropertyName = (value: LiteralValue): SourceText => String(value);

/**
 * Resolves a name to a declaration node within a scope chain.
 */
export class BindingResolver {
  /**
   * Resolve statically known keys for a computed member expression.
   *
   * @param memberNode Member expression to inspect.
   * @param scopeNode AST node providing the lookup scope.
   * @param parsedFile Parsed file containing the expression.
   * @returns Unique property names known from literals, locals, or call sites.
   */
  readonly resolveStaticPropertyKeys = (
    memberNode: AstNode,
    scopeNode: AstNode,
    parsedFile: ParsedFile,
  ): SourceText[] => {
    if (memberNode.type !== "MemberExpression" || !memberNode.computed) {
      return [];
    }

    const values = this.resolveStaticValues(memberNode.property, scopeNode, parsedFile, new Set());
    return [...new Set(values.map(toPropertyName))];
  };

  /**
   * Resolve every statically known primitive value for an expression.
   *
   * @param expression Expression whose value should be inspected.
   * @param scopeNode AST node providing the lookup scope.
   * @param parsedFile Parsed file containing the expression.
   * @returns Literal values known without evaluating arbitrary code.
   */
  private readonly resolveStaticValues = (
    expression: AstNode,
    scopeNode: AstNode,
    parsedFile: ParsedFile,
    resolving: Set<AstNode>,
  ): LiteralValue[] => {
    switch (expression.type) {
      case "Literal": {
        switch (typeof expression.value) {
          case "string":
          case "number":
          case "boolean": {
            return [expression.value];
          }
          case "bigint":
          case "function":
          case "object":
          case "symbol":
          case "undefined":
            break;
          default:
            assertNever(expression.value);
        }

        return [];
      }
      case "TemplateLiteral": {
        if (expression.expressions.length !== 0) {
          return [];
        }

        const [quasi] = expression.quasis;
        const cooked = quasi?.value.cooked;
        return cooked === null || cooked === undefined ? [] : [cooked];
      }
      case "TSAsExpression":
        return this.resolveStaticValues(expression.expression, scopeNode, parsedFile, resolving);
      case "Identifier": {
        const resolved = this.resolveWithScope(expression.name, scopeNode, parsedFile);

        if (!resolved || resolving.has(resolved.node)) {
          return [];
        }

        resolving.add(resolved.node);

        try {
          if (resolved.node.type === "VariableDeclarator" && resolved.node.init) {
            return this.resolveStaticValues(
              resolved.node.init,
              resolved.scopeNode,
              parsedFile,
              resolving,
            );
          }

          if (resolved.node.type === "Identifier" && isFunctionScopeNode(resolved.scopeNode)) {
            return this.resolveParameterValues(
              resolved.node,
              resolved.scopeNode,
              parsedFile,
              resolving,
            );
          }

          return [];
        } finally {
          resolving.delete(resolved.node);
        }
      }
      default:
        return [];
    }
  };

  /**
   * Resolve literal arguments supplied to every call of a named function.
   *
   * @param parameterNode Parameter whose arguments should be collected.
   * @param functionNode Function owning the parameter.
   * @param parsedFile Parsed file containing declarations and calls.
   * @param resolving Active resolution set used to stop cycles.
   * @returns Literal values supplied at matching call sites.
   */
  private readonly resolveParameterValues = (
    parameterNode: AstNode,
    functionNode: FunctionScopeNode,
    parsedFile: ParsedFile,
    resolving: Set<AstNode>,
  ): LiteralValue[] => {
    const parameterIndex = functionNode.params.findIndex(
      (parameter) => parameter === parameterNode,
    );
    const functionName = functionNode.id?.type === "Identifier" ? functionNode.id.name : null;

    if (parameterIndex < 0 || functionName === null) {
      return [];
    }

    const values: LiteralValue[] = [];

    walkAst(parsedFile.ast, (node) => {
      if (node.type !== "CallExpression" || node.callee.type !== "Identifier") {
        return;
      }

      if (node.callee.name !== functionName) {
        return;
      }

      const resolvedCallee = this.resolveWithScope(node.callee.name, node.callee, parsedFile);
      if (resolvedCallee?.node !== functionNode) {
        return;
      }

      const argument = node.arguments[parameterIndex];
      if (!argument || !isAstNode(argument)) {
        return;
      }

      values.push(...this.resolveStaticValues(argument, functionNode, parsedFile, resolving));
    });

    return values;
  };

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
