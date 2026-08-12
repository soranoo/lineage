import { describe, expect, it } from "vitest";

import { findNode, parseSource, toRange } from "@/__tests__/utils";
import { UsageSeedExpander } from "@/usage/UsageSeedExpander";
import { StartPointNotFoundError } from "@/types";
import type { AstNode, SourceText } from "@/types";

const findNamedNode = (root: AstNode, name: SourceText): AstNode =>
  findNode(
    root,
    (node) => node.type === "Identifier" && node.name === name,
    `Identifier not found: ${name}`,
  );

const findVariableDeclarator = (root: AstNode, name: SourceText): AstNode =>
  findNode(
    root,
    (node) =>
      node.type === "VariableDeclarator" &&
      node.id.type === "Identifier" &&
      node.id.name === name,
    `Variable declarator not found: ${name}`,
  );

describe("UsageSeedExpander", () => {
  const expander = new UsageSeedExpander();

  it("expands a variable declarator to one binding", () => {
    const parsedFile = parseSource("const value = 1;");
    const declaration = findVariableDeclarator(parsedFile.ast, "value");

    const seed = expander.expand(parsedFile, toRange(declaration));

    expect(seed.name).toBe("value");
    expect(seed.declaration).toBe(declaration);
    expect(seed.scopeNode.type).toBe("Program");
  });

  it("uses the containing scope for a function declaration", () => {
    const parsedFile = parseSource("function run() { return run(); }");
    const declaration = findNode(parsedFile.ast, (node) => node.type === "FunctionDeclaration", "run");

    const seed = expander.expand(parsedFile, toRange(declaration));

    expect(seed.name).toBe("run");
    expect(seed.declaration).toBe(declaration);
    expect(seed.scopeNode.type).toBe("Program");
  });

  it("scopes a parameter seed to its function", () => {
    const parsedFile = parseSource("function run(value) { return value; }");
    const parameter = findNamedNode(parsedFile.ast, "value");

    const seed = expander.expand(parsedFile, toRange(parameter));

    expect(seed.name).toBe("value");
    expect(seed.declaration).toBe(parameter);
    expect(seed.scopeNode.type).toBe("FunctionDeclaration");
  });

  it("scopes an import seed to the importing program", () => {
    const parsedFile = parseSource("import { value as alias } from './source'; console.log(alias);");
    const alias = findNamedNode(parsedFile.ast, "alias");

    const seed = expander.expand(parsedFile, toRange(alias));

    expect(seed.name).toBe("alias");
    expect(seed.scopeNode.type).toBe("Program");
  });

  it("selects only the destructured binding under the requested key", () => {
    const parsedFile = parseSource("const { a, b } = source;");
    const binding = findNamedNode(parsedFile.ast, "b");

    const seed = expander.expand(parsedFile, toRange(binding));

    expect(seed.name).toBe("b");
    expect(seed.declaration.type).toBe("Identifier");
    expect(seed.declaration.start).toBe(binding.start);
    expect(seed.declaration.end).toBe(binding.end);
  });

  it("throws when the range does not identify a declaration", () => {
    const parsedFile = parseSource("console.log(value);");

    expect(() => expander.expand(parsedFile, { start: 0, end: 3 })).toThrow(
      StartPointNotFoundError,
    );
  });
});