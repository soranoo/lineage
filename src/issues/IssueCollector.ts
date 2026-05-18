import type { IIssueCollector, TrackerIssue } from "@/types";

/**
 * Collects tracker issues in insertion order.
 */
export class IssueCollector implements IIssueCollector {
  private readonly issues: TrackerIssue[];

  constructor() {
    this.issues = [];
  }

  /**
   * Appends `issue` to the internal list.
   */
  readonly add = (issue: TrackerIssue): void => {
    this.issues.push(issue);
  };

  /**
   * Returns a shallow copy of all collected issues.
   */
  readonly getAll = (): TrackerIssue[] => [...this.issues];

  /**
   * Clears all collected issues.
   */
  readonly clear = (): void => {
    this.issues.length = 0;
  };
}
