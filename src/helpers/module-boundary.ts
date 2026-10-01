import { assertNever } from "assert-never";

import type {
  AstNode,
  CommonJsExportSite,
  CommonJsRequireSite,
  ExportedBinding,
  ExportedName,
  LocalAlias,
  ModuleBoundaryImport,
  ModuleSpecifier,
  OxcAst,
  ReExportKind,
  SourceText,
} from "@/types";
import { walkAst } from "@/helpers/ast-walker";

const DEFAULT_EXPORT: ExportedName = "default";
const NAMESPACE_EXPORT: ExportedName = "*";

const getStringLiteral = (node: AstNode | null | undefined): SourceText | null => {
  if (node === null || node === undefined || node.type !== "Literal") {
    return null;
  }

  return typeof node.value === "string" ? node.value : null;
};

const getModuleExportName = (node: AstNode): ExportedName => {
  if (node.type === "Identifier") {
    return node.name;
  }

  const literal = getStringLiteral(node);
  if (literal !== null) {
    return literal;
  }

  throw new TypeError("Module export name must be an identifier or string literal.");
};

const getRequireSpecifier = (node: AstNode | null): ModuleSpecifier | null => {
  if (node === null) {
    return null;
  }

  if (
    node.type !== "CallExpression" ||
    node.callee.type !== "Identifier" ||
    node.callee.name !== "require"
  ) {
    return null;
  }

  const [argument] = node.arguments;
  return getStringLiteral(argument);
};

const getPatternIdentifier = (node: AstNode): LocalAlias | null => {
  switch (node.type) {
    case "Identifier":
      return node.name;
    case "AssignmentPattern":
      return getPatternIdentifier(node.left);
    default:
      return null;
  }
};

const getStaticPropertyName = (node: AstNode): ExportedName | null => {
  if (node.type !== "MemberExpression") {
    return null;
  }

  if (!node.computed && node.property.type === "Identifier") {
    return node.property.name;
  }

  return node.computed ? getStringLiteral(node.property) : null;
};

const getCommonJsPropertyName = (node: AstNode): ExportedName | null => {
  if (node.type !== "MemberExpression") {
    return null;
  }

  if (node.object.type === "Identifier" && node.object.name === "exports") {
    return getStaticPropertyName(node);
  }

  if (
    node.object.type === "MemberExpression" &&
    node.object.object.type === "Identifier" &&
    node.object.object.name === "module" &&
    getStaticPropertyName(node.object) === "exports"
  ) {
    return getStaticPropertyName(node);
  }

  return null;
};

const isModuleExportsObject = (node: AstNode): boolean =>
  node.type === "MemberExpression" &&
  node.object.type === "Identifier" &&
  node.object.name === "module" &&
  getStaticPropertyName(node) === "exports";

const collectObjectExports = (node: AstNode): ExportedBinding[] => {
  if (node.type !== "ObjectExpression") {
    return [];
  }

  const bindings: ExportedBinding[] = [];
  for (const property of node.properties) {
    if (property.type !== "Property" || property.kind !== "init") {
      continue;
    }

    const exportedName = getModuleExportName(property.key);
    const localName = getPatternIdentifier(property.value);
    bindings.push({ exportedName, localName: localName ?? undefined });
  }

  return bindings;
};

const collectCommonJsExports = (node: AstNode): ExportedBinding[] => {
  if (node.type !== "AssignmentExpression" || node.operator !== "=") {
    return [];
  }

  if (isModuleExportsObject(node.left)) {
    const objectExports = collectObjectExports(node.right);
    if (objectExports.length > 0) {
      return objectExports;
    }

    const localName = getPatternIdentifier(node.right);
    return [{ exportedName: DEFAULT_EXPORT, localName: localName ?? undefined }];
  }

  const exportedName = getCommonJsPropertyName(node.left);
  if (exportedName === null) {
    return [];
  }

  const localName = getPatternIdentifier(node.right);
  return [{ exportedName, localName: localName ?? undefined }];
};

const collectVariableExports = (node: AstNode): ExportedBinding[] => {
  if (node.type !== "VariableDeclaration") {
    return [];
  }

  const bindings: ExportedBinding[] = [];
  for (const declaration of node.declarations) {
    const localName = getPatternIdentifier(declaration.id);
    if (localName !== null) {
      bindings.push({ exportedName: localName, localName });
    }
  }

  return bindings;
};

const collectDeclarationExports = (node: AstNode | null): ExportedBinding[] => {
  if (node === null) {
    return [];
  }

  switch (node.type) {
    case "VariableDeclaration":
      return collectVariableExports(node);
    case "FunctionDeclaration":
    case "ClassDeclaration":
      return node.id === null ? [] : [{ exportedName: node.id.name, localName: node.id.name }];
    default:
      return [];
  }
};

