import { visitorKeys } from "oxc-parser";

import { isAstNode } from "@/helpers/ast-walker";
import { buildScopes, findScopeByNode, resolveBindingInScopes } from "@/helpers/scope";
import type {
  AstNode,
  ParsedFile,
  ReferenceKind,
  ReferenceParentContext,
  ReferenceSite,
  SourceText,
} from "@/types";

/**
 * Finds direct reads and writes of one binding across its scope and closures.
 *
 * Shadowed bindings are resolved against the shared lexical scope model, so an
 * inner declaration with the same name is never attributed to the outer one.
 */
export class ReferenceFinder {
  /**
   * Find every reference to `name` owned by `scopeNode`.
   *
   * @param name Binding name to find.
   * @param scopeNode Scope that declares the binding.
   * @param parsedFile Parsed source file containing the binding.
   * @returns Direct reference sites in source order.
   */
  readonly find = (
    name: SourceText,
    scopeNode: AstNode,
    parsedFile: ParsedFile,
  ): ReferenceSite[] => {
    const scopes = buildScopes(parsedFile.ast);
    const targetScope = findScopeByNode(scopes, scopeNode);
    const targetBinding = targetScope?.bindings.get(name);

    if (!targetScope || !targetBinding) {
      return [];
    }

    const references: ReferenceSite[] = [];
    const functionStack: AstNode[] = [];

    const visit = (node: AstNode, parent: AstNode | null): void => {
      if (node.type === "Identifier" && node.name === name && this.isReference(node, parent)) {
        const resolved = resolveBindingInScopes(name, node, scopes);
        if (resolved?.binding === targetBinding && resolved.scope.node.start >= targetScope.node.start) {
          references.push({
            node,
            kind: this.referenceKind(node, parent),
            insideClosure: this.isInsideClosure(functionStack, scopeNode),
            parentContext: this.parentContext(node, parent),
          });
        }
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
                this.visitChild(entry, node, functionStack, visit);
              }
            }
            continue;
          }

          if (isAstNode(value)) {
            this.visitChild(value, node, functionStack, visit);
          }
        }
      }
    };

    visit(scopeNode, null);
    return references;
  };

  /**
   * Traverse one child while maintaining the enclosing function stack.
   *
   * @param child Child AST node to visit.
   * @param parent Parent AST node for the child.
   * @param functionStack Active function ancestors.
   * @param visit Visitor callback for the child.
   */
  private readonly visitChild = (
    child: AstNode,
    parent: AstNode,
    functionStack: AstNode[],
    visit: (node: AstNode, parent: AstNode | null) => void,
  ): void => {
    const isFunction = this.isFunctionNode(child);
    if (isFunction) {
      functionStack.push(child);
    }

    visit(child, parent);

    if (isFunction) {
      functionStack.pop();
    }
  };

  /**
   * Check whether an identifier is a reference rather than a declaration.
   *
   * @param node Identifier node to inspect.
   * @param parent Immediate parent node.
   * @returns True when the identifier is a read or write reference.
   */
  private readonly isReference = (node: AstNode, parent: AstNode | null): boolean => {
    if (parent === null) {
      return false;
    }

    switch (parent.type) {
      case "VariableDeclarator":
        return parent.id !== node;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
      case "TSDeclareFunction":
      case "TSEmptyBodyFunctionExpression":
        return parent.id !== node && !parent.params.some((parameter) => parameter === node);
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
      case "ExportSpecifier":
        return parent.local !== node && parent.exported !== node;
      case "CatchClause":
        return parent.param !== node;
      default:
        return true;
    }
  };

  /**
   * Classify whether an identifier reference reads or writes its binding.
   *
   * @param node Identifier node to inspect.
   * @param parent Immediate parent node.
   * @returns Read/write classification.
   */
  private readonly referenceKind = (node: AstNode, parent: AstNode | null): ReferenceKind => {
    if (!parent) {
      return "read";
    }

    switch (parent.type) {
      case "AssignmentExpression":
        return parent.left === node ? "write" : "read";
      case "UpdateExpression":
        return parent.argument === node ? "write" : "read";
      default:
        return "read";
    }
  };

  /**
   * Classify the structural context surrounding a reference.
   *
   * @param node Identifier node to inspect.
   * @param parent Immediate parent node.
   * @returns Context tag consumed by forward usage classification.
   */
  private readonly parentContext = (
    node: AstNode,
    parent: AstNode | null,
  ): ReferenceParentContext => {
    if (!parent) {
      return "read";
    }

    switch (parent.type) {
      case "VariableDeclarator":
        return parent.id.type === "Identifier" ? "declarator" : "destructure";
      case "CallExpression":
      case "NewExpression":
        return parent.callee === node ? "read" : "call-argument";
      case "ReturnStatement":
        return "return";
      case "SpreadElement":
        return "spread";
      case "AssignmentExpression":
        if (parent.left === node) {
          return "write";
        }
        return parent.left.type === "MemberExpression" ? "property-write" : "read";
      case "UpdateExpression":
        return "write";
      default:
        return "read";
    }
  };

  /**
   * Check whether a reference is in a nested function relative to the seed.
   *
   * @param functionStack Active function ancestors.
   * @param scopeNode Scope supplied to `find`.
   * @returns True when the reference is inside a nested closure.
   */
  private readonly isInsideClosure = (functionStack: AstNode[], scopeNode: AstNode): boolean => {
    const rootFunction = this.isFunctionNode(scopeNode) ? scopeNode : null;
    return functionStack.some((functionNode) => functionNode !== rootFunction);
  };

  /**
   * Check whether a node introduces a function scope.
   *
   * @param node AST node to inspect.
   * @returns True when the node is function-like.
   */
  private readonly isFunctionNode = (node: AstNode): boolean => {
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
}