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

const analyzeReturnStatement = (statement: ReturnStatement): StatementAnalysis => {
  const liveIn = statement.argument
    ? collectIdentifiersFromExpression(statement.argument)
    : new Set<SourceText>();

  return {
    liveIn,
    shaken: new Set(),
  };
};

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

const analyzeBlockStatement = (
  statement: BlockStatement,
  liveOut: Set<SourceText>,
): StatementAnalysis => analyzeStatements(statement.body, liveOut);

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

const collectDeclaratorUses = (declarator: VariableDeclarator): Set<SourceText> => {
  if (declarator.init === null) {
    return new Set();
  }

  return collectIdentifiersFromExpression(declarator.init);
};

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

const collectIdentifiersFromExpression = (expression: Expression): Set<SourceText> => {
  const statement = buildExpressionStatement(expression);
  return collectIdentifiersFromProgram(buildProgram([statement]));
};

const collectIdentifiersFromStatement = (statement: Statement): Set<SourceText> =>
  collectIdentifiersFromProgram(buildProgram([statement]));

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

const buildExpressionStatement = (expression: Expression): ExpressionStatement => ({
  type: "ExpressionStatement",
  expression,
  start: expression.start,
  end: expression.end,
});

const buildRange = (node: { start: number; end: number }): OffsetRange => ({
  start: node.start,
  end: node.end,
});

const mergeRanges = (target: Set<OffsetRange>, source: Set<OffsetRange>): void => {
  for (const range of source) {
    target.add(range);
  }
};

const unionSets = (left: Set<SourceText>, right: Set<SourceText>): Set<SourceText> => {
  const merged = new Set(left);

  for (const value of right) {
    merged.add(value);
  }

  return merged;
};

const subtractSets = (left: Set<SourceText>, right: Set<SourceText>): Set<SourceText> => {
  const next = new Set(left);

  for (const value of right) {
    next.delete(value);
  }

  return next;
};

const hasIntersection = (left: Set<SourceText>, right: Set<SourceText>): boolean => {
  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }

  return false;
};
