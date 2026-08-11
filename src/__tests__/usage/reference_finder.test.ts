import { describe, expect, it } from "vitest";

import { findNode, parseSource } from "@/__tests__/utils";
import { walkAst } from "@/helpers";
import { ReferenceFinder } from "@/usage/ReferenceFinder";
import type { AstNode, ParsedFile, SourceText } from "@/types";

const findFunction = (parsedFile: ParsedFile, name: SourceText): AstNode =>
  findNode(
    parsedFile.ast,
    (node): node is AstNode & { type: "FunctionDeclaration" } =>
      node.type === "FunctionDeclaration" && node.id?.type === "Identifier" && node.id.name === name,
    `Function not found: ${name}`,
  );

const findParameterFunction = (parsedFile: ParsedFile): AstNode =>
  findNode(
    parsedFile.ast,
    (node): node is AstNode & { type: "FunctionDeclaration" } =>
      node.type === "FunctionDeclaration" && node.id?.type === "Identifier" && node.id.name === "run",
    "Function not found: run",
  );

const findFunctionBody = (parsedFile: ParsedFile, name: SourceText): AstNode => {
  const functionNode = findFunction(parsedFile, name);
  return findNode(
    functionNode,
    (node): node is AstNode & { type: "BlockStatement" } => node.type === "BlockStatement",
    `Function body not found: ${name}`,
  );
};

describe("ReferenceFinder", () => {
  const finder = new ReferenceFinder();

  it("returns every read of a binding in its declared function scope", () => {
    const parsedFile = parseSource("function run() { const x = 1; console.log(x); return x + x; }");
    const functionNode = findFunctionBody(parsedFile, "run");

    const references = finder.find("x", functionNode, parsedFile);

    expect(references).toHaveLength(3);
    expect(references.every((reference) => reference.kind === "read")).toBe(true);
    expect(references.map((reference) => reference.parentContext)).toEqual([
      "call-argument",
      "read",
      "read",
    ]);
  });

  it("includes references in nested blocks and closures but excludes shadowed bindings", () => {
    const source =
      "function run() { const x = 1; if (x) { x; } function inner() { console.log(x); } { const x = 2; console.log(x); } }";
    const parsedFile = parseSource(source);
    const functionNode = findFunctionBody(parsedFile, "run");

    const references = finder.find("x", functionNode, parsedFile);

    expect(references).toHaveLength(3);
    expect(references.some((reference) => reference.insideClosure)).toBe(true);
    expect(references.map((reference) => source.slice(reference.node.start, reference.node.end))).toEqual([
      "x",
      "x",
      "x",
    ]);
  });

  it("never returns the declaration site", () => {
    const source = "function run() { const x = 1; return x; }";
    const parsedFile = parseSource(source);
    const functionNode = findFunctionBody(parsedFile, "run");

    const references = finder.find("x", functionNode, parsedFile);

    expect(references).toHaveLength(1);
    expect(source.slice(references[0]?.node.start ?? 0, references[0]?.node.end ?? 0)).toBe("x");
  });

  it("classifies writes separately from reads", () => {
    const parsedFile = parseSource("function run() { let x = 1; x = 5; x++; return x; }");
    const functionNode = findFunctionBody(parsedFile, "run");

    const references = finder.find("x", functionNode, parsedFile);

    expect(references).toHaveLength(3);
    expect(references.map((reference) => reference.kind)).toEqual(["write", "write", "read"]);
  });

  it("tags structural contexts needed by forward classification", () => {
    const source =
      "function run() { const x = 1; const copy = x; const { value } = x; consume(x); return x; target.value = x; const spread = { ...x }; }";
    const parsedFile = parseSource(source);
    const functionNode = findFunctionBody(parsedFile, "run");

    const references = finder.find("x", functionNode, parsedFile);
    const contexts = references.map((reference) => reference.parentContext);

    expect(contexts).toEqual([
      "declarator",
      "destructure",
      "call-argument",
      "return",
      "property-write",
      "spread",
    ]);
  });

  it("uses the supplied scope as the binding boundary", () => {
    const parsedFile = parseSource("const x = 1; function run() { return x; }");
    const functionNode = findParameterFunction(parsedFile);

    const references = finder.find("x", functionNode, parsedFile);

    expect(references).toEqual([]);
  });

  it("does not mistake identifiers in property keys for references", () => {
    const parsedFile = parseSource("function run() { const x = 1; const object = { x, x: 2 }; return object.x; }");
    const functionNode = findFunctionBody(parsedFile, "run");
    const identifiers: SourceText[] = [];

    walkAst(functionNode, (node) => {
      if (node.type === "Identifier" && node.name === "x") {
        identifiers.push(node.name);
      }
    });

    const references = finder.find("x", functionNode, parsedFile);

    expect(identifiers.length).toBeGreaterThan(references.length);
    expect(references).toHaveLength(1);
  });
});
