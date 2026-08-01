import type {
  AssignmentExpression,
  CallExpression,
  ExpressionStatement,
  ReturnStatement,
  VariableDeclaration,
} from "@oxc-project/types";
import { describe, expect, it } from "vitest";

import { findNode, parseSource, toRange } from "@/__tests__/utils";
import { SeedExpander } from "@/slice";
import type { AstNode, SourceText } from "@/types";

/**
 * Check whether a node is a return statement.
 *
 * @param node AST node to inspect.
 * @returns True when the node is a return statement.
 */
const isReturnStatement = (node: AstNode): node is ReturnStatement =>
  node.type === "ReturnStatement";

/**
 * Check whether a return statement returns a call to the given callee.
 *
 * @param name Identifier name to match.
 * @returns Predicate for ReturnStatement.
 */
const isReturnStatementCalling =
  (name: SourceText) =>
  (node: AstNode): node is ReturnStatement =>
    node.type === "ReturnStatement" &&
    node.argument?.type === "CallExpression" &&
    node.argument.callee.type === "Identifier" &&
    node.argument.callee.name === name;

/**
 * Check whether a node is a variable declaration that declares the named identifier.
 *
 * @param name Identifier name to match.
 * @returns Predicate for VariableDeclaration.
 */
const isVariableDeclarationNamed =
  (name: SourceText) =>
  (node: AstNode): node is VariableDeclaration =>
    node.type === "VariableDeclaration" &&
    node.declarations.some(
      (declarator) => declarator.id.type === "Identifier" && declarator.id.name === name,
    );

/**
 * Check whether a node is an expression statement.
 *
 * @param node AST node to inspect.
 * @returns True when the node is an expression statement.
 */
const isExpressionStatement = (node: AstNode): node is ExpressionStatement =>
  node.type === "ExpressionStatement";

/**
 * Check whether a node is an assignment expression.
 *
 * @param node AST node to inspect.
 * @returns True when the node is an assignment expression.
 */
const isAssignmentExpression = (node: AstNode): node is AssignmentExpression =>
  node.type === "AssignmentExpression";

/**
 * Check whether a call expression matches a callee name.
 *
 * @param name Identifier name to match.
 * @returns Predicate for the call expression.
 */
const isCallExpressionNamed =
  (name: SourceText) =>
  (node: AstNode): node is CallExpression =>
    node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === name;

/**
 * Sort binding names for deterministic assertions.
 *
 * @param names Binding names to sort.
 * @returns Sorted array of names.
 */
const sortNames = (names: SourceText[]): SourceText[] => [...names].sort();

describe("SeedExpander", () => {
  it("expands a return call expression", () => {
    const parsed = parseSource(
      "const x = 1; const y = 2; function add(a, b) { return a + b; } function run() { return add(x, y); }",
    );
    const seedNode = findNode(
      parsed.ast,
      isReturnStatementCalling("add"),
      "ReturnStatement not found",
    );
    const expander = new SeedExpander();

    const bindings = expander.expand(seedNode, null);

    expect(sortNames(bindings)).toEqual(sortNames(["add", "x", "y"]));
  });

  it("expands a variable declaration", () => {
    const parsed = parseSource(
      "const base = 1; const multiplier = 2; const result = base * multiplier;",
    );
    const seedNode = findNode(
      parsed.ast,
      isVariableDeclarationNamed("result"),
      "VariableDeclaration not found",
    );
    const expander = new SeedExpander();

    const bindings = expander.expand(seedNode, null);

    expect(sortNames(bindings)).toEqual(sortNames(["base", "multiplier"]));
  });

  it("expands an expression statement call", () => {
    const parsed = parseSource("doWork(alpha, beta);");
    const seedNode = findNode(parsed.ast, isExpressionStatement, "ExpressionStatement not found");
    const expander = new SeedExpander();

    const bindings = expander.expand(seedNode, null);

    expect(sortNames(bindings)).toEqual(sortNames(["doWork", "alpha", "beta"]));
  });

  it("expands a return binary expression", () => {
    const parsed = parseSource("function run() { return left + right; }");
    const seedNode = findNode(parsed.ast, isReturnStatement, "ReturnStatement not found");
    const expander = new SeedExpander();

    const bindings = expander.expand(seedNode, null);

    expect(sortNames(bindings)).toEqual(sortNames(["left", "right"]));
  });

  it("returns no bindings for a literal return", () => {
    const parsed = parseSource("function run() { return 42; }");
    const seedNode = findNode(parsed.ast, isReturnStatement, "ReturnStatement not found");
    const expander = new SeedExpander();

    const bindings = expander.expand(seedNode, null);

    expect(bindings).toEqual([]);
  });

  it("honors a sub-expression range inside a statement", () => {
    const parsed = parseSource(
      "const a = 1; const b = 2; const c = 3; const result = (a + b) * transform(c);",
    );
    const seedNode = findNode(
      parsed.ast,
      isVariableDeclarationNamed("result"),
      "VariableDeclaration not found",
    );
    const callNode = findNode(
      parsed.ast,
      isCallExpressionNamed("transform"),
      "CallExpression not found",
    );
    const expander = new SeedExpander();

    const bindings = expander.expand(seedNode, toRange(callNode));

    expect(sortNames(bindings)).toEqual(sortNames(["transform", "c"]));
  });

  it("expands assignment expressions", () => {
    const parsed = parseSource("total = value + delta;");
    const seedNode = findNode(parsed.ast, isAssignmentExpression, "AssignmentExpression not found");
    const expander = new SeedExpander();

    const bindings = expander.expand(seedNode, null);

    expect(sortNames(bindings)).toEqual(sortNames(["value", "delta"]));
  });
});
