import { walkAst } from "@/helpers";
import { buildScopes } from "@/helpers/scope";
import type { AstNode, OffsetRange, ParsedFile, SourceText, UsageSeed } from "@/types";
import { StartPointNotFoundError } from "@/types";

const containsRange = (node: AstNode, range: OffsetRange): boolean =>
  node.start <= range.start && node.end >= range.end;

const isBindingIdentifier = (node: AstNode, parent: AstNode | null): boolean => {
  if (node.type !== "Identifier" || parent === null) {
    return false;
  }

  switch (parent.type) {
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
    case "TSDeclareFunction":
    case "TSEmptyBodyFunctionExpression":
      return parent.id === node || parent.params.some((parameter) => parameter === node);
    case "ImportSpecifier":
    case "ImportDefaultSpecifier":
    case "ImportNamespaceSpecifier":
      return parent.local === node;
    case "Property":
      return parent.value === node;
    case "ClassDeclaration":
    case "ClassExpression":
      return parent.id === node;
    default:
      return false;
  }
};

const findContainingScope = (parsedFile: ParsedFile, declaration: AstNode): AstNode => {
  const scopes = buildScopes(parsedFile.ast)
    .filter((scope) => containsRange(scope.node, declaration))
    .sort((left, right) => {
      const leftSize = left.node.end - left.node.start;
      const rightSize = right.node.end - right.node.start;
      return leftSize - rightSize;
    });

  const bindingScope = scopes.find((scope) =>
    [...scope.bindings.values()].some((binding) => binding === declaration),
  );

  return bindingScope?.node ?? scopes[0]?.node ?? parsedFile.ast;
};

const findName = (node: AstNode): SourceText | null =>
  node.type === "Identifier" ? node.name : null;

/** Resolves a forward-tracking start range to one declared binding. */
export class UsageSeedExpander {
  /**
   * Resolve the declaration selected by `startPoint`.
   *
   * @param parsedFile Parsed file containing the requested declaration.
   * @param startPoint Character range identifying the declaration or binding.
   * @returns One forward-tracking seed.
   * @throws {StartPointNotFoundError} When the range is not a declaration.
   */
  readonly expand = (parsedFile: ParsedFile, startPoint: OffsetRange): UsageSeed => {
    const candidates: Array<{ node: AstNode; bindingNode: AstNode; name: SourceText }> = [];

    walkAst(parsedFile.ast, (node, parent) => {
      if (!containsRange(node, startPoint)) {
        return;
      }

      if (node.type === "VariableDeclarator") {
        const name = findName(node.id);
        if (name !== null) {
          candidates.push({
            node:
              parent?.type === "VariableDeclaration" && startPoint.start <= parent.start
                ? parent
                : node,
            bindingNode: node.id,
            name,
          });
        }
      }

      if (node.type === "VariableDeclaration" && startPoint.start <= node.start) {
        const declarator = node.declarations.find((entry) => findName(entry.id) !== null);
        const name = declarator === undefined ? null : findName(declarator.id);
        if (declarator !== undefined && name !== null) {
          candidates.push({ node, bindingNode: declarator, name });
        }
      }

      if (node.type === "ExportNamedDeclaration" && node.declaration !== null) {
        const declaration = node.declaration;
        const bindingNode =
          declaration.type === "VariableDeclaration"
            ? declaration.declarations.find((entry) => findName(entry.id) !== null)
            : declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration"
              ? declaration
              : undefined;
        const name =
          bindingNode?.type === "VariableDeclarator"
            ? findName(bindingNode.id)
            : bindingNode?.id?.type === "Identifier"
              ? bindingNode.id.name
              : null;
        if (bindingNode !== undefined && name !== null) {
          candidates.push({
            node: declaration.type === "VariableDeclaration" ? declaration : bindingNode,
            bindingNode,
            name,
          });
        }
      }

      if (
        node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ClassDeclaration" ||
        node.type === "ClassExpression"
      ) {
        const name = node.id?.type === "Identifier" ? node.id.name : null;
        if (name !== null) {
          candidates.push({ node, bindingNode: node, name });
        }
      }

      if (isBindingIdentifier(node, parent)) {
        const name = findName(node);
        if (name !== null) {
          candidates.push({ node, bindingNode: node, name });
        }
      }
    });

    const selected = candidates.sort((left, right) => {
      const leftSize = left.node.end - left.node.start;
      const rightSize = right.node.end - right.node.start;
      return leftSize - rightSize;
    })[0];

    if (selected === undefined) {
      throw new StartPointNotFoundError(parsedFile.absolutePath, startPoint);
    }

    return {
      file: parsedFile.absolutePath,
      name: selected.name,
      declaration: selected.node,
      scopeNode: findContainingScope(parsedFile, selected.bindingNode),
    };
  };

  /**
   * Create a queue seed for a binding already identified in another file.
   *
   * @param parsedFile Parsed file containing the binding.
   * @param name Local binding name.
   * @param declaration AST node introducing the binding.
   * @returns Forward-tracking seed for the existing binding.
   */
  readonly fromBinding = (
    parsedFile: ParsedFile,
    name: SourceText,
    declaration: AstNode,
  ): UsageSeed => ({
    file: parsedFile.absolutePath,
    name,
    declaration,
    scopeNode: findContainingScope(parsedFile, declaration),
  });
}
