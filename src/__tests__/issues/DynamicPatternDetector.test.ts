import { describe, expect, it } from "vitest";

import type { AbsolutePath, IssueKind, IssueResolution, SourceText, TrackerIssue } from "@/types";

import { OxcParser } from "@/parse/OxcParser";
import { DynamicPatternDetector } from "@/issues/DynamicPatternDetector";
import { IssueCollector } from "@/issues/IssueCollector";

const file: AbsolutePath = "/project/src/dynamic.ts";

const detectIssues = (source: SourceText): TrackerIssue[] => {
  const parser = new OxcParser();
  const parsed = parser.parse(file, source);
  const collector = new IssueCollector();
  const detector = new DynamicPatternDetector(collector);

  detector.detect(parsed.ast, file);

  return collector.getAll();
};

const expectSingleIssue = (
  issues: TrackerIssue[],
  kind: IssueKind,
  resolution: IssueResolution,
): void => {
  expect(issues).toHaveLength(1);

  const issue = issues[0];

  if (!issue) {
    throw new Error("Expected an issue but found none.");
  }

  expect(issue.kind).toBe(kind);
  expect(issue.resolution).toBe(resolution);
  expect(issue.file).toBe(file);
};

describe("DynamicPatternDetector", () => {
  it("detects eval calls", () => {
    const issues = detectIssues("const value = eval('2 + 2');");

    expectSingleIssue(issues, "eval", "included");
  });

  it("detects computed properties", () => {
    const issues = detectIssues("const value = obj[key];");

    expectSingleIssue(issues, "computed-property", "included");
  });

  it("detects dynamic imports", () => {
    const issues = detectIssues("const mod = import('./mod');");

    expectSingleIssue(issues, "dynamic-import", "included");
  });

  it("detects arguments object usage", () => {
    const issues = detectIssues("function f() { return arguments; }");

    expectSingleIssue(issues, "arguments-object", "included");
  });

  it("detects rest spread usage", () => {
    const issues = detectIssues("function f(...args) { return args; }");

    expectSingleIssue(issues, "rest-spread-unknown", "included");
  });

  it("detects indirect calls", () => {
    const issues = detectIssues("const fn = getFn(); fn();");

    expectSingleIssue(issues, "indirect-call", "included");
  });

  it("detects prototype mutation", () => {
    const issues = detectIssues("Foo.prototype.bar = function () {};");

    expectSingleIssue(issues, "prototype-mutation", "flagged-only");
  });

  it("detects this-calls", () => {
    const issues = detectIssues("class Foo { run() { return 1; } method() { this.run(); } }");

    expectSingleIssue(issues, "this-call", "included");
  });

  it("returns no issues for clean sources", () => {
    const issues = detectIssues("const value = 1 + 2;");

    expect(issues).toHaveLength(0);
  });
});
