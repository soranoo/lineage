import type { AssignmentExpression, CallExpression } from "@oxc-project/types";

import { walkAst } from "@/helpers";
import type {
  AbsolutePath,
  AstNode,
  CharOffset,
  IIssueCollector,
  IssueKind,
  IssueMessage,
  IssueResolution,
  OffsetRange,
  ParsedFile,
  SourceText,
} from "@/types";
import { BindingResolver } from "@/slice/BindingResolver";

/**
 * Detects dynamic patterns that require conservative handling.
 */
export class DynamicPatternDetector {
  private readonly collector: IIssueCollector;
  private readonly bindingResolver: BindingResolver;

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
    "dynamic-require": "Dynamic require detected.",
    "usage-cap-reached": "Usage node cap reached.",
    "unresolved-call-target": "Unresolved call target.",
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
    "dynamic-require": "included",
    "usage-cap-reached": "flagged-only",
    "unresolved-call-target": "leaf",
  };

  /**
   * Create a detector that writes issues into the provided collector.
   *
   * @param collector Issue collector to receive detected issues.
   */
  constructor(collector: IIssueCollector) {
    this.collector = collector;
    this.bindingResolver = new BindingResolver();
  }

  /**
   * Walks the AST subtree and emits issues for detected dynamic patterns.
   *
   * @param node Root AST node to scan.
   * @param file Absolute path of the file being analyzed.
   * @param parsedFile Parsed file used to resolve computed keys when available.
   */
  readonly detect = (node: AstNode, file: AbsolutePath, parsedFile?: ParsedFile): void => {
    const indirectBindings = new Set<SourceText>();
    const staticComputedCallees = new Set<AstNode>();

    walkAst(node, (current) => {
      switch (current.type) {
        case "VariableDeclarator": {
          if (current.id.type !== "Identifier") {
            return;
          }

          if (current.init === null || current.init.type !== "CallExpression") {
            return;
          }

          indirectBindings.add(current.id.name);
          return;
        }
        case "AssignmentExpression": {
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
          return;
        }
        case "CallExpression": {
          if (
            current.callee.type === "MemberExpression" &&
            current.callee.computed &&
            this.hasStaticPropertyKey(current.callee, parsedFile)
          ) {
            staticComputedCallees.add(current.callee);
          }

          if (this.isEvalCall(current)) {
            this.emitIssue("eval", current, file);
          }

          if (this.isThisCall(current)) {
            this.emitIssue("this-call", current, file);
          }

          if (this.isDynamicRequire(current)) {
            this.emitIssue("dynamic-require", current, file);
          }

          if (this.isIndirectCall(current, indirectBindings)) {
            this.emitIssue("indirect-call", current, file);
          }
          return;
        }
        case "MemberExpression": {
          if (current.computed && !staticComputedCallees.has(current)) {
            this.emitIssue("computed-property", current, file);
          }
          return;
        }
        case "ImportExpression": {
          this.emitIssue("dynamic-import", current, file);
          return;
        }
        case "Identifier": {
          if (current.name === "arguments") {
            this.emitIssue("arguments-object", current, file);
          }
          return;
        }
        case "RestElement": {
          this.emitIssue("rest-spread-unknown", current, file);
          return;
        }
        default:
          return;
      }
    });
  };

  /**
   * Check whether a computed member has a statically known property key.
   *
   * @param node Computed member expression to inspect.
   * @param parsedFile Parsed file used for binding resolution.
   * @returns True when the key is known without evaluating arbitrary code.
   */
  private readonly hasStaticPropertyKey = (
    node: Extract<AstNode, { type: "MemberExpression" }>,
    parsedFile: ParsedFile | undefined,
  ): boolean => {
    if (node.property.type === "Literal") {
      return (
        typeof node.property.value === "string" ||
        typeof node.property.value === "number" ||
        typeof node.property.value === "boolean"
      );
    }

    if (node.property.type === "TemplateLiteral" && node.property.expressions.length === 0) {
      const [quasi] = node.property.quasis;
      return quasi?.value.cooked !== null && quasi?.value.cooked !== undefined;
    }

    return (
      parsedFile !== undefined &&
      this.bindingResolver.resolveStaticPropertyKeys(node, node, parsedFile).length > 0
    );
  };

  /**
   * Add a single issue to the collector with resolved metadata.
   *
   * @param kind Issue kind to emit.
   * @param node AST node providing the issue span.
   * @param file Absolute path of the file containing the issue.
   */
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

  /**
   * Check whether the call expression is a direct eval call.
   *
   * @param node Call expression to inspect.
   * @returns True when the call is `eval(...)`.
   */
  private readonly isEvalCall = (node: CallExpression): boolean =>
    node.callee.type === "Identifier" && node.callee.name === "eval";

  /**
   * Check whether the call expression is a this-method call.
   *
   * @param node Call expression to inspect.
   * @returns True when the callee is a member on `this`.
   */
  private readonly isThisCall = (node: CallExpression): boolean =>
    node.callee.type === "MemberExpression" && node.callee.object.type === "ThisExpression";

  /**
   * Check whether the call is a require with a non-literal module target.
   *
   * @param node Call expression to inspect.
   * @returns True when require cannot be resolved from a string literal.
   */
  private readonly isDynamicRequire = (node: CallExpression): boolean => {
    if (node.callee.type !== "Identifier" || node.callee.name !== "require") {
      return false;
    }

    const [argument] = node.arguments;
    return (
      argument === undefined || argument.type !== "Literal" || typeof argument.value !== "string"
    );
  };

  /**
   * Check whether the call expression is an indirect call via a bound identifier.
   *
   * @param node Call expression to inspect.
   * @param indirectBindings Set of identifiers previously bound to call results.
   * @returns True when the call targets an indirect binding.
   */
  private readonly isIndirectCall = (
    node: CallExpression,
    indirectBindings: Set<SourceText>,
  ): boolean => node.callee.type === "Identifier" && indirectBindings.has(node.callee.name);

  /**
   * Check whether the assignment mutates a prototype property.
   *
   * @param node Assignment expression to inspect.
   * @returns True when the assignment targets `Foo.prototype.*`.
   */
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
