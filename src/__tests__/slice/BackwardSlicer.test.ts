import { describe, expect, it } from "vitest";

import type {
  AbsolutePath,
  AstNode,
  DependencyEdge,
  DependencyNode,
  OffsetRange,
  ParsedFile,
  ResolveResult,
  SourceText,
} from "@/types";

import { walkAst } from "@/helpers/ast-walker";
import { IssueCollector } from "@/issues/IssueCollector";
import { OxcParser } from "@/parse/OxcParser";
import { BackwardSlicer } from "@/slice/BackwardSlicer";
import { FakeParser } from "@/__tests__/_fakes/FakeParser";
import { FakeResolver } from "@/__tests__/_fakes/FakeResolver";
import { FakeShaker } from "@/__tests__/_fakes/FakeShaker";

type ReturnStatementNode = AstNode & { type: "ReturnStatement" };
type VariableDeclarationNode = AstNode & { type: "VariableDeclaration" };
type FunctionDeclarationNode = AstNode & {
  type: "FunctionDeclaration";
  id?: { name?: SourceText } | null;
};
type CallExpressionNode = AstNode & { type: "CallExpression" };

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
 * Find a dependency node matching the predicate.
 *
 * @param nodes Dependency nodes list.
 * @param predicate Predicate to match.
 * @param message Error message when not found.
 * @returns Matching dependency node.
 */
