import type { CallExpression } from "@oxc-project/types";
import assertNever from "assert-never";

import type {
  AbsolutePath,
  LiteralValue,
  ModuleResolutionPlugin,
  ModuleResolutionResult,
  ModuleSpecifier,
  SourceText,
} from "@/types";

/**
 * Collect primitive literal arguments from a module-resolution call.
 *
 * @param call Call expression inspected by a plugin.
 * @returns Literal arguments in source order.
 */
export const collectLiteralArguments = (call: CallExpression): LiteralValue[] => {
  const values: LiteralValue[] = [];

  for (const argument of call.arguments) {
    switch (argument.type) {
      case "Literal": {
        switch (typeof argument.value) {
          case "string":
          case "number":
          case "boolean": {
            values.push(argument.value);
            break;
          }
          case "bigint":
          case "function":
          case "object":
          case "symbol":
          case "undefined":
            break;
          default:
            assertNever(argument.value);
        }
        continue;
      }
      case "TemplateLiteral": {
        if (argument.expressions.length === 0) {
          const [quasi] = argument.quasis;
          const cooked = quasi?.value.cooked;

          if (cooked !== null && cooked !== undefined) {
            values.push(cooked);
          }
        }
        break;
      }
    }
  }

  return values;
};

/**
 * Ask configured module-resolution plugins to recognize a call.
 *
 * @param call Call expression being resolved.
 * @param source Source text containing the call.
 * @param file Absolute path containing the call.
 * @param plugins Plugins tried in configured order.
 * @returns First plugin result, or null when none claims the call.
 */
export const tryResolveModuleCall = (
  call: CallExpression,
  source: SourceText,
  file: AbsolutePath,
  plugins: readonly ModuleResolutionPlugin[],
): ModuleResolutionResult => {
  const calleeText = source.slice(call.callee.start, call.callee.end);
  const args = collectLiteralArguments(call);

  for (const plugin of plugins) {
    const result = plugin.tryResolve({ calleeText, args, file });

    if (result !== null) {
      return result;
    }
  }

  return null;
};

/**
 * Build a stable cache key for a call expression in a file.
 *
 * @param file Absolute path containing the call.
 * @param call Call expression being cached.
 * @returns File-and-range cache key.
 */
export const moduleCallKey = (file: AbsolutePath, call: CallExpression): SourceText =>
  `${file}:${call.start}:${call.end}`;
