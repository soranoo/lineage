import { assertNever } from "assert-never";
import { Visitor } from "oxc-parser";
import type { VisitorObject } from "oxc-parser";
import type {
  AssignmentExpression,
  AssignmentTarget,
  AssignmentTargetMaybeDefault,
  AssignmentTargetProperty,
  AssignmentTargetRest,
  BindingPattern,
  BindingProperty,
  BindingRestElement,
  BlockStatement,
  Expression,
  ExpressionStatement,
  IfStatement,
  Program,
  ReturnStatement,
  Statement,
  UpdateExpression,
  VariableDeclaration,
  VariableDeclarator,
} from "@oxc-project/types";

import type { FunctionNode, OffsetRange, SourceText } from "@/types";
import type { IShaker } from "@/shake/Shaker";

/**
 * Analysis result for a statement list.
 */
type StatementAnalysis = {
  /** Identifiers required before executing the statement list. */
  liveIn: Set<SourceText>;
  /** Ranges that should be shaken from the statement list. */
  shaken: Set<OffsetRange>;
};

/**
 * Marks statements inside a function body that do not contribute to return/yield values.
 */
export class IntraFunctionShaker implements IShaker {
  /**
   * Returns ranges for statements that do not feed a return or yield expression.
   *
   * @param fn Function node to analyze.
   * @param _source Source text that contains the function.
   * @returns Set of ranges that should be removed or blanked.
   */
  readonly shake = (fn: FunctionNode, _source: SourceText): Set<OffsetRange> => {
    const statements = getFunctionStatements(fn);

    if (statements.length === 0) {
      return new Set();
    }

    const result = analyzeStatements(statements, new Set<SourceText>());
    return result.shaken;
  };
}

/**
 * Extract top-level statements from a function body.
 *
 * @param fn Function node to inspect.
 * @returns Statements from the function body, or an empty list for expression bodies.
 * @throws {Error} When an unexpected function node type is encountered.
 */
const getFunctionStatements = (fn: FunctionNode): Statement[] => {
  switch (fn.type) {
    case "ArrowFunctionExpression":
      if (fn.body.type === "BlockStatement") {
        return fn.body.body;
      }
      return [];
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "TSDeclareFunction":
    case "TSEmptyBodyFunctionExpression":
      return fn.body?.body ?? [];
    default:
      return assertNever(fn);
  }
};

/**
 * Analyze a list of statements using backward liveness propagation.
 *
 * @param statements Statements to analyze.
 * @param liveOut Identifiers required after executing the statement list.
 * @returns Statement analysis containing live-in identifiers and shaken ranges.
 */
const analyzeStatements = (
  statements: Statement[],
  liveOut: Set<SourceText>,
): StatementAnalysis => {
  let live = new Set(liveOut);
  const shaken = new Set<OffsetRange>();

  // Walk backwards so we can propagate dependencies from return/yield nodes.
  for (let index = statements.length - 1; index >= 0; index -= 1) {
    const statement = statements[index];
    if (statement === undefined) {
      continue;
    }
    const result = analyzeStatement(statement, live);

    live = result.liveIn;
    mergeRanges(shaken, result.shaken);
  }

  return { liveIn: live, shaken };
};

/**
 * Analyze a single statement and update liveness and shake ranges.
 *
 * @param statement Statement to analyze.
 * @param liveOut Identifiers required after executing the statement.
 * @returns Statement analysis with updated liveness and shaken ranges.
 * @throws {Error} When an unexpected statement type is encountered.
 */
