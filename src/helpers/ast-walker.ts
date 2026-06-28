import { visitorKeys } from "oxc-parser";

import type { AstNode } from "@/types";

/**
 * Visitor callback invoked for each AST node during traversal.
 */
export type AstVisit = (node: AstNode, parent: AstNode | null) => void;

/**
 * Check whether a value is a non-null object.
 *
 * @param value Value to inspect.
 * @returns True when the value is an object.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Check whether a value looks like an Oxc AST node.
 *
 * @param value Value to inspect.
 * @returns True when the value is an AST node.
 */
export const isAstNode = (value: unknown): value is AstNode => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.type === "string" &&
    typeof value.start === "number" &&
    typeof value.end === "number"
  );
};

/**
 * Walk an AST subtree depth-first, invoking `visit` for each node.
 *
 * @param root Root AST node to traverse.
 * @param visit Callback invoked for each node.
 */
export const walkAst = (root: AstNode, visit: AstVisit): void => {
  const seen = new Set<AstNode>();

  const traverse = (node: AstNode, parent: AstNode | null): void => {
    if (seen.has(node)) {
      return;
    }

    seen.add(node);
    visit(node, parent);

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
