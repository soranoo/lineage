import { describe, expect, it } from "vitest";

import type {
  AbsolutePath,
  AstNode,
  DependencyEdge,
  OffsetRange,
  ParsedFile,
  ResolveResult,
  SourceText,
} from "@/types";

import { walkAst } from "@/helpers/ast-walker";
import { isAstNode } from "@/helpers/ast-walker";
import { OxcParser } from "@/parse/OxcParser";
import { BackwardSlicer } from "@/slice/BackwardSlicer";
import { FakeParser } from "@/__tests__/_fakes/FakeParser";
import { FakeResolver } from "@/__tests__/_fakes/FakeResolver";
import { FakeShaker } from "@/__tests__/_fakes/FakeShaker";
import { IssueCollector } from "@/issues/IssueCollector";

type ReturnStatementNode = AstNode & { type: "ReturnStatement" };
type FunctionDeclarationNode = AstNode & {
  type: "FunctionDeclaration";
  id?: { name?: SourceText } | null;
  params: AstNode[];
};
type VariableDeclarationNode = AstNode & { type: "VariableDeclaration" };

/**
 * Source entry for multi-file parsing.
 */
type SourceEntry = {
  /** Absolute file path for the entry. */
  file: AbsolutePath;
  /** Source text for the entry. */
  source: SourceText;
};

/**
 * Build parsed files from source entries.
 *
 * @param entries Source entries to parse.
 * @returns Map of parsed files keyed by absolute path.
 */
const buildParsedFiles = (entries: SourceEntry[]): Map<AbsolutePath, ParsedFile> => {
  const parser = new OxcParser();
  const parsed = new Map<AbsolutePath, ParsedFile>();

  for (const entry of entries) {
    parsed.set(entry.file, parser.parse(entry.file, entry.source));
  }

  return parsed;
};

/**
 * Find the first AST node matching the predicate.
 *
 * @param root Root AST node.
 * @param predicate Predicate narrowing the node.
 * @param message Error message when not found.
 * @returns Matching AST node.
 */
