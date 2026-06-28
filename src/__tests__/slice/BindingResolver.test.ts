import { describe, expect, it } from "vitest";

import type { AbsolutePath, AstNode, ParsedFile, SourceText } from "@/types";

import { walkAst } from "@/helpers/ast-walker";
import { OxcParser } from "@/parse/OxcParser";
import { BindingResolver } from "@/slice/BindingResolver";

const entryFile: AbsolutePath = "/project/src/entry.ts";

/**
 * Parse source text into a ParsedFile.
 *
 * @param source Source text to parse.
 * @returns ParsedFile for the provided source.
 */
const parseSource = (source: SourceText): ParsedFile => {
  const parser = new OxcParser();
  return parser.parse(entryFile, source);
};

/**
 * Find the first AST node matching the predicate.
 *
 * @param root Root AST node.
 * @param predicate Predicate narrowing the node.
 * @param message Error message when not found.
 * @returns Matching AST node.
 */
const findNode = (
  root: AstNode,
  predicate: (node: AstNode) => boolean,
  message: string,
): AstNode => {
  let found: AstNode | null = null;

  walkAst(root, (node) => {
    if (!found && predicate(node)) {
      found = node;
    }
  });

  if (!found) {
    throw new Error(message);
  }

  return found;
};

/**
 * Determine whether an identifier is a reference rather than a binding.
 *
 * @param node AST node to inspect.
 * @param parent Parent AST node.
 * @returns True when the identifier is a reference.
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
 * Find an identifier reference by name.
 *
 * @param root Root AST node.
 * @param name Identifier name to match.
 * @returns Identifier node reference.
 */
const findIdentifierReference = (root: AstNode, name: SourceText): AstNode => {
  const predicate = (node: AstNode): boolean => node.type === "Identifier" && node.name === name;

  let found: AstNode | null = null;

  walkAst(root, (node, parent) => {
    if (found) {
      return;
    }

    if (!predicate(node)) {
      return;
    }

    if (!isReferenceIdentifier(node, parent)) {
      return;
    }

    found = node;
  });

  if (!found) {
    throw new Error(`Identifier reference "${name}" not found`);
  }

  return found;
};

/**
 * Check whether a node is a function declaration with the given name.
 *
 * @param name Identifier name to match.
 * @returns Predicate for FunctionDeclaration.
 */
const isFunctionDeclarationNamed =
  (name: SourceText) =>
  (node: AstNode): boolean => node.type === "FunctionDeclaration" && node.id?.name === name;

/**
 * Check whether a node is an import declaration.
 *
 * @param node AST node to inspect.
 * @returns True when the node is an import declaration.
 */
const isImportDeclaration = (node: AstNode): boolean => node.type === "ImportDeclaration";

describe("BindingResolver", () => {
  it("resolves a variable declarator", () => {
    const parsed = parseSource("const value = 1; const result = value + 1;");
    const reference = findIdentifierReference(parsed.ast, "value");
    const resolver = new BindingResolver();

    const resolved = resolver.resolve("value", reference, parsed);

    expect(resolved?.type).toBe("VariableDeclarator");
  });

  it("resolves a function declaration", () => {
    const parsed = parseSource("function add(a, b) { return a + b; } const result = add(1, 2);");
    const reference = findIdentifierReference(parsed.ast, "add");
    const resolver = new BindingResolver();

    const resolved = resolver.resolve("add", reference, parsed);

    expect(resolved?.type).toBe("FunctionDeclaration");
  });

  it("resolves a function parameter", () => {
    const parsed = parseSource("function sum(total) { return total; }");
    const reference = findIdentifierReference(parsed.ast, "total");
    const resolver = new BindingResolver();

    const resolved = resolver.resolve("total", reference, parsed);

    expect(resolved?.type).toBe("Identifier");
  });

  it("resolves an import specifier to its import declaration", () => {
    const parsed = parseSource("import { add } from './math'; const result = add(1, 2);");
    const reference = findIdentifierReference(parsed.ast, "add");
    const resolver = new BindingResolver();

    const resolved = resolver.resolve("add", reference, parsed);

    expect(resolved?.type).toBe("ImportDeclaration");
  });

  it("returns null when a binding is not found", () => {
    const parsed = parseSource("const value = 1; const result = value + 1;");
    const resolver = new BindingResolver();

    const resolved = resolver.resolve("missing", parsed.ast, parsed);

    expect(resolved).toBeNull();
  });

  it("resolves shadowed bindings to the inner scope", () => {
    const parsed = parseSource(
      "const value = 1; function outer() { const value = 2; return value; }",
    );
    const reference = findIdentifierReference(parsed.ast, "value");
    const outerFunction = findNode(
      parsed.ast,
      isFunctionDeclarationNamed("outer"),
      "Outer function not found",
    );

    if (outerFunction.type !== "FunctionDeclaration" || !outerFunction.body) {
      throw new Error("Outer function body not found");
    }

    const innerDeclaration = outerFunction.body.body.find(
      (statement: AstNode) => statement.type === "VariableDeclaration",
    );

    if (!innerDeclaration) {
      throw new Error("Inner variable declaration not found");
    }

    const innerDeclarator = innerDeclaration.declarations[0];

    if (!innerDeclarator) {
      throw new Error("Inner variable declarator not found");
    }
    const resolver = new BindingResolver();

    const resolved = resolver.resolve("value", reference, parsed);

    expect(resolved?.type).toBe("VariableDeclarator");
    expect(resolved?.start).toBe(innerDeclarator.start);
  });

  it("resolves import declarations as scope roots", () => {
    const parsed = parseSource("import { format } from './utils'; format('hi');");
    const reference = findIdentifierReference(parsed.ast, "format");
    const importDeclaration = findNode(parsed.ast, isImportDeclaration, "ImportDeclaration not found");
    const resolver = new BindingResolver();

    const resolved = resolver.resolve("format", reference, parsed);

    expect(resolved?.start).toBe(importDeclaration.start);
  });

  it("returns the nearest function declaration for direct references", () => {
    const parsed = parseSource(
      "function outer() { function inner() { return 1; } return inner(); }",
    );
    const reference = findIdentifierReference(parsed.ast, "inner");
    const declaration = findNode(
      parsed.ast,
      isFunctionDeclarationNamed("inner"),
      "Function declaration not found",
    );
    const resolver = new BindingResolver();

    const resolved = resolver.resolve("inner", reference, parsed);

    expect(resolved?.start).toBe(declaration.start);
  });
});