const collectImportDeclaration = (
  statement: Extract<OxcAst["body"][number], { type: "ImportDeclaration" }>,
): ModuleBoundaryImport[] => {
  const imports: ModuleBoundaryImport[] = [];

  for (const specifier of statement.specifiers) {
    let importedName: ExportedName;
    switch (specifier.type) {
      case "ImportSpecifier":
        importedName = getModuleExportName(specifier.imported);
        break;
      case "ImportDefaultSpecifier":
        importedName = DEFAULT_EXPORT;
        break;
      case "ImportNamespaceSpecifier":
        importedName = NAMESPACE_EXPORT;
        break;
      default:
        assertNever(specifier);
    }

    imports.push({
      kind: "import",
      specifier: statement.source.value,
      importedName,
      localAlias: specifier.local.name,
    });
  }

  return imports;
};

const collectReExportDeclaration = (
  statement: Extract<OxcAst["body"][number], { type: "ExportNamedDeclaration" }>,
): ModuleBoundaryImport[] => {
  if (statement.source === null) {
    return [];
  }

  const imports: ModuleBoundaryImport[] = [];
  for (const specifier of statement.specifiers) {
    const importedName = getModuleExportName(specifier.local);
    const exportedName = getModuleExportName(specifier.exported);
    const reExportKind: ReExportKind =
      importedName === DEFAULT_EXPORT || exportedName === DEFAULT_EXPORT ? "default" : "named";

    imports.push({
      kind: "re-export",
      specifier: statement.source.value,
      importedName,
      localAlias: exportedName,
      exportedName,
      reExportKind,
    });
  }

  return imports;
};

const collectExportAllDeclaration = (
  statement: Extract<OxcAst["body"][number], { type: "ExportAllDeclaration" }>,
): ModuleBoundaryImport => {
  const exportedName =
    statement.exported === null ? NAMESPACE_EXPORT : getModuleExportName(statement.exported);
  const reExportKind: ReExportKind = statement.exported === null ? "export-all" : "namespace";

  return {
    kind: "re-export",
    specifier: statement.source.value,
    importedName: NAMESPACE_EXPORT,
    localAlias: exportedName,
    exportedName,
    reExportKind,
  };
};

const collectRequireImports = (statement: AstNode): ModuleBoundaryImport[] => {
  if (statement.type === "ExpressionStatement") {
    return [];
  }

  if (statement.type !== "VariableDeclaration") {
    return [];
  }

  const imports: ModuleBoundaryImport[] = [];
  for (const declaration of statement.declarations) {
    const specifier = getRequireSpecifier(declaration.init);
    if (specifier === null) {
      continue;
    }

    if (declaration.id.type === "Identifier") {
      imports.push({
        kind: "import",
        specifier,
        importedName: NAMESPACE_EXPORT,
        localAlias: declaration.id.name,
      });
      continue;
    }

    if (declaration.id.type !== "ObjectPattern") {
      continue;
    }

    for (const property of declaration.id.properties) {
      if (property.type !== "Property" || property.kind !== "init") {
        continue;
      }

      const localAlias = getPatternIdentifier(property.value);
      if (localAlias === null) {
        continue;
      }

      imports.push({
        kind: "import",
        specifier,
        importedName: getModuleExportName(property.key),
        localAlias,
      });
    }
  }

  return imports;
};

/**
 * Find static CommonJS imports associated with the variable declarator containing `target`.
 *
 * The returned sites include only literal `require` calls whose imported local
 * binding belongs to that declarator. When `localAlias` is provided, results
 * are limited to that binding. Returns an empty array when `target` is not
 * contained by a matching declarator.
 *
 * @param ast The parsed program to search.
 * @param target The AST node whose containing declarator should be selected.
 * @param localAlias Optional local binding name used to filter the results.
 * @returns Matching CommonJS require sites in the selected declaration.
 */
export const findCommonJsRequireSites = (
  ast: OxcAst,
  target: AstNode,
  localAlias?: LocalAlias,
): CommonJsRequireSite[] => {
  const candidates: Array<{ declarator: AstNode; declaration: AstNode }> = [];
  walkAst(ast, (node, parent) => {
    if (
      node.type === "VariableDeclarator" &&
      parent?.type === "VariableDeclaration" &&
      node.start <= target.start &&
      node.end >= target.end &&
      node.init?.type === "CallExpression"
    ) {
      candidates.push({ declarator: node, declaration: parent });
    }
  });

  const selected = candidates.sort(
    (left, right) =>
      left.declarator.end - left.declarator.start - (right.declarator.end - right.declarator.start),
  )[0];
  const declarator = selected?.declarator;
  const declaration = selected?.declaration;
  const call = declarator?.type === "VariableDeclarator" ? declarator.init : null;
  if (
    declarator?.type !== "VariableDeclarator" ||
    call?.type !== "CallExpression" ||
    declaration?.type !== "VariableDeclaration"
  ) {
    return [];
  }

  const declaredAliases = new Set<LocalAlias>();
  walkAst(declarator.id, (node, parent) => {
    if (
      node.type === "Identifier" &&
      !(parent?.type === "Property" && parent.key === node && parent.value !== node)
    ) {
      declaredAliases.add(node.name);
    }
  });

  return collectRequireImports(declaration)
    .filter(
      (binding) =>
        declaredAliases.has(binding.localAlias) &&
        (localAlias === undefined || binding.localAlias === localAlias),
    )
    .map((binding) => ({ boundary: declaration, call, binding }));
};