const analyzeStatement = (statement: Statement, liveOut: Set<SourceText>): StatementAnalysis => {
  switch (statement.type) {
    case "ReturnStatement":
      return analyzeReturnStatement(statement);
    case "VariableDeclaration":
      return analyzeVariableDeclaration(statement, liveOut);
    case "ExpressionStatement":
      return analyzeExpressionStatement(statement, liveOut);
    case "IfStatement":
      return analyzeIfStatement(statement, liveOut);
    case "BlockStatement":
      return analyzeBlockStatement(statement, liveOut);
    case "BreakStatement":
    case "ContinueStatement":
    case "DebuggerStatement":
    case "DoWhileStatement":
    case "EmptyStatement":
    case "ForInStatement":
    case "ForOfStatement":
    case "ForStatement":
    case "LabeledStatement":
    case "SwitchStatement":
    case "ThrowStatement":
    case "TryStatement":
    case "WhileStatement":
    case "WithStatement":
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "TSDeclareFunction":
    case "TSEmptyBodyFunctionExpression":
    case "ClassDeclaration":
    case "ClassExpression":
    case "TSTypeAliasDeclaration":
    case "TSInterfaceDeclaration":
    case "TSEnumDeclaration":
    case "TSModuleDeclaration":
    case "TSImportEqualsDeclaration":
    case "ImportDeclaration":
    case "ExportAllDeclaration":
    case "ExportDefaultDeclaration":
    case "ExportNamedDeclaration":
    case "TSExportAssignment":
    case "TSNamespaceExportDeclaration":
      return analyzeOtherStatement(statement, liveOut);
    default:
      return assertNever(statement);
  }
};

/**
 * Analyze a return statement as a liveness sink.
 *
 * @param statement Return statement to analyze.
 * @returns Statement analysis with identifiers required by the return value.
 */
const analyzeReturnStatement = (statement: ReturnStatement): StatementAnalysis => {
  const liveIn = statement.argument
    ? collectIdentifiersFromExpression(statement.argument)
    : new Set<SourceText>();

  return {
    liveIn,
    shaken: new Set(),
  };
};

/**
 * Analyze a variable declaration to decide whether it can be shaken.
 *
 * @param statement Variable declaration to analyze.
 * @param liveOut Identifiers required after the declaration executes.
 * @returns Statement analysis with updated liveness and shaken ranges.
 */
const analyzeVariableDeclaration = (
  statement: VariableDeclaration,
  liveOut: Set<SourceText>,
): StatementAnalysis => {
  const definitions = collectDeclarationDefinitions(statement);
  const uses = collectDeclarationUses(statement);
  const intersects = hasIntersection(definitions, liveOut);

  if (!intersects) {
    return {
      liveIn: new Set(liveOut),
      shaken: new Set([buildRange(statement)]),
    };
  }

  const liveIn = unionSets(subtractSets(liveOut, definitions), uses);

  return {
    liveIn,
    shaken: new Set(),
  };
};

/**
 * Analyze an expression statement for assignment or yield effects.
 *
 * @param statement Expression statement to analyze.
 * @param liveOut Identifiers required after the expression executes.
 * @returns Statement analysis with updated liveness and shaken ranges.
 */
const analyzeExpressionStatement = (
  statement: ExpressionStatement,
  liveOut: Set<SourceText>,
): StatementAnalysis => {
  const expression = statement.expression;

  if (expression.type === "YieldExpression") {
    const liveIn = expression.argument
      ? collectIdentifiersFromExpression(expression.argument)
      : new Set<SourceText>();

    return {
      liveIn,
      shaken: new Set(),
    };
  }

  if (expression.type === "AssignmentExpression") {
    return analyzeAssignmentExpression(statement, expression, liveOut);
  }

  if (expression.type === "UpdateExpression") {
    return analyzeUpdateExpression(statement, expression, liveOut);
  }

  return {
    liveIn: new Set(liveOut),
    shaken: new Set([buildRange(statement)]),
  };
};

/**
 * Analyze an assignment expression statement for liveness impact.
 *
 * @param statement Expression statement containing the assignment.
 * @param expression Assignment expression to analyze.
 * @param liveOut Identifiers required after the assignment executes.
 * @returns Statement analysis with updated liveness and shaken ranges.
 */
