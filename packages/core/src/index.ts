import { parse } from "./parser.js";
import { evaluate } from "./eval.js";

export type { ASTNode } from "./parser.js";
export { parse } from "./parser.js";
export { evaluate } from "./eval.js";

/**
 * Execute a jq expression against JSON data.
 *
 * Returns the first result. If the expression produces multiple outputs,
 * only the first is returned. Use the lower-level `parse`/`evaluate` API
 * for multi-output expressions.
 *
 * @example
 * ```ts
 * jq({ name: "Alice", age: 30 }, ".name") // "Alice"
 * jq([1, 2, 3], "map(. * 2)")             // [2, 4, 6]
 * ```
 */
export function jq<T = unknown>(data: unknown, expression: string): T {
  const ast = parse(expression);
  const results = evaluate(ast, data);
  if (results.length === 0) {
    return undefined as T;
  }
  if (results.length === 1) {
    return results[0] as T;
  }
  // Multiple outputs — return as array
  return results as T;
}

/**
 * Compile a jq expression into a reusable function.
 *
 * @example
 * ```ts
 * const getName = compile<string>(".name");
 * getName({ name: "Alice" }) // "Alice"
 * getName({ name: "Bob" })   // "Bob"
 * ```
 */
export function compile<T = unknown>(expression: string): (data: unknown) => T {
  const ast = parse(expression);
  return (data: unknown): T => {
    const results = evaluate(ast, data);
    if (results.length === 0) {
      return undefined as T;
    }
    if (results.length === 1) {
      return results[0] as T;
    }
    return results as T;
  };
}
