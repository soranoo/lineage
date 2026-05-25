import { describe, expect, it } from "vitest";

import type {
  AbsolutePath,
  IssueKind,
  IssueMessage,
  IssueResolution,
  OffsetRange,
  TrackerIssue,
} from "@/types";

import { IssueCollector } from "@/issues/IssueCollector";

const file: AbsolutePath = "/project/src/issue.ts";
const range: OffsetRange = { start: 0, end: 1 };
const message: IssueMessage = "Issue message";
const resolution: IssueResolution = "included";

const issueKinds: IssueKind[] = [
  "unresolved-dependency",
  "ignored-path",
  "dynamic-import",
  "computed-property",
  "eval",
  "arguments-object",
  "rest-spread-unknown",
  "indirect-call",
  "prototype-mutation",
  "this-call",
];

/**
 * Build a TrackerIssue for the given kind.
 *
 * @param kind Issue kind to embed in the TrackerIssue.
 * @returns TrackerIssue instance for tests.
 */
const buildIssue = (kind: IssueKind): TrackerIssue => ({
  kind,
  message,
  file,
  range,
  resolution,
});

describe("IssueCollector", () => {
  it("appends issues via add", () => {
    const collector = new IssueCollector();
    const issue = buildIssue("eval");

    collector.add(issue);

    expect(collector.getAll()).toEqual([issue]);
  });

  it("returns a shallow copy from getAll", () => {
    const collector = new IssueCollector();
    collector.add(buildIssue("computed-property"));

    const snapshot = collector.getAll();
    snapshot.push(buildIssue("dynamic-import"));

    expect(collector.getAll()).toHaveLength(1);
  });

  it("clears all issues", () => {
    const collector = new IssueCollector();
    collector.add(buildIssue("eval"));

    collector.clear();

    expect(collector.getAll()).toHaveLength(0);
  });

  it("keeps instances isolated", () => {
    const first = new IssueCollector();
    const second = new IssueCollector();

    first.add(buildIssue("eval"));

    expect(second.getAll()).toHaveLength(0);
  });

  it("stores every IssueKind correctly", () => {
    const collector = new IssueCollector();

    for (const kind of issueKinds) {
      collector.add(buildIssue(kind));
    }

    const storedKinds = collector.getAll().map((issue) => issue.kind);

    expect(storedKinds).toEqual(issueKinds);
  });
});