const analyzeAssignmentExpression = (
  statement: ExpressionStatement,
  expression: AssignmentExpression,
  liveOut: Set<SourceText>,
): StatementAnalysis => {
  const definitions = collectAssignmentTargetIdentifiers(expression.left);

  if (definitions.size === 0 || !hasIntersection(definitions, liveOut)) {
    return {
      liveIn: new Set(liveOut),
      shaken: new Set([buildRange(statement)]),
    };
  }

  const uses = collectIdentifiersFromExpression(expression.right);
  const liveIn = unionSets(subtractSets(liveOut, definitions), uses);

  return {
    liveIn,
    shaken: new Set(),
  };
};

/**
 * Analyze an update expression statement for liveness impact.
 *
 * @param statement Expression statement containing the update.
 * @param expression Update expression to analyze.
 * @param liveOut Identifiers required after the update executes.
 * @returns Statement analysis with updated liveness and shaken ranges.
 */
const analyzeUpdateExpression = (
  statement: ExpressionStatement,
  expression: UpdateExpression,
  liveOut: Set<SourceText>,
): StatementAnalysis => {
  const definitions = collectAssignmentTargetIdentifiers(expression.argument);

  if (definitions.size === 0 || !hasIntersection(definitions, liveOut)) {
    return {
      liveIn: new Set(liveOut),
      shaken: new Set([buildRange(statement)]),
    };
  }

  const liveIn = unionSets(subtractSets(liveOut, definitions), definitions);

  return {
    liveIn,
    shaken: new Set(),
  };
};

/**
 * Analyze an if statement by merging liveness from both branches.
 *
 * @param statement If statement to analyze.
 * @param liveOut Identifiers required after the if statement.
 * @returns Statement analysis with merged liveness and shaken ranges.
 */
const analyzeIfStatement = (
  statement: IfStatement,
  liveOut: Set<SourceText>,
): StatementAnalysis => {
  const consequentResult = analyzeStatement(statement.consequent, liveOut);
  const alternateResult = statement.alternate
    ? analyzeStatement(statement.alternate, liveOut)
    : { liveIn: new Set(liveOut), shaken: new Set<OffsetRange>() };
  const testUses = collectIdentifiersFromExpression(statement.test);

  const liveIn = unionSets(unionSets(consequentResult.liveIn, alternateResult.liveIn), testUses);
  const shaken = new Set<OffsetRange>();

  mergeRanges(shaken, consequentResult.shaken);
  mergeRanges(shaken, alternateResult.shaken);

  return { liveIn, shaken };
};

/**
 * Analyze a block statement by analyzing its statement list.
 *
 * @param statement Block statement to analyze.
 * @param liveOut Identifiers required after the block executes.
 * @returns Statement analysis with updated liveness and shaken ranges.
 */
const analyzeBlockStatement = (
  statement: BlockStatement,
  liveOut: Set<SourceText>,
): StatementAnalysis => analyzeStatements(statement.body, liveOut);

/**
 * Conservatively analyze a statement by collecting all identifier uses.
 *
 * @param statement Statement to analyze.
 * @param liveOut Identifiers required after the statement executes.
 * @returns Statement analysis with updated liveness and shaken ranges.
 */
const analyzeOtherStatement = (
  statement: Statement,
  liveOut: Set<SourceText>,
): StatementAnalysis => {
  const uses = collectIdentifiersFromStatement(statement);
  const liveIn = unionSets(liveOut, uses);

  return {
    liveIn,
    shaken: new Set(),
  };
};

/**
 * Collect identifiers declared by a variable declaration statement.
 *
 * @param statement Variable declaration to inspect.
 * @returns Set of declared identifier names.
 */
const collectDeclarationDefinitions = (statement: VariableDeclaration): Set<SourceText> => {
  const definitions = new Set<SourceText>();

  for (const declarator of statement.declarations) {
    const names = collectBindingIdentifiers(declarator.id);

    for (const name of names) {
      definitions.add(name);
    }
  }

  return definitions;
};