const findNode = <T extends AstNode>(
  root: AstNode,
  predicate: (node: AstNode) => node is T,
  message: string,
): T => {
  let found: T | null = null;

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
 * Convert an AST node to an offset range.
 *
 * @param node AST node to convert.
 * @returns Offset range for the node.
 */
const toRange = (node: AstNode): OffsetRange => ({ start: node.start, end: node.end });

/**
 * Build a node ID from file and range.
 *
 * @param file Absolute file path.
 * @param range Offset range.
 * @returns Node ID string.
 */
const buildNodeId = (file: AbsolutePath, range: OffsetRange): SourceText =>
  `${file}:${range.start}:${range.end}`;

/**
 * Test whether an edge exists in the list.
 *
 * @param edges Edge list to search.
 * @param fromId Source node ID.
 * @param toId Target node ID.
 * @param kind Edge kind to match.
 * @returns True when a matching edge exists.
 */
const hasEdge = (edges: DependencyEdge[], fromId: SourceText, toId: SourceText, kind: SourceText): boolean =>
  edges.some((edge) => edge.from === fromId && edge.to === toId && edge.kind === kind);

/**
 * Check whether a node is a return statement.
 *
 * @param node AST node to inspect.
 * @returns True when the node is a return statement.
 */
const isReturnStatement = (node: AstNode): node is ReturnStatementNode =>
  node.type === "ReturnStatement";

/**
 * Check whether a return statement returns a call to the given callee.
 *
 * @param name Identifier name to match.
 * @returns Predicate for ReturnStatement.
 */
const isReturnStatementCalling =
  (name: SourceText) =>
  (node: AstNode): node is ReturnStatementNode =>
    node.type === "ReturnStatement" &&
    node.argument?.type === "CallExpression" &&
    node.argument.callee.type === "Identifier" &&
    node.argument.callee.name === name;

/**
 * Check whether a node is a function declaration with the given name.
 *
 * @param name Identifier name to match.
 * @returns Predicate for FunctionDeclaration.
 */
const isFunctionDeclarationNamed =
  (name: SourceText) =>
  (node: AstNode): node is FunctionDeclarationNode =>
    node.type === "FunctionDeclaration" && node.id?.name === name;

/**
 * Check whether a node is a variable declaration that declares the named identifier.
 *
 * @param name Identifier name to match.
 * @returns Predicate for VariableDeclaration.
 */
const isVariableDeclarationNamed =
  (name: SourceText) =>
  (node: AstNode): node is VariableDeclarationNode =>
    node.type === "VariableDeclaration" &&
    node.declarations.some(
      (declarator) => declarator.id.type === "Identifier" && declarator.id.name === name,
    );

/**
 * Check whether a node is a variable declarator with the given name.
 *
 * @param name Identifier name to match.
 * @returns Predicate for VariableDeclarator.
 */
const isVariableDeclaratorNamed =
  (name: SourceText) =>
  (node: AstNode): node is AstNode =>
    node.type === "VariableDeclarator" && node.id.type === "Identifier" && node.id.name === name;

/**
 * Check whether a node is an arrow function expression.
 *
 * @param node AST node to inspect.
 * @returns True when the node is an arrow function.
 */
const isArrowFunctionExpression = (node: AstNode): node is AstNode =>
  node.type === "ArrowFunctionExpression";

/**
 * Create a slicer instance with fakes for a parsed file map.
 *
 * @param parsedFiles Parsed files to expose.
 * @returns BackwardSlicer instance.
 */
const createSlicer = (parsedFiles: Map<AbsolutePath, ParsedFile>): BackwardSlicer => {
  const parser = new FakeParser(parsedFiles);
  const resolver = new FakeResolver(new Map<SourceText, ResolveResult>());
  const shaker = new FakeShaker(new Set());
  const collector = new IssueCollector();

  return new BackwardSlicer(parser, resolver, shaker, collector);
};

describe("OxcParser + BackwardSlicer", () => {
  it("matches example 1 node ids and edge kinds", () => {
    const entryFile: AbsolutePath = "/project/main.js";
    const source = [
      "const globalA = 0;",
      "",
      "function a(b, c) {",
      "    return c + 2 * b + globalA;",
      "}",
      "function b(c, d) {",
      "    return a(c, d);",
      "}",
      "function c(d, e) {",
      "    const t = d + 5;",
      "    return b(t, e);",
      "}",
      "",
      "const result = c(5, 6);",
    ].join("\n");

    const parsedFiles = buildParsedFiles([{ file: entryFile, source }]);
    const parsed = parsedFiles.get(entryFile);

    if (!parsed) {
      throw new Error("Parsed file missing");
    }

    const seedNode = findNode(
      parsed.ast,
      isReturnStatementCalling("b"),
      "ReturnStatement not found",
    );
    const startPoint = toRange(seedNode);

    const slicer = createSlicer(parsedFiles);
    const result = slicer.slice(entryFile, startPoint, parsedFiles);

    const fnA = findNode(parsed.ast, isFunctionDeclarationNamed("a"), "Function a not found");
    const fnB = findNode(parsed.ast, isFunctionDeclarationNamed("b"), "Function b not found");
    const fnC = findNode(parsed.ast, isFunctionDeclarationNamed("c"), "Function c not found");
    const varT = findNode(parsed.ast, isVariableDeclaratorNamed("t"), "Variable t not found");
    const varGlobal = findNode(
      parsed.ast,
      isVariableDeclaratorNamed("globalA"),
      "GlobalA not found",
    );

    const paramC = fnB.params[0];
    const paramDOfB = fnB.params[1];
    const paramDOfC = fnC.params[0];
    const paramEOfC = fnC.params[1];

    if (!paramC || !paramDOfB || !paramDOfC || !paramEOfC) {
      throw new Error("Expected parameters not found");
    }

    if (!isAstNode(paramC) || !isAstNode(paramDOfB) || !isAstNode(paramDOfC) || !isAstNode(paramEOfC)) {
      throw new Error("Expected parameter nodes to be AST nodes");
    }

    const expectedIds = [
      buildNodeId(entryFile, startPoint),
      buildNodeId(entryFile, toRange(fnB)),
      buildNodeId(entryFile, toRange(fnA)),
      buildNodeId(entryFile, toRange(varT)),
      buildNodeId(entryFile, toRange(paramDOfC)),
      buildNodeId(entryFile, toRange(paramEOfC)),
      buildNodeId(entryFile, toRange(varGlobal)),
    ];

    for (const id of expectedIds) {
      expect(result.nodes.some((node) => node.id === id)).toBe(true);
    }

    const startId = buildNodeId(entryFile, startPoint);
    const fnAId = buildNodeId(entryFile, toRange(fnA));
    const fnBId = buildNodeId(entryFile, toRange(fnB));
    const paramCId = buildNodeId(entryFile, toRange(paramC));
    const paramDOfBId = buildNodeId(entryFile, toRange(paramDOfB));
    const paramDOfCId = buildNodeId(entryFile, toRange(paramDOfC));
    const varTId = buildNodeId(entryFile, toRange(varT));
    const globalAId = buildNodeId(entryFile, toRange(varGlobal));

    expect(hasEdge(result.edges, startId, fnBId, "call")).toBe(true);
    expect(hasEdge(result.edges, fnBId, fnAId, "call")).toBe(true);
    expect(hasEdge(result.edges, startId, paramCId, "param-bind")).toBe(true);
    expect(hasEdge(result.edges, startId, paramDOfBId, "param-bind")).toBe(true);
    expect(hasEdge(result.edges, varTId, paramDOfCId, "data-flow")).toBe(true);
    expect(hasEdge(result.edges, fnAId, globalAId, "data-flow")).toBe(true);
  });

  it("includes base and multiplier for example 3", () => {
    const entryFile: AbsolutePath = "/project/main.js";
    const source = [
      "const base = 10;",
      "const multiplier = 3;",
      "const unrelated = 99;",
      "",
      "const result = base * multiplier;",
    ].join("\n");

    const parsedFiles = buildParsedFiles([{ file: entryFile, source }]);
    const parsed = parsedFiles.get(entryFile);

    if (!parsed) {
      throw new Error("Parsed file missing");
    }

    const seedNode = findNode(
      parsed.ast,
      isVariableDeclarationNamed("result"),
      "Result declaration not found",
    );
    const startPoint = toRange(seedNode);
    const slicer = createSlicer(parsedFiles);

    const result = slicer.slice(entryFile, startPoint, parsedFiles);

    expect(result.nodes.some((node) => node.label.includes("base"))).toBe(true);
    expect(result.nodes.some((node) => node.label.includes("multiplier"))).toBe(true);
    expect(result.nodes.some((node) => node.label.includes("unrelated"))).toBe(false);
  });

  it("adds closure edges for example 10", () => {
    const entryFile: AbsolutePath = "/project/main.js";
    const source = [
      "const rate = 0.2;",
      "const unrelated = 'hello';",
      "",
      "function makeTaxer() {",
      "    return (amount) => amount * rate;",
      "}",
      "",
      "const taxer = makeTaxer();",
      "const tax = taxer(100);",
    ].join("\n");

    const parsedFiles = buildParsedFiles([{ file: entryFile, source }]);
    const parsed = parsedFiles.get(entryFile);

    if (!parsed) {
      throw new Error("Parsed file missing");
    }

    const seedNode = findNode(
      parsed.ast,
      isVariableDeclarationNamed("tax"),
      "Tax declaration not found",
    );
    const startPoint = toRange(seedNode);
    const slicer = createSlicer(parsedFiles);

    const result = slicer.slice(entryFile, startPoint, parsedFiles);

    const arrowAst = findNode(parsed.ast, isArrowFunctionExpression, "Arrow function not found");
    const arrowNode = result.nodes.find(
      (node) => node.id === buildNodeId(entryFile, toRange(arrowAst)),
    );
    const rateNode = result.nodes.find(
      (node) => node.kind === "global" && node.label.includes("rate"),
    );

    if (!arrowNode || !rateNode) {
      throw new Error("Closure nodes not found");
    }

    expect(hasEdge(result.edges, arrowNode.id, rateNode.id, "closure")).toBe(true);
  });

  it("keeps both branches for example 11", () => {
    const entryFile: AbsolutePath = "/project/main.js";
    const source = [
      "const flag = true;",
      "const valueA = 10;",
      "const valueB = 20;",
      "const unused = 99;",
      "",
      "function pick(f, a, b) {",
      "    if (f) {",
      "        return a;",
      "    } else {",
      "        return b;",
      "    }",
      "}",
      "",
      "const result = pick(flag, valueA, valueB);",
    ].join("\n");

    const parsedFiles = buildParsedFiles([{ file: entryFile, source }]);
    const parsed = parsedFiles.get(entryFile);

    if (!parsed) {
      throw new Error("Parsed file missing");
    }

    const seedNode = findNode(
      parsed.ast,
      isVariableDeclarationNamed("result"),
      "Result declaration not found",
    );
    const startPoint = toRange(seedNode);
    const slicer = createSlicer(parsedFiles);

    const result = slicer.slice(entryFile, startPoint, parsedFiles);

    expect(result.nodes.some((node) => node.label.includes("valueA"))).toBe(true);
    expect(result.nodes.some((node) => node.label.includes("valueB"))).toBe(true);
    expect(result.nodes.some((node) => node.label.includes("unused"))).toBe(false);
  });
});