const findDependencyNode = (
  nodes: DependencyNode[],
  predicate: (node: DependencyNode) => boolean,
  message: string,
): DependencyNode => {
  const found = nodes.find(predicate);

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
 * Check whether a node is a call expression with a given callee name.
 *
 * @param name Identifier name to match.
 * @returns Predicate for CallExpression.
 */
const isCallExpressionNamed =
  (name: SourceText) =>
  (node: AstNode): node is CallExpressionNode =>
    node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === name;

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
 * @param baseResolutions Base resolver mappings.
 * @returns BackwardSlicer instance and issue collector.
 */
const createSlicer = (
  parsedFiles: Map<AbsolutePath, ParsedFile>,
  baseResolutions: Map<SourceText, ResolveResult>,
): { slicer: BackwardSlicer; collector: IssueCollector } => {
  const parser = new FakeParser(parsedFiles);
  const resolver = new FakeResolver(baseResolutions);
  const shaker = new FakeShaker(new Set());
  const collector = new IssueCollector();

  return { slicer: new BackwardSlicer(parser, resolver, shaker, collector), collector };
};

describe("BackwardSlicer", () => {
  it("adds local variables, globals, and stable node ids", () => {
    const entryFile: AbsolutePath = "/project/src/entry.ts";
    const source = [
      "const base = 1;",
      "function compute() {",
      "  const local = base + 1;",
      "  return local;",
      "}",
    ].join("\n");
    const parsedFiles = buildParsedFiles([{ file: entryFile, source }]);
    const parsed = parsedFiles.get(entryFile);

    if (!parsed) {
      throw new Error("Parsed file missing");
    }

    const seedNode = findNode(parsed.ast, isReturnStatement, "ReturnStatement not found");
    const startPoint = toRange(seedNode);
    const { slicer } = createSlicer(parsedFiles, new Map());

    const result = slicer.slice(entryFile, startPoint, parsedFiles);

    const localNode = findDependencyNode(
      result.nodes,
      (node) => node.kind === "variable" && node.label.includes("local"),
      "Local variable node not found",
    );
    const globalNode = findDependencyNode(
      result.nodes,
      (node) => node.kind === "global" && node.label.includes("base"),
      "Global node not found",
    );
    const startNode = findDependencyNode(
      result.nodes,
      (node) => node.kind === "start-point",
      "Start-point node not found",
    );

    expect(localNode.id).toBe(
      buildNodeId(
        entryFile,
        toRange(findNode(parsed.ast, isVariableDeclaratorNamed("local"), "Local declarator not found")),
      ),
    );
    expect(globalNode.id).toBe(
      buildNodeId(
        entryFile,
        toRange(findNode(parsed.ast, isVariableDeclaratorNamed("base"), "Base declarator not found")),
      ),
    );
    expect(startNode.id).toBe(buildNodeId(entryFile, startPoint));
    expect(result.nodes.every((node) => node.shaken === false)).toBe(true);
  });

  it("adds function declarations and free variables", () => {
    const entryFile: AbsolutePath = "/project/src/entry.ts";
    const source = [
      "const factor = 2;",
      "function helper(value) { return value * factor; }",
      "function compute(value) { return helper(value); }",
    ].join("\n");
    const parsedFiles = buildParsedFiles([{ file: entryFile, source }]);
    const parsed = parsedFiles.get(entryFile);

    if (!parsed) {
      throw new Error("Parsed file missing");
    }

    const seedNode = findNode(
      parsed.ast,
      isReturnStatementCalling("helper"),
      "ReturnStatement not found",
    );
    const startPoint = toRange(seedNode);
    const { slicer } = createSlicer(parsedFiles, new Map());

    const result = slicer.slice(entryFile, startPoint, parsedFiles);

    const helperNode = findDependencyNode(
      result.nodes,
      (node) => node.kind === "function" && node.label.includes("helper"),
      "Helper function node not found",
    );
    const factorNode = findDependencyNode(
      result.nodes,
      (node) => node.kind === "global" && node.label.includes("factor"),
      "Factor global node not found",
    );
    const startNode = findDependencyNode(
      result.nodes,
      (node) => node.kind === "start-point",
      "Start-point node not found",
    );

    expect(hasEdge(result.edges, startNode.id, helperNode.id, "call")).toBe(true);
    expect(factorNode.kind).toBe("global");
  });

  it("adds parameter bindings and param-bind edges", () => {
    const entryFile: AbsolutePath = "/project/src/entry.ts";
    const source = [
      "function add(a, b) { return a + b; }",
      "const x = 1;",
      "const y = 2;",
      "const result = add(x, y);",
    ].join("\n");
    const parsedFiles = buildParsedFiles([{ file: entryFile, source }]);
    const parsed = parsedFiles.get(entryFile);

    if (!parsed) {
      throw new Error("Parsed file missing");
    }

    const startNodeAst = findNode(parsed.ast, isVariableDeclarationNamed("result"), "Result declaration not found");
    const startPoint = toRange(startNodeAst);
    const { slicer } = createSlicer(parsedFiles, new Map());

    const result = slicer.slice(entryFile, startPoint, parsedFiles);

    const startNode = findDependencyNode(
      result.nodes,
      (node) => node.kind === "start-point",
      "Start-point node not found",
    );
    const paramA = findDependencyNode(
      result.nodes,
      (node) => node.kind === "parameter" && node.label === "a",
      "Parameter a not found",
    );
    const paramB = findDependencyNode(
      result.nodes,
      (node) => node.kind === "parameter" && node.label === "b",
      "Parameter b not found",
    );

    expect(hasEdge(result.edges, startNode.id, paramA.id, "param-bind")).toBe(true);
    expect(hasEdge(result.edges, startNode.id, paramB.id, "param-bind")).toBe(true);
  });

  it("follows resolved imports", () => {
    const entryFile: AbsolutePath = "/project/src/main.ts";
    const mathFile: AbsolutePath = "/project/src/math.ts";
    const source = "import { add } from './math'; const result = add(1, 2);";
    const mathSource = "export function add(a, b) { return a + b; }";
    const parsedFiles = buildParsedFiles([
      { file: entryFile, source },
      { file: mathFile, source: mathSource },
    ]);
    const parsed = parsedFiles.get(entryFile);

    if (!parsed) {
      throw new Error("Parsed file missing");
    }

    const startNodeAst = findNode(parsed.ast, isVariableDeclarationNamed("result"), "Result declaration not found");
    const startPoint = toRange(startNodeAst);
    const resolverMap = new Map<SourceText, ResolveResult>([
      ["./math", { kind: "resolved", absolutePath: mathFile }],
    ]);
    const { slicer } = createSlicer(parsedFiles, resolverMap);

    const result = slicer.slice(entryFile, startPoint, parsedFiles);

    const importNode = findDependencyNode(
      result.nodes,
      (node) => node.kind === "import",
      "Import node not found",
    );
    const addNode = findDependencyNode(
      result.nodes,
      (node) => node.kind === "function" && node.label.includes("add"),
      "Add function node not found",
    );
    const startNode = findDependencyNode(
      result.nodes,
      (node) => node.kind === "start-point",
      "Start-point node not found",
    );

    expect(hasEdge(result.edges, startNode.id, importNode.id, "import")).toBe(true);
    expect(hasEdge(result.edges, importNode.id, addNode.id, "import")).toBe(true);
  });

  it("emits ignored-path issues for ignored imports", () => {
    const entryFile: AbsolutePath = "/project/src/main.ts";
    const source = "import { schema } from './generated/schema'; const result = schema.parse(input);";
    const parsedFiles = buildParsedFiles([{ file: entryFile, source }]);
    const parsed = parsedFiles.get(entryFile);

    if (!parsed) {
      throw new Error("Parsed file missing");
    }

    const startNodeAst = findNode(parsed.ast, isVariableDeclarationNamed("result"), "Result declaration not found");
    const startPoint = toRange(startNodeAst);
    const resolverMap = new Map<SourceText, ResolveResult>([
      [
        "./generated/schema",
        {
          kind: "ignored",
          absolutePath: "/project/generated/schema.ts",
          matchedPattern: /\/generated\//,
        },
      ],
    ]);
    const { slicer, collector } = createSlicer(parsedFiles, resolverMap);

    const result = slicer.slice(entryFile, startPoint, parsedFiles);

    const ignoredNode = findDependencyNode(
      result.nodes,
      (node) => node.kind === "ignored-leaf",
      "Ignored leaf node not found",
    );
    const issues = collector.getAll();

    expect(ignoredNode.kind).toBe("ignored-leaf");
    expect(issues.some((issue) => issue.kind === "ignored-path")).toBe(true);
  });

  it("emits unresolved issues for failed imports", () => {
    const entryFile: AbsolutePath = "/project/src/main.ts";
    const source = "import { missing } from './missing'; const result = missing();";
    const parsedFiles = buildParsedFiles([{ file: entryFile, source }]);
    const parsed = parsedFiles.get(entryFile);

    if (!parsed) {
      throw new Error("Parsed file missing");
    }

    const startNodeAst = findNode(parsed.ast, isVariableDeclarationNamed("result"), "Result declaration not found");
    const startPoint = toRange(startNodeAst);
    const resolverMap = new Map<SourceText, ResolveResult>([
      ["./missing", { kind: "failed" }],
    ]);
    const { slicer, collector } = createSlicer(parsedFiles, resolverMap);

    const result = slicer.slice(entryFile, startPoint, parsedFiles);

    const unresolvedNode = findDependencyNode(
      result.nodes,
      (node) => node.kind === "unresolved-leaf",
      "Unresolved leaf node not found",
    );
    const issues = collector.getAll();

    expect(unresolvedNode.kind).toBe("unresolved-leaf");
    expect(issues.some((issue) => issue.kind === "unresolved-dependency")).toBe(true);
  });

  it("emits unresolved issues for missing globals", () => {
    const entryFile: AbsolutePath = "/project/src/main.ts";
    const source = "function compute() { return missing; }";
    const parsedFiles = buildParsedFiles([{ file: entryFile, source }]);
    const parsed = parsedFiles.get(entryFile);

    if (!parsed) {
      throw new Error("Parsed file missing");
    }

    const seedNode = findNode(parsed.ast, isReturnStatement, "ReturnStatement not found");
    const startPoint = toRange(seedNode);
    const { slicer, collector } = createSlicer(parsedFiles, new Map());

    const result = slicer.slice(entryFile, startPoint, parsedFiles);

    const unresolvedNode = findDependencyNode(
      result.nodes,
      (node) => node.kind === "unresolved-leaf",
      "Unresolved leaf node not found",
    );
    const issues = collector.getAll();

    expect(unresolvedNode.kind).toBe("unresolved-leaf");
    expect(issues.some((issue) => issue.kind === "unresolved-dependency")).toBe(true);
  });

  it("skips already visited bindings for circular references", () => {
    const entryFile: AbsolutePath = "/project/src/main.ts";
    const source = [
      "const a = b;",
      "const b = a;",
      "const result = a;",
    ].join("\n");
    const parsedFiles = buildParsedFiles([{ file: entryFile, source }]);
    const parsed = parsedFiles.get(entryFile);

    if (!parsed) {
      throw new Error("Parsed file missing");
    }

    const startNodeAst = findNode(parsed.ast, isVariableDeclarationNamed("result"), "Result declaration not found");
    const startPoint = toRange(startNodeAst);
    const { slicer } = createSlicer(parsedFiles, new Map());

    const result = slicer.slice(entryFile, startPoint, parsedFiles);

    expect(result.nodes.some((node) => node.label.includes("a = b"))).toBe(true);
    expect(result.nodes.some((node) => node.label.includes("b = a"))).toBe(true);
  });

  it("follows re-export chains", () => {
    const entryFile: AbsolutePath = "/project/src/main.ts";
    const indexFile: AbsolutePath = "/project/src/index.ts";
    const utilsFile: AbsolutePath = "/project/src/utils.ts";
    const source = "import { format } from './index'; const label = format('hello');";
    const indexSource = "export { format } from './utils'; export { unused } from './other';";
    const utilsSource = "export function format(str) { return str.trim().toUpperCase(); }";
    const parsedFiles = buildParsedFiles([
      { file: entryFile, source },
      { file: indexFile, source: indexSource },
      { file: utilsFile, source: utilsSource },
    ]);
    const parsed = parsedFiles.get(entryFile);

    if (!parsed) {
      throw new Error("Parsed file missing");
    }

    const startNodeAst = findNode(parsed.ast, isVariableDeclarationNamed("label"), "Label declaration not found");
    const startPoint = toRange(startNodeAst);
    const resolverMap = new Map<SourceText, ResolveResult>([
      ["./index", { kind: "resolved", absolutePath: indexFile }],
      ["./utils", { kind: "resolved", absolutePath: utilsFile }],
      ["./other", { kind: "failed" }],
    ]);
    const { slicer } = createSlicer(parsedFiles, resolverMap);

    const result = slicer.slice(entryFile, startPoint, parsedFiles);

    expect(result.nodes.some((node) => node.kind === "re-export")).toBe(true);
    expect(result.nodes.some((node) => node.kind === "function" && node.label.includes("format"))).toBe(true);
  });

  it("marks closure edges for nested functions", () => {
    const entryFile: AbsolutePath = "/project/src/main.ts";
    const source = [
      "const rate = 0.2;",
      "const unrelated = 'hello';",
      "function makeTaxer() {",
      "  return (amount) => amount * rate;",
      "}",
      "const taxer = makeTaxer();",
      "const tax = taxer(100);",
    ].join("\n");
    const parsedFiles = buildParsedFiles([{ file: entryFile, source }]);
    const parsed = parsedFiles.get(entryFile);

    if (!parsed) {
      throw new Error("Parsed file missing");
    }

    const startNodeAst = findNode(parsed.ast, isVariableDeclarationNamed("tax"), "Tax declaration not found");
    const startPoint = toRange(startNodeAst);
    const { slicer } = createSlicer(parsedFiles, new Map());

    const result = slicer.slice(entryFile, startPoint, parsedFiles);

    const arrowAst = findNode(parsed.ast, isArrowFunctionExpression, "Arrow function not found");
    const arrowNode = findDependencyNode(
      result.nodes,
      (node) => node.id === buildNodeId(entryFile, toRange(arrowAst)),
      "Arrow function node not found",
    );
    const rateNode = findDependencyNode(
      result.nodes,
      (node) => node.kind === "global" && node.label.includes("rate"),
      "Rate global node not found",
    );
    const closureEdge = result.edges.find(
      (edge) => edge.from === arrowNode.id && edge.to === rateNode.id,
    );

    if (!closureEdge) {
      const edgesFromArrow = result.edges.filter((edge) => edge.from === arrowNode.id);
      throw new Error(`Edge from arrow not found: ${JSON.stringify(edgesFromArrow)}`);
    }

    expect(closureEdge.kind).toBe("closure");
    expect(result.nodes.some((node) => node.label.includes("unrelated"))).toBe(false);
  });

  it("includes conditional branches", () => {
    const entryFile: AbsolutePath = "/project/src/main.ts";
    const source = [
      "const flag = true;",
      "const valueA = 10;",
      "const valueB = 20;",
      "const unused = 99;",
      "function pick(f, a, b) {",
      "  if (f) {",
      "    return a;",
      "  } else {",
      "    return b;",
      "  }",
      "}",
      "const result = pick(flag, valueA, valueB);",
    ].join("\n");
    const parsedFiles = buildParsedFiles([{ file: entryFile, source }]);
    const parsed = parsedFiles.get(entryFile);

    if (!parsed) {
      throw new Error("Parsed file missing");
    }

    const startNodeAst = findNode(parsed.ast, isVariableDeclarationNamed("result"), "Result declaration not found");
    const startPoint = toRange(startNodeAst);
    const { slicer } = createSlicer(parsedFiles, new Map());

    const result = slicer.slice(entryFile, startPoint, parsedFiles);

    expect(result.nodes.some((node) => node.label.includes("valueA"))).toBe(true);
    expect(result.nodes.some((node) => node.label.includes("valueB"))).toBe(true);
    expect(result.nodes.some((node) => node.label.includes("unused"))).toBe(false);
  });
});