/**
 * Collect identifiers referenced by variable initializers.
 *
 * @param statement Variable declaration to inspect.
 * @returns Set of identifier names referenced by initializers.
 */
const collectDeclarationUses = (statement: VariableDeclaration): Set<SourceText> => {
  const uses = new Set<SourceText>();

  for (const declarator of statement.declarations) {
    const names = collectDeclaratorUses(declarator);

    for (const name of names) {
      uses.add(name);
    }
  }

  return uses;
};

/**
 * Collect identifiers referenced by a single declarator initializer.
 *
 * @param declarator Variable declarator to inspect.
 * @returns Set of identifier names referenced by the initializer.
 */
const collectDeclaratorUses = (declarator: VariableDeclarator): Set<SourceText> => {
  if (declarator.init === null) {
    return new Set();
  }

  return collectIdentifiersFromExpression(declarator.init);
};

/**
 * Collect identifier names from a binding pattern.
 *
 * @param pattern Binding pattern to inspect.
 * @returns Set of identifier names declared by the pattern.
 * @throws {Error} When an unexpected binding pattern is encountered.
 */
const collectBindingIdentifiers = (pattern: BindingPattern): Set<SourceText> => {
  switch (pattern.type) {
    case "Identifier":
      return new Set([pattern.name]);
    case "ObjectPattern":
      return collectObjectPatternIdentifiers(pattern.properties);
    case "ArrayPattern":
      return collectArrayPatternIdentifiers(pattern.elements);
    case "AssignmentPattern":
      return collectBindingIdentifiers(pattern.left);
    default:
      return assertNever(pattern);
  }
};

/**
 * Collect identifier names from object binding properties.
 *
 * @param properties Object binding properties to inspect.
 * @returns Set of identifier names declared by the object pattern.
 */
const collectObjectPatternIdentifiers = (
  properties: Array<BindingProperty | BindingRestElement>,
): Set<SourceText> => {
  const names = new Set<SourceText>();

  for (const property of properties) {
    const propertyNames = collectBindingPropertyIdentifiers(property);

    for (const name of propertyNames) {
      names.add(name);
    }
  }

  return names;
};

/**
 * Collect identifier names from a binding property or rest element.
 *
 * @param property Binding property or rest element to inspect.
 * @returns Set of identifier names declared by the property.
 * @throws {Error} When an unexpected binding property type is encountered.
 */
const collectBindingPropertyIdentifiers = (
  property: BindingProperty | BindingRestElement,
): Set<SourceText> => {
  switch (property.type) {
    case "Property":
      return collectBindingIdentifiers(property.value);
    case "RestElement":
      return collectBindingIdentifiers(property.argument);
    default:
      return assertNever(property);
  }
};

/**
 * Collect identifier names from array binding elements.
 *
 * @param elements Array binding elements to inspect.
 * @returns Set of identifier names declared by the array pattern.
 */
const collectArrayPatternIdentifiers = (
  elements: Array<BindingPattern | BindingRestElement | null>,
): Set<SourceText> => {
  const names = new Set<SourceText>();

  for (const element of elements) {
    if (element === null) {
      continue;
    }

    const elementNames = collectBindingPatternElementIdentifiers(element);

    for (const name of elementNames) {
      names.add(name);
    }
  }

  return names;
};

/**
 * Collect identifiers from a single array binding element.
 *
 * @param element Array binding element to inspect.
 * @returns Set of identifier names declared by the element.
 * @throws {Error} When an unexpected binding element type is encountered.
 */
const collectBindingPatternElementIdentifiers = (
  element: BindingPattern | BindingRestElement,
): Set<SourceText> => {
  switch (element.type) {
    case "RestElement":
      return collectBindingIdentifiers(element.argument);
    case "Identifier":
    case "ObjectPattern":
    case "ArrayPattern":
    case "AssignmentPattern":
      return collectBindingIdentifiers(element);
    default:
      return assertNever(element);
  }
};

