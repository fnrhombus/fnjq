# fnjq

**jq, but it runs in your browser.**

[![npm version](https://img.shields.io/npm/v/fnjq)](https://www.npmjs.com/package/fnjq)
[![license](https://img.shields.io/npm/l/fnjq)](https://github.com/fnrhombus/fnjq/blob/main/LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/fnjq)](https://bundlephobia.com/package/fnjq)

```ts
import { jq } from "fnjq";

const data = {
  users: [
    { name: "Alice", age: 30 },
    { name: "Bob", age: 20 },
    { name: "Carol", age: 28 },
  ],
};

jq(data, '.users[] | select(.age > 25) | .name');
// => ["Alice", "Carol"]
```

## The problem

[jq](https://jqlang.github.io/jq/) is an indispensable tool for working with JSON, but it's a native binary. You can't run it in the browser, in serverless functions, or anywhere else that doesn't have a system shell.

[jq-web](https://github.com/nicedoc/jq-web) exists but is stale, ships a 1MB+ WASM blob, and doesn't support modern bundlers.

**fnjq** is a lightweight, zero-dependency jq implementation written in pure TypeScript. It covers the ~90% of jq expressions people actually use -- field access, pipes, filters, map/select/sort, object construction, arithmetic, string interpolation -- in under 50KB unminified.

## Install

```bash
npm install fnjq
```

## API

### `jq<T>(data, expression): T`

Execute a jq expression against JSON data. Returns a single result, or an array if the expression produces multiple outputs.

```ts
jq({ name: "Alice" }, ".name"); // "Alice"
jq([1, 2, 3], "map(. * 2)");   // [2, 4, 6]
```

### `compile<T>(expression): (data) => T`

Pre-compile a jq expression for repeated use against different inputs.

```ts
const getName = compile<string>(".name");
getName({ name: "Alice" }); // "Alice"
getName({ name: "Bob" });   // "Bob"
```

### `parse(expression): ASTNode`

Parse a jq expression into an AST. Useful for introspection or building tooling on top of fnjq.

### `evaluate(ast, data): unknown[]`

Evaluate a parsed AST against input data. Returns an array of all outputs (jq naturally produces multiple outputs for many expressions).

## Supported expressions

| Category | Expressions |
|---|---|
| **Access** | `.` `.foo` `.foo.bar` `.[0]` `.[-1]` `.[2:5]` `.[]` |
| **Pipe** | `.foo \| .bar` |
| **Multiple outputs** | `.a, .b` |
| **Construction** | `{ name: .foo }` `[.[] \| .name]` |
| **Filters** | `select(expr)` `map(expr)` `map_values(expr)` |
| **Sorting** | `sort` `sort_by(.f)` `group_by(.f)` `unique` `unique_by(.f)` |
| **Reduction** | `first` `last` `min` `max` `add` `any` `all` `flatten` `reverse` |
| **Introspection** | `length` `keys` `values` `type` `has("k")` `contains(x)` |
| **Entries** | `to_entries` `from_entries` `with_entries(expr)` |
| **Strings** | `ascii_downcase` `ascii_upcase` `split(s)` `join(s)` `test(re)` `startswith(s)` `endswith(s)` `ltrimstr(s)` `rtrimstr(s)` `tostring` `tonumber` |
| **Arithmetic** | `+` `-` `*` `/` `%` |
| **Comparison** | `==` `!=` `<` `>` `<=` `>=` |
| **Logic** | `and` `or` `not` |
| **Alternative** | `//` (alternative operator) |
| **Conditionals** | `if-then-else-end` |
| **Interpolation** | `"\(.name) is \(.age)"` |

## What's NOT supported

fnjq intentionally omits features that add significant complexity for rare use cases:

- Variable binding (`as $x`)
- `try-catch`
- `reduce`
- `def` (custom function definitions)
- `@base64`, `@csv`, `@html`, and other format strings
- `$ENV`, `input`, `inputs`
- Advanced string escapes beyond `\n`, `\t`, `\r`, `\\`, `\"`
- `?//` (destructuring alternative)
- `limit`, `until`, `while`, `repeat`, `label-break`

## Support

If fnjq is useful to you, consider supporting its development:

- [GitHub Sponsors](https://github.com/sponsors/fnrhombus)
- [Buy Me a Coffee](https://buymeacoffee.com/fnrhombus)

## License

MIT
