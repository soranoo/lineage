import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["typescript", "unicorn", "oxc"],
  categories: {
    correctness: "error",
  },
  settings: {
    "import/resolver": {
      typescript: true,
    },
  },
  jsPlugins: [
    {
      name: "jsdoc-js",
      specifier: "eslint-plugin-jsdoc",
    },
  ],
  rules: {
    curly: "error",

    // Disallow define function using "function" keyword
    "func-style": ["error", "expression"],

    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/consistent-type-assertions": [
      "error",
      {
        assertionStyle: "never",
      },
    ],
    "import/no-relative-parent-imports": "error",
    "@typescript-eslint/consistent-type-imports": [
      "error",
      {
        prefer: "type-imports",
        fixStyle: "separate-type-imports",
      },
    ],

    // Enforce JSDoc comments on functions/methods
    "jsdoc-js/require-jsdoc": [
      "error",
      {
        enableFixer: false,
        require: {
          FunctionDeclaration: true,
          MethodDefinition: true,
          ArrowFunctionExpression: true,
          FunctionExpression: true,
          ClassDeclaration: true,
        },
        contexts: [
          // Types and Interfaces
          "TSTypeAliasDeclaration",
          "TSInterfaceDeclaration",

          // Fields inside interfaces and type objects
          "TSPropertySignature",

          // Interface method signatures
          "TSMethodSignature",
        ],
      },
    ],
    // Enforce @param tag
    "jsdoc-js/require-param-description": [
      "error",
      {
        contexts: [
          "FunctionDeclaration",
          "MethodDefinition",
          "ArrowFunctionExpression",
          "FunctionExpression",

          // Apply to function types
          "TSMethodSignature",
          "TSPropertySignature[typeAnnotation.typeAnnotation.type='TSFunctionType']",
        ],
      },
    ],
    "jsdoc-js/require-param": [
      "error",
      {
        enableFixer: false,
        contexts: [
          "FunctionDeclaration",
          "MethodDefinition",
          "ArrowFunctionExpression",
          "FunctionExpression",

          // Apply to function types
          "TSMethodSignature",
          "TSPropertySignature[typeAnnotation.typeAnnotation.type='TSFunctionType']",
        ],
      },
    ],
    // Enforce @returns tag
    "jsdoc-js/require-returns-description": [
      "error",
      {
        contexts: [
          "FunctionDeclaration",
          "MethodDefinition",
          "ArrowFunctionExpression",
          "FunctionExpression",

          // Apply to function types
          "TSMethodSignature",
          "TSPropertySignature[typeAnnotation.typeAnnotation.type='TSFunctionType']",
        ],
      },
    ],
    "jsdoc-js/require-returns": [
      "error",
      {
        enableFixer: false,
        contexts: [
          "FunctionDeclaration",
          "MethodDefinition",
          "ArrowFunctionExpression",
          "FunctionExpression",

          // Apply to function types
          "TSMethodSignature",
          "TSPropertySignature[typeAnnotation.typeAnnotation.type='TSFunctionType']",
        ],
      },
    ],

    // Require description for the overall JSDoc comment body
    "jsdoc-js/require-description": [
      "error",
      {
        contexts: [
          "FunctionDeclaration",
          "MethodDefinition",
          "ArrowFunctionExpression",
          "FunctionExpression",

          "ClassDeclaration",
          "TSTypeAliasDeclaration",
          "TSInterfaceDeclaration",
          "TSPropertySignature",
        ],
      },
    ],

    // Ensure name match the tags
    "jsdoc-js/check-param-names": "error",
    "jsdoc-js/check-tag-names": "error",

    // No "-" between param to its description
    "jsdoc-js/require-hyphen-before-param-description": ["error", "never"],
  },
  overrides: [
    {
      files: ["**/__tests__/**/*", "**/*.test.*", "**/*.spec.*"],
      rules: {
        "jsdoc-js/require-jsdoc": "off",
      },
    },
  ],
  env: {
    builtin: true,
  },
});