/**
 * Collect identifier names from an assignment target.
 *
 * @param target Assignment target to inspect.
 * @returns Set of identifier names defined by the target.
 * @throws {Error} When an unexpected assignment target is encountered.
 */
const collectAssignmentTargetIdentifiers = (target: AssignmentTarget): Set<SourceText> => {
  switch (target.type) {
    case "Identifier":
      return new Set([target.name]);
    case "ArrayPattern":
      return collectAssignmentArrayPatternIdentifiers(target.elements);
    case "ObjectPattern":
      return collectAssignmentObjectPatternIdentifiers(target.properties);
    case "MemberExpression":
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
    case "TSTypeAssertion":
      return new Set();
    default:
      return assertNever(target);
  }
};

/**
 * Collect identifier names from array assignment pattern elements.
 *
 * @param elements Array assignment elements to inspect.
 * @returns Set of identifier names defined by the array assignment pattern.
 */
const collectAssignmentArrayPatternIdentifiers = (
  elements: Array<AssignmentTargetMaybeDefault | AssignmentTargetRest | null>,
): Set<SourceText> => {
  const names = new Set<SourceText>();

  for (const element of elements) {
    if (element === null) {
      continue;
    }

    const elementNames = collectAssignmentElementIdentifiers(element);

    for (const name of elementNames) {
      names.add(name);
    }
  }

  return names;
};

/**
 * Collect identifier names from a single assignment pattern element.
 *
 * @param element Assignment element to inspect.
 * @returns Set of identifier names defined by the element.
 * @throws {Error} When an unexpected assignment element is encountered.
 */
const collectAssignmentElementIdentifiers = (
  element: AssignmentTargetMaybeDefault | AssignmentTargetRest,
): Set<SourceText> => {
  switch (element.type) {
    case "RestElement":
      return collectAssignmentTargetIdentifiers(element.argument);
    case "AssignmentPattern":
      return collectAssignmentTargetIdentifiers(element.left);
    case "Identifier":
    case "ArrayPattern":
    case "ObjectPattern":
    case "MemberExpression":
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
    case "TSTypeAssertion":
      return collectAssignmentTargetIdentifiers(element);
    default:
      return assertNever(element);
  }
};

/**
 * Collect identifier names from object assignment pattern properties.
 *
 * @param properties Object assignment properties to inspect.
 * @returns Set of identifier names defined by the object assignment pattern.
 */
const collectAssignmentObjectPatternIdentifiers = (
  properties: Array<AssignmentTargetProperty | AssignmentTargetRest>,
): Set<SourceText> => {
  const names = new Set<SourceText>();

  for (const property of properties) {
    const propertyNames = collectAssignmentPropertyIdentifiers(property);

    for (const name of propertyNames) {
      names.add(name);
    }
  }

  return names;
};

/**
 * Collect identifier names from an assignment property or rest element.
 *
 * @param property Assignment property or rest element to inspect.
 * @returns Set of identifier names defined by the property.
 * @throws {Error} When an unexpected assignment property type is encountered.
 */
const collectAssignmentPropertyIdentifiers = (
  property: AssignmentTargetProperty | AssignmentTargetRest,
): Set<SourceText> => {
  switch (property.type) {
    case "RestElement":
      return collectAssignmentTargetIdentifiers(property.argument);
    case "Property":
      return collectAssignmentMaybeDefaultIdentifiers(property.value);
    default:
      return assertNever(property);
  }
};

/**
 * Collect identifier names from an assignment target with optional defaults.
 *
 * @param target Assignment target to inspect.
 * @returns Set of identifier names defined by the assignment target.
 * @throws {Error} When an unexpected assignment target is encountered.
 */