/**
 * Find the first statically identifiable CommonJS export with the requested name.
 *
 * The search includes export assignments nested inside wrapper expressions,
 * such as bundle IIFEs.
 *
 * @param ast The parsed program to search.
 * @param exportedName - The exported name to find.
 * @returns The matching export site, or `null` when no matching export exists.
 */
export const findCommonJsExportSite = (
  ast: OxcAst,
  exportedName: ExportedName,
): CommonJsExportSite | null => {
  let found: CommonJsExportSite | null = null;
  walkAst(ast, (node) => {
    if (found !== null) {
      return;
    }
    const binding = collectCommonJsExports(node).find(
      (entry) => entry.exportedName === exportedName,
    );
    if (binding !== undefined) {
      found = { boundary: node, binding };
    }
  });
  return found;
};

/**
 * Collect module specifiers from ESM declarations and static CommonJS requires.
 *
 * CommonJS calls are found throughout the program, including inside wrapper
 * expressions. Dynamic `require` calls are omitted because their target cannot
 * be determined statically.
 *
 * @param ast Parsed program AST.
 * @returns Unique module specifiers in source order.
 */
export const collectSpecifiers = (ast: OxcAst): ModuleSpecifier[] => {
  const specifiers = new Set<ModuleSpecifier>();

  for (const statement of ast.body) {
    switch (statement.type) {
      case "ImportDeclaration":
        specifiers.add(statement.source.value);
        break;
      case "ExportNamedDeclaration":
        if (statement.source !== null) {
          specifiers.add(statement.source.value);
        }
        break;
      case "ExportAllDeclaration":
        specifiers.add(statement.source.value);
        break;
      case "ExpressionStatement":
        {
          const specifier = getRequireSpecifier(statement.expression);
          if (specifier !== null) {
            specifiers.add(specifier);
          }
        }
        break;
      case "VariableDeclaration":
        for (const declaration of statement.declarations) {
          const specifier = getRequireSpecifier(declaration.init);
          if (specifier !== null) {
            specifiers.add(specifier);
          }
        }
        break;
      default:
        break;
    }
  }

  // Wrapped bundles place literal require calls inside an IIFE rather than at
  // Program scope. Parsing their targets here makes them available to the
  // backward slicer without treating a dynamic require as a module boundary.
  walkAst(ast, (node) => {
    const specifier = getRequireSpecifier(node);
    if (specifier !== null) {
      specifiers.add(specifier);
    }
  });

  return [...specifiers];
};

/**
 * Collect import and re-export metadata from top-level module boundaries.
 *
 * @param ast Parsed program AST.
 * @returns Boundary entries with local aliases and exported names.
 */
export const collectImports = (ast: OxcAst): ModuleBoundaryImport[] => {
  const imports: ModuleBoundaryImport[] = [];

  for (const statement of ast.body) {
    switch (statement.type) {
      case "ImportDeclaration":
        imports.push(...collectImportDeclaration(statement));
        break;
      case "ExportNamedDeclaration":
        imports.push(...collectReExportDeclaration(statement));
        break;
      case "ExportAllDeclaration":
        imports.push(collectExportAllDeclaration(statement));
        break;
      case "VariableDeclaration":
        imports.push(...collectRequireImports(statement));
        break;
      default:
        break;
    }
  }

  return imports;
};

/**
 * Collect names exported by top-level ESM and CommonJS boundary statements.
 *
 * @param ast Parsed program AST.
 * @returns Exported names with their local bindings when statically known.
 */
export const collectExports = (ast: OxcAst): ExportedBinding[] => {
  const exports: ExportedBinding[] = [];

  for (const statement of ast.body) {
    switch (statement.type) {
      case "ExportNamedDeclaration":
        exports.push(...collectDeclarationExports(statement.declaration));
        if (statement.source === null) {
          for (const specifier of statement.specifiers) {
            exports.push({
              exportedName: getModuleExportName(specifier.exported),
              localName: getModuleExportName(specifier.local),
            });
          }
        } else {
          for (const specifier of statement.specifiers) {
            exports.push({
              exportedName: getModuleExportName(specifier.exported),
              localName: getModuleExportName(specifier.local),
              source: statement.source.value,
            });
          }
        }
        break;
      case "ExportDefaultDeclaration":
        exports.push({
          exportedName: DEFAULT_EXPORT,
          localName:
            statement.declaration.type === "Identifier"
              ? statement.declaration.name
              : DEFAULT_EXPORT,
        });
        break;
      case "ExportAllDeclaration":
        exports.push({
          exportedName:
            statement.exported === null
              ? NAMESPACE_EXPORT
              : getModuleExportName(statement.exported),
          source: statement.source.value,
        });
        break;
      case "ExpressionStatement":
        exports.push(...collectCommonJsExports(statement.expression));
        break;
      default:
        break;
    }
  }

  return exports;
};
