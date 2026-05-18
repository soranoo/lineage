import { Visitor } from "oxc-parser";
import type { VisitorObject } from "oxc-parser";
import type { AssignmentExpression, CallExpression } from "@oxc-project/types";

import type {
  AbsolutePath,
  AstNode,
  CharOffset,
  IIssueCollector,
  IssueKind,
  IssueMessage,
  IssueResolution,
  OffsetRange,
  SourceText,
} from "@/types";

/**
 * Detects dynamic patterns that require conservative handling.
 */
export class DynamicPatternDetector {
  private readonly collector: IIssueCollector;

  private readonly issueMessages: Record<IssueKind, IssueMessage> = {
    "unresolved-dependency": "Unresolved dependency.",
    "ignored-path": "Ignored dependency path.",
    "dynamic-import": "Dynamic import detected.",
    "computed-property": "Computed property access detected.",
    eval: "eval call detected.",
    "arguments-object": "arguments object usage detected.",
    "rest-spread-unknown": "Rest/spread usage detected.",
    "indirect-call": "Indirect call detected.",
    "prototype-mutation": "Prototype mutation detected.",
    "this-call": "this-call detected.",
  };

  private readonly issueResolutions: Record<IssueKind, IssueResolution> = {
    "unresolved-dependency": "leaf",
    "ignored-path": "leaf",
    "dynamic-import": "included",
    "computed-property": "included",
    eval: "included",
    "arguments-object": "included",
    "rest-spread-unknown": "included",
    "indirect-call": "included",
    "prototype-mutation": "flagged-only",
    "this-call": "included",
  };

  constructor(collector: IIssueCollector) {
    this.collector = collector;
  }

  /**
   * Walks the AST subtree and emits issues for detected dynamic patterns.
   */
  readonly detect = (node: AstNode, file: AbsolutePath): void => {
    const indirectBindings = new Set<SourceText>();

    const visitor: VisitorObject = {
      VariableDeclarator: (current) => {
        if (current.id.type !== "Identifier") {
          return;
        }

        if (current.init === null || current.init.type !== "CallExpression") {
          return;
        }

        indirectBindings.add(current.id.name);
      },
      AssignmentExpression: (current) => {
        if (
          current.operator === "=" &&
          current.left.type === "Identifier" &&
          current.right.type === "CallExpression"
        ) {
          indirectBindings.add(current.left.name);
        }

        if (this.isPrototypeMutation(current)) {
          this.emitIssue("prototype-mutation", current, file);
        }
      },
      CallExpression: (current) => {
        if (this.isEvalCall(current)) {
          this.emitIssue("eval", current, file);
        }

        if (this.isThisCall(current)) {
          this.emitIssue("this-call", current, file);
        }

        if (this.isIndirectCall(current, indirectBindings)) {
          this.emitIssue("indirect-call", current, file);
        }
      },
      MemberExpression: (current) => {
        if (current.computed) {
          this.emitIssue("computed-property", current, file);
        }
      },
      ImportExpression: (current) => {
        this.emitIssue("dynamic-import", current, file);
      },
      Identifier: (current) => {
        if (current.name === "arguments") {
          this.emitIssue("arguments-object", current, file);
        }
      },
      RestElement: (current) => {
        this.emitIssue("rest-spread-unknown", current, file);
      },
    };

    const walker = new Visitor(visitor);
    walker.visit(node);
  };

  private readonly emitIssue = (
    kind: IssueKind,
    node: { start: CharOffset; end: CharOffset },
    file: AbsolutePath,
  ): void => {
    const range: OffsetRange = { start: node.start, end: node.end };
    const message = this.issueMessages[kind];
    const resolution = this.issueResolutions[kind];

    this.collector.add({
      kind,
      message,
      file,
      range,
      resolution,
    });
  };

  private readonly isEvalCall = (node: CallExpression): boolean =>
    node.callee.type === "Identifier" && node.callee.name === "eval";

  private readonly isThisCall = (node: CallExpression): boolean =>
    node.callee.type === "MemberExpression" && node.callee.object.type === "ThisExpression";

  private readonly isIndirectCall = (
    node: CallExpression,
    indirectBindings: Set<SourceText>,
  ): boolean => node.callee.type === "Identifier" && indirectBindings.has(node.callee.name);

  private readonly isPrototypeMutation = (node: AssignmentExpression): boolean => {
    if (node.left.type !== "MemberExpression") {
      return false;
    }

    const leftObject = node.left.object;
    if (leftObject.type !== "MemberExpression") {
      return false;
    }

    if (leftObject.computed) {
      return false;
    }

    return leftObject.property.type === "Identifier" && leftObject.property.name === "prototype";
  };
}