const collectAssignmentMaybeDefaultIdentifiers = (
  target: AssignmentTargetMaybeDefault,
): Set<SourceText> => {
  switch (target.type) {
    case "AssignmentPattern":
      return collectAssignmentTargetIdentifiers(target.left);
    case "Identifier":
    case "ArrayPattern":
    case "ObjectPattern":
    case "MemberExpression":
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
    case "TSTypeAssertion":
      return collectAssignmentTargetIdentifiers(target);
    default:
      return assertNever(target);
  }
};

/**
 * Collect identifier names referenced by an expression.
 *
 * @param expression Expression to inspect.
 * @returns Set of identifier names referenced by the expression.
 */
const collectIdentifiersFromExpression = (expression: Expression): Set<SourceText> => {
  const statement = buildExpressionStatement(expression);
  return collectIdentifiersFromProgram(buildProgram([statement]));
};

/**
 * Collect identifier names referenced by a statement.
 *
 * @param statement Statement to inspect.
 * @returns Set of identifier names referenced by the statement.
 */
const collectIdentifiersFromStatement = (statement: Statement): Set<SourceText> =>
  collectIdentifiersFromProgram(buildProgram([statement]));

/**
 * Collect identifier names referenced within a program node.
 *
 * @param program Program node to inspect.
 * @returns Set of identifier names referenced by the program.
 */
const collectIdentifiersFromProgram = (program: Program): Set<SourceText> => {
  const names = new Set<SourceText>();

  const visitor: VisitorObject = {
    Identifier: (current) => {
      names.add(current.name);
    },
  };

  const walker = new Visitor(visitor);
  walker.visit(program);

  return names;
};

/**
 * Build a synthetic program node for visitation.
 *
 * @param body Statement list to include in the program.
 * @returns Program node containing the provided statements.
 */
const buildProgram = (body: Statement[]): Program => {
  let start = 0;
  let end = 0;
  let seen = false;

  for (const statement of body) {
    if (!seen) {
      start = statement.start;
      seen = true;
    }

    end = statement.end;
  }

  return {
    type: "Program",
    body,
    sourceType: "module",
    hashbang: null,
    start,
    end,
  };
};

/**
 * Wrap an expression in a synthetic expression statement.
 *
 * @param expression Expression to wrap.
 * @returns Expression statement node containing the expression.
 */
const buildExpressionStatement = (expression: Expression): ExpressionStatement => ({
  type: "ExpressionStatement",
  expression,
  start: expression.start,
  end: expression.end,
});

/**
 * Build an offset range from a span-like node.
 *
 * @param node Node with start and end offsets.
 * @returns Offset range covering the node span.
 */
const buildRange = (node: { start: number; end: number }): OffsetRange => ({
  start: node.start,
  end: node.end,
});

/**
 * Merge all ranges from source into target.
 *
 * @param target Set to receive merged ranges.
 * @param source Set providing ranges to merge.
 */
const mergeRanges = (target: Set<OffsetRange>, source: Set<OffsetRange>): void => {
  for (const range of source) {
    target.add(range);
  }
};

/**
 * Compute the union of two identifier sets.
 *
 * @param left Left-hand set.
 * @param right Right-hand set.
 * @returns New set containing values from both inputs.
 */
const unionSets = (left: Set<SourceText>, right: Set<SourceText>): Set<SourceText> => {
  const merged = new Set(left);

  for (const value of right) {
    merged.add(value);
  }

  return merged;
};

/**
 * Compute the set difference between two identifier sets.
 *
 * @param left Left-hand set.
 * @param right Right-hand set of values to remove.
 * @returns New set containing values from left minus right.
 */
const subtractSets = (left: Set<SourceText>, right: Set<SourceText>): Set<SourceText> => {
  const next = new Set(left);

  for (const value of right) {
    next.delete(value);
  }

  return next;
};

/**
 * Test whether two identifier sets intersect.
 *
 * @param left Left-hand set.
 * @param right Right-hand set.
 * @returns True when both sets share at least one value.
 */
const hasIntersection = (left: Set<SourceText>, right: Set<SourceText>): boolean => {
  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }

  return false;
};
