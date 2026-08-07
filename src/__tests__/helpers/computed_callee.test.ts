import { describe, expect, it } from "vitest";

import { walkAst } from "@/helpers";
import { DynamicPatternDetector, IssueCollector } from "@/issues";
import { BindingResolver } from "@/slice/BindingResolver";
import { OxcParser } from "@/parse";
import type { AbsolutePath, AstNode, ParsedFile, SourceText } from "@/types";

const file: AbsolutePath = "/project/src/entry.ts";

const parseSource = (source: SourceText): ParsedFile => {
  const parser = new OxcParser();
  return parser.parse(file, source);
};

const findComputedMember = (parsedFile: ParsedFile): AstNode => {
  let found: AstNode | null = null;

  walkAst(parsedFile.ast, (node) => {
    if (found !== null || node.type !== "MemberExpression" || !node.computed) {
      return;
    }

    found = node;
  });

  if (found === null) {
    throw new Error("Computed member expression not found");
  }

  return found;
};

const detectIssues = (parsedFile: ParsedFile): ReturnType<IssueCollector["getAll"]> => {
  const collector = new IssueCollector();
  const detector = new DynamicPatternDetector(collector);

  detector.detect(parsedFile.ast, parsedFile.absolutePath, parsedFile);

  return collector.getAll();
};

describe("computed callee resolution", () => {
  it("resolves a literal computed key like a dot property", () => {
    const parsed = parseSource("const registry = { greet: () => 'hi' }; registry['greet']();");
    const resolver = new BindingResolver();
    const member = findComputedMember(parsed);

    expect(resolver.resolveStaticPropertyKeys(member, member, parsed)).toEqual(["greet"]);
    expect(detectIssues(parsed).filter((issue) => issue.kind === "computed-property")).toHaveLength(0);
  });

  it("resolves a parameter key from its literal call site", () => {
    const parsed = parseSource(
      "const registry = { greet: () => 'hi' }; function invoke(key) { return registry[key](); } invoke('greet');",
    );
    const resolver = new BindingResolver();
    const member = findComputedMember(parsed);

    expect(resolver.resolveStaticPropertyKeys(member, member, parsed)).toEqual(["greet"]);
    expect(detectIssues(parsed).filter((issue) => issue.kind === "computed-property")).toHaveLength(0);
  });

  it("explores every statically known literal call-site key", () => {
    const parsed = parseSource(
      "const registry = { greet: () => 'hi', bye: () => 'bye' }; function invoke(key) { return registry[key](); } invoke('greet'); invoke('bye');",
    );
    const resolver = new BindingResolver();
    const member = findComputedMember(parsed);

    expect(resolver.resolveStaticPropertyKeys(member, member, parsed)).toEqual(["greet", "bye"]);
    expect(detectIssues(parsed).filter((issue) => issue.kind === "computed-property")).toHaveLength(0);
  });

  it("falls back to computed-property for an unknown key", () => {
    const parsed = parseSource(
      "const registry = { greet: () => 'hi' }; function invoke(key) { return registry[key](); } invoke(someVariable);",
    );
    const resolver = new BindingResolver();
    const member = findComputedMember(parsed);

    expect(resolver.resolveStaticPropertyKeys(member, member, parsed)).toEqual([]);
    expect(detectIssues(parsed).filter((issue) => issue.kind === "computed-property")).toHaveLength(1);
  });

  it("resolves a template literal without interpolation", () => {
    const parsed = parseSource("const registry = { greet: () => 'hi' }; registry[`greet`]();");
    const resolver = new BindingResolver();
    const member = findComputedMember(parsed);

    expect(resolver.resolveStaticPropertyKeys(member, member, parsed)).toEqual(["greet"]);
    expect(detectIssues(parsed).filter((issue) => issue.kind === "computed-property")).toHaveLength(0);
  });
});