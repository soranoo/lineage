import { assertNever } from "assert-never";

import type { AstNode, OffsetRange, SeedNode, SourceText } from "@/types";

import { walkAst } from "@/helpers/ast-walker";

/**
 * Check whether the node falls fully within a sub-expression range.
 *
 * @param node AST node to test.
 * @param range Sub-expression range to apply.
 * @returns True when the node is fully inside the range.
 */
const isWithinRange = (node: AstNode, range: OffsetRange): boolean =>
  node.start >= range.start && node.end <= range.end;

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
 * Collect identifier names from a subtree, optionally filtered by range.
 *
 * @param root AST node to scan.
 * @param range Optional sub-expression range to constrain results.
 * @returns Ordered list of unique identifier names.
 */
const collectIdentifierNames = (root: AstNode, range: OffsetRange | null): SourceText[] => {
  const names: SourceText[] = [];
  const seen = new Set<SourceText>();

  walkAst(root, (node, parent) => {
    if (node.type !== "Identifier") {
      return;
    }

    if (!isReferenceIdentifier(node, parent)) {
      return;
    }

    if (range !== null && !isWithinRange(node, range)) {
      return;
    }

    if (seen.has(node.name)) {
      return;
    }

    seen.add(node.name);
    names.push(node.name);
  });

  return names;
};

/**
 * Extracts initial binding names from a seed node.
 */
export class SeedExpander {
  /**
   * Expands the seed node into its initial referenced bindings.
   *
   * @param seedNode Seed AST node used as the slicing anchor.
   * @param subExprRange Optional sub-expression range when the seed is a statement.
   * @returns Ordered list of binding names to seed the worklist.
   */
  readonly expand = (seedNode: SeedNode, subExprRange: OffsetRange | null): SourceText[] => {
    switch (seedNode.type) {
      case "ReturnStatement":
        return seedNode.argument === null
          ? []
          : collectIdentifierNames(seedNode.argument, subExprRange);
      case "VariableDeclaration": {
        const names: SourceText[] = [];

        for (const declarator of seedNode.declarations) {
          if (declarator.init === null) {
            continue;
          }

          const values = collectIdentifierNames(declarator.init, subExprRange);
          for (const value of values) {
            if (!names.includes(value)) {
              names.push(value);
            }
          }
        }

        return names;
      }
      case "ExpressionStatement":
        return collectIdentifierNames(seedNode.expression, subExprRange);
      case "AssignmentExpression":
        return collectIdentifierNames(seedNode.right, subExprRange);
      case "IfStatement":
        return collectIdentifierNames(seedNode.test, subExprRange);
      case "SwitchStatement":
        return collectIdentifierNames(seedNode.discriminant, subExprRange);
      case "WhileStatement":
        return collectIdentifierNames(seedNode.test, subExprRange);
      case "DoWhileStatement":
        return collectIdentifierNames(seedNode.test, subExprRange);
      case "ForStatement":
        return Array.from(
          new Set([
            ...(seedNode.init ? collectIdentifierNames(seedNode.init, subExprRange) : []),
            ...(seedNode.test ? collectIdentifierNames(seedNode.test, subExprRange) : []),
            ...(seedNode.update ? collectIdentifierNames(seedNode.update, subExprRange) : []),
          ]),
        );
      case "ForInStatement":
      case "ForOfStatement":
        return Array.from(
          new Set([
            ...collectIdentifierNames(seedNode.left, subExprRange),
            ...collectIdentifierNames(seedNode.right, subExprRange),
          ]),
        );
      default:
        return assertNever(seedNode);
    }
  };
}
