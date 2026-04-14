import type { ASTNode } from "./parser.js";

/**
 * Evaluate a parsed jq AST against input data.
 * Returns an array of results (jq produces multiple outputs).
 */
export function evaluate(node: ASTNode, data: unknown): unknown[] {
  switch (node.type) {
    case "identity":
      return [data];

    case "literal":
      return [node.value];

    case "field": {
      if (data === null || data === undefined) return [null];
      if (typeof data === "object" && !Array.isArray(data)) {
        const obj = data as Record<string, unknown>;
        return [obj[node.name] ?? null];
      }
      return [null];
    }

    case "index": {
      if (!Array.isArray(data)) return [null];
      const idx = node.index < 0 ? data.length + node.index : node.index;
      return [data[idx] ?? null];
    }

    case "slice": {
      if (!Array.isArray(data) && typeof data !== "string") return [null];
      const arr = Array.isArray(data) ? data : [...data];
      const from = node.from ?? 0;
      const to = node.to ?? arr.length;
      return [arr.slice(from, to)];
    }

    case "iterate": {
      if (Array.isArray(data)) return data;
      if (data !== null && typeof data === "object") {
        return Object.values(data as Record<string, unknown>);
      }
      throw new Error(`Cannot iterate over ${typeof data}`);
    }

    case "pipe": {
      const leftResults = evaluate(node.left, data);
      const results: unknown[] = [];
      for (const val of leftResults) {
        results.push(...evaluate(node.right, val));
      }
      return results;
    }

    case "comma": {
      return [...evaluate(node.left, data), ...evaluate(node.right, data)];
    }

    case "object": {
      const results: unknown[] = [{}];
      for (const entry of node.entries) {
        const newResults: unknown[] = [];
        for (const partial of results) {
          const obj = partial as Record<string, unknown>;
          // Resolve key
          let keys: string[];
          if (typeof entry.key === "string") {
            keys = [entry.key];
          } else {
            keys = evaluate(entry.key, data).map((k) => String(k));
          }
          // Resolve value
          const values = evaluate(entry.value, data);
          // Cartesian product of keys and values
          for (const k of keys) {
            for (const v of values) {
              newResults.push({ ...obj, [k]: v });
            }
          }
        }
        results.length = 0;
        results.push(...newResults);
      }
      return results;
    }

    case "array": {
      if (!node.expr) return [[]];
      const results = evaluate(node.expr, data);
      return [results];
    }

    case "comparison":
      return evalComparison(node.op, node.left, node.right, data);

    case "arithmetic":
      return evalArithmetic(node.op, node.left, node.right, data);

    case "logical":
      return evalLogical(node.op, node.left, node.right, data);

    case "not": {
      return [!isTruthy(data)];
    }

    case "negate": {
      const vals = evaluate(node.expr, data);
      return vals.map((v) => -(v as number));
    }

    case "alternative": {
      const leftResults = evaluate(node.left, data);
      const filtered = leftResults.filter((v) => v !== null && v !== false);
      if (filtered.length > 0) return filtered;
      return evaluate(node.right, data);
    }

    case "if": {
      const condResults = evaluate(node.cond, data);
      const results: unknown[] = [];
      for (const condVal of condResults) {
        if (isTruthy(condVal)) {
          results.push(...evaluate(node.then, data));
        } else if (node.else) {
          results.push(...evaluate(node.else, data));
        } else {
          results.push(data);
        }
      }
      return results;
    }

    case "string_interp": {
      // Each interpolation can produce multiple outputs; take cartesian product
      let partials = [""];
      for (const part of node.parts) {
        if (typeof part === "string") {
          partials = partials.map((p) => p + part);
        } else {
          const vals = evaluate(part, data);
          const newPartials: string[] = [];
          for (const p of partials) {
            for (const v of vals) {
              newPartials.push(p + stringify(v));
            }
          }
          partials = newPartials;
        }
      }
      return partials;
    }

    case "recursive_descent": {
      return recurseAll(data);
    }

    case "builtin":
      return evalBuiltin(node.name, node.args, data);

    default:
      throw new Error(`Unknown node type: ${(node as { type: string }).type}`);
  }
}

function stringify(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function isTruthy(v: unknown): boolean {
  return v !== false && v !== null;
}

function recurseAll(data: unknown): unknown[] {
  const results: unknown[] = [data];
  if (Array.isArray(data)) {
    for (const item of data) {
      results.push(...recurseAll(item));
    }
  } else if (data !== null && typeof data === "object") {
    for (const val of Object.values(data as Record<string, unknown>)) {
      results.push(...recurseAll(val));
    }
  }
  return results;
}

function evalComparison(op: string, left: ASTNode, right: ASTNode, data: unknown): unknown[] {
  const lefts = evaluate(left, data);
  const rights = evaluate(right, data);
  const results: unknown[] = [];

  for (const l of lefts) {
    for (const r of rights) {
      switch (op) {
        case "==": results.push(deepEqual(l, r)); break;
        case "!=": results.push(!deepEqual(l, r)); break;
        case "<": results.push(compare(l, r) < 0); break;
        case ">": results.push(compare(l, r) > 0); break;
        case "<=": results.push(compare(l, r) <= 0); break;
        case ">=": results.push(compare(l, r) >= 0); break;
        default: throw new Error(`Unknown comparison operator: ${op}`);
      }
    }
  }
  return results;
}

function evalArithmetic(op: string, left: ASTNode, right: ASTNode, data: unknown): unknown[] {
  const lefts = evaluate(left, data);
  const rights = evaluate(right, data);
  const results: unknown[] = [];

  for (const l of lefts) {
    for (const r of rights) {
      switch (op) {
        case "+":
          if (typeof l === "number" && typeof r === "number") {
            results.push(l + r);
          } else if (typeof l === "string" && typeof r === "string") {
            results.push(l + r);
          } else if (Array.isArray(l) && Array.isArray(r)) {
            results.push([...l, ...r]);
          } else if (l !== null && r !== null && typeof l === "object" && typeof r === "object" && !Array.isArray(l) && !Array.isArray(r)) {
            results.push({ ...(l as Record<string, unknown>), ...(r as Record<string, unknown>) });
          } else if (l === null) {
            results.push(r);
          } else if (r === null) {
            results.push(l);
          } else {
            results.push((l as number) + (r as number));
          }
          break;
        case "-": results.push((l as number) - (r as number)); break;
        case "*": results.push((l as number) * (r as number)); break;
        case "/": results.push((l as number) / (r as number)); break;
        case "%": results.push((l as number) % (r as number)); break;
        default: throw new Error(`Unknown arithmetic operator: ${op}`);
      }
    }
  }
  return results;
}

function evalLogical(op: string, left: ASTNode, right: ASTNode, data: unknown): unknown[] {
  const lefts = evaluate(left, data);
  const results: unknown[] = [];

  for (const l of lefts) {
    switch (op) {
      case "and": {
        if (!isTruthy(l)) {
          results.push(l);
        } else {
          results.push(...evaluate(right, data));
        }
        break;
      }
      case "or": {
        if (isTruthy(l)) {
          results.push(l);
        } else {
          results.push(...evaluate(right, data));
        }
        break;
      }
      default:
        throw new Error(`Unknown logical operator: ${op}`);
    }
  }
  return results;
}

function evalBuiltin(name: string, args: ASTNode[], data: unknown): unknown[] {
  switch (name) {
    case "length": {
      if (data === null) return [0];
      if (typeof data === "string") return [data.length];
      if (Array.isArray(data)) return [data.length];
      if (typeof data === "object") return [Object.keys(data as Record<string, unknown>).length];
      if (typeof data === "number") return [Math.abs(data)];
      return [0];
    }

    case "keys": {
      if (Array.isArray(data)) {
        return [data.map((_, i) => i)];
      }
      if (data !== null && typeof data === "object") {
        return [Object.keys(data as Record<string, unknown>).sort()];
      }
      throw new Error(`Cannot get keys of ${typeof data}`);
    }

    case "values": {
      if (Array.isArray(data)) return [data];
      if (data !== null && typeof data === "object") {
        return [Object.values(data as Record<string, unknown>)];
      }
      throw new Error(`Cannot get values of ${typeof data}`);
    }

    case "type": {
      if (data === null) return ["null"];
      if (Array.isArray(data)) return ["array"];
      if (typeof data === "number") return ["number"];
      if (typeof data === "string") return ["string"];
      if (typeof data === "boolean") return ["boolean"];
      if (typeof data === "object") return ["object"];
      return [typeof data];
    }

    case "select": {
      if (args.length === 0) throw new Error("select requires an argument");
      const results = evaluate(args[0], data);
      for (const r of results) {
        if (isTruthy(r)) return [data];
      }
      return [];
    }

    case "map": {
      if (!Array.isArray(data)) throw new Error("map requires array input");
      if (args.length === 0) throw new Error("map requires an argument");
      const result: unknown[] = [];
      for (const item of data) {
        result.push(...evaluate(args[0], item));
      }
      return [result];
    }

    case "map_values": {
      if (args.length === 0) throw new Error("map_values requires an argument");
      if (Array.isArray(data)) {
        const result: unknown[] = [];
        for (const item of data) {
          const mapped = evaluate(args[0], item);
          result.push(mapped[0]);
        }
        return [result];
      }
      if (data !== null && typeof data === "object") {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
          const mapped = evaluate(args[0], v);
          result[k] = mapped[0];
        }
        return [result];
      }
      throw new Error("map_values requires array or object input");
    }

    case "sort": {
      if (!Array.isArray(data)) throw new Error("sort requires array input");
      return [[...data].sort(compare)];
    }

    case "sort_by": {
      if (!Array.isArray(data)) throw new Error("sort_by requires array input");
      if (args.length === 0) throw new Error("sort_by requires an argument");
      return [[...data].sort((a, b) => {
        const aKey = evaluate(args[0], a)[0];
        const bKey = evaluate(args[0], b)[0];
        return compare(aKey, bKey);
      })];
    }

    case "group_by": {
      if (!Array.isArray(data)) throw new Error("group_by requires array input");
      if (args.length === 0) throw new Error("group_by requires an argument");
      const groups = new Map<string, unknown[]>();
      const keyOrder: string[] = [];
      for (const item of data) {
        const key = JSON.stringify(evaluate(args[0], item)[0]);
        if (!groups.has(key)) {
          groups.set(key, []);
          keyOrder.push(key);
        }
        groups.get(key)!.push(item);
      }
      // Sort groups by their key
      keyOrder.sort();
      return [keyOrder.map((k) => groups.get(k)!)];
    }

    case "unique": {
      if (!Array.isArray(data)) throw new Error("unique requires array input");
      if (args.length > 0) {
        // unique(expr) — same as unique_by
        return evalBuiltin("unique_by", args, data);
      }
      const seen = new Set<string>();
      const result: unknown[] = [];
      for (const item of [...data].sort(compare)) {
        const key = JSON.stringify(item);
        if (!seen.has(key)) {
          seen.add(key);
          result.push(item);
        }
      }
      return [result];
    }

    case "unique_by": {
      if (!Array.isArray(data)) throw new Error("unique_by requires array input");
      if (args.length === 0) throw new Error("unique_by requires an argument");
      const seen = new Set<string>();
      const result: unknown[] = [];
      const sorted = [...data].sort((a, b) => {
        const aKey = evaluate(args[0], a)[0];
        const bKey = evaluate(args[0], b)[0];
        return compare(aKey, bKey);
      });
      for (const item of sorted) {
        const key = JSON.stringify(evaluate(args[0], item)[0]);
        if (!seen.has(key)) {
          seen.add(key);
          result.push(item);
        }
      }
      return [result];
    }

    case "flatten": {
      if (!Array.isArray(data)) throw new Error("flatten requires array input");
      const depth = args.length > 0 ? (evaluate(args[0], data)[0] as number) : Infinity;
      return [flattenArray(data, depth)];
    }

    case "first": {
      if (args.length > 0) {
        const results = evaluate(args[0], data);
        return results.length > 0 ? [results[0]] : [];
      }
      if (Array.isArray(data) && data.length > 0) return [data[0]];
      return [null];
    }

    case "last": {
      if (args.length > 0) {
        const results = evaluate(args[0], data);
        return results.length > 0 ? [results[results.length - 1]] : [];
      }
      if (Array.isArray(data) && data.length > 0) return [data[data.length - 1]];
      return [null];
    }

    case "reverse": {
      if (Array.isArray(data)) return [[...data].reverse()];
      if (typeof data === "string") return [[...data].reverse().join("")];
      throw new Error("reverse requires array or string");
    }

    case "min": {
      if (!Array.isArray(data) || data.length === 0) return [null];
      return [data.reduce((a, b) => (compare(a, b) <= 0 ? a : b))];
    }

    case "max": {
      if (!Array.isArray(data) || data.length === 0) return [null];
      return [data.reduce((a, b) => (compare(a, b) >= 0 ? a : b))];
    }

    case "min_by": {
      if (!Array.isArray(data) || data.length === 0) return [null];
      if (args.length === 0) throw new Error("min_by requires an argument");
      return [data.reduce((a, b) => {
        const aKey = evaluate(args[0], a)[0];
        const bKey = evaluate(args[0], b)[0];
        return compare(aKey, bKey) <= 0 ? a : b;
      })];
    }

    case "max_by": {
      if (!Array.isArray(data) || data.length === 0) return [null];
      if (args.length === 0) throw new Error("max_by requires an argument");
      return [data.reduce((a, b) => {
        const aKey = evaluate(args[0], a)[0];
        const bKey = evaluate(args[0], b)[0];
        return compare(aKey, bKey) >= 0 ? a : b;
      })];
    }

    case "add": {
      if (!Array.isArray(data) || data.length === 0) return [null];
      return [data.reduce((acc, item) => {
        if (acc === null) return item;
        if (typeof acc === "number" && typeof item === "number") return acc + item;
        if (typeof acc === "string" && typeof item === "string") return acc + item;
        if (Array.isArray(acc) && Array.isArray(item)) return [...acc, ...item];
        if (typeof acc === "object" && typeof item === "object") {
          return { ...(acc as Record<string, unknown>), ...(item as Record<string, unknown>) };
        }
        return acc;
      })];
    }

    case "any": {
      if (!Array.isArray(data)) throw new Error("any requires array input");
      if (args.length > 0) {
        return [data.some((item) => {
          const results = evaluate(args[0], item);
          return results.some(isTruthy);
        })];
      }
      return [data.some(isTruthy)];
    }

    case "all": {
      if (!Array.isArray(data)) throw new Error("all requires array input");
      if (args.length > 0) {
        return [data.every((item) => {
          const results = evaluate(args[0], item);
          return results.some(isTruthy);
        })];
      }
      return [data.every(isTruthy)];
    }

    case "has": {
      if (args.length === 0) throw new Error("has requires an argument");
      const key = evaluate(args[0], data)[0];
      if (Array.isArray(data)) {
        return [typeof key === "number" && key >= 0 && key < data.length];
      }
      if (data !== null && typeof data === "object") {
        return [Object.prototype.hasOwnProperty.call(data, String(key))];
      }
      return [false];
    }

    case "contains": {
      if (args.length === 0) throw new Error("contains requires an argument");
      const other = evaluate(args[0], data)[0];
      return [containsValue(data, other)];
    }

    case "inside": {
      if (args.length === 0) throw new Error("inside requires an argument");
      const other = evaluate(args[0], data)[0];
      return [containsValue(other, data)];
    }

    case "to_entries": {
      if (data === null || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("to_entries requires object input");
      }
      return [Object.entries(data as Record<string, unknown>).map(([key, value]) => ({ key, value }))];
    }

    case "from_entries": {
      if (!Array.isArray(data)) throw new Error("from_entries requires array input");
      const result: Record<string, unknown> = {};
      for (const entry of data) {
        if (entry !== null && typeof entry === "object") {
          const e = entry as Record<string, unknown>;
          const key = String(e.key ?? e.name ?? "");
          result[key] = e.value;
        }
      }
      return [result];
    }

    case "with_entries": {
      if (args.length === 0) throw new Error("with_entries requires an argument");
      const entries = Object.entries(data as Record<string, unknown>).map(([key, value]) => ({ key, value }));
      const mapped: unknown[] = [];
      for (const entry of entries) {
        mapped.push(...evaluate(args[0], entry));
      }
      const result: Record<string, unknown> = {};
      for (const entry of mapped) {
        if (entry !== null && typeof entry === "object") {
          const e = entry as Record<string, unknown>;
          result[String(e.key)] = e.value;
        }
      }
      return [result];
    }

    case "tostring": {
      if (typeof data === "string") return [data];
      return [JSON.stringify(data)];
    }

    case "tonumber": {
      if (typeof data === "number") return [data];
      if (typeof data === "string") return [Number(data)];
      throw new Error(`Cannot convert ${typeof data} to number`);
    }

    case "ascii_downcase": {
      if (typeof data !== "string") throw new Error("ascii_downcase requires string");
      return [data.toLowerCase()];
    }

    case "ascii_upcase": {
      if (typeof data !== "string") throw new Error("ascii_upcase requires string");
      return [data.toUpperCase()];
    }

    case "ltrimstr": {
      if (typeof data !== "string") throw new Error("ltrimstr requires string");
      if (args.length === 0) throw new Error("ltrimstr requires an argument");
      const prefix = String(evaluate(args[0], data)[0]);
      return [data.startsWith(prefix) ? data.slice(prefix.length) : data];
    }

    case "rtrimstr": {
      if (typeof data !== "string") throw new Error("rtrimstr requires string");
      if (args.length === 0) throw new Error("rtrimstr requires an argument");
      const suffix = String(evaluate(args[0], data)[0]);
      return [data.endsWith(suffix) ? data.slice(0, -suffix.length) : data];
    }

    case "startswith": {
      if (typeof data !== "string") throw new Error("startswith requires string");
      if (args.length === 0) throw new Error("startswith requires an argument");
      return [data.startsWith(String(evaluate(args[0], data)[0]))];
    }

    case "endswith": {
      if (typeof data !== "string") throw new Error("endswith requires string");
      if (args.length === 0) throw new Error("endswith requires an argument");
      return [data.endsWith(String(evaluate(args[0], data)[0]))];
    }

    case "split": {
      if (typeof data !== "string") throw new Error("split requires string");
      if (args.length === 0) throw new Error("split requires an argument");
      return [data.split(String(evaluate(args[0], data)[0]))];
    }

    case "join": {
      if (!Array.isArray(data)) throw new Error("join requires array");
      if (args.length === 0) throw new Error("join requires an argument");
      return [data.map((x) => (x === null ? "" : String(x))).join(String(evaluate(args[0], data)[0]))];
    }

    case "test": {
      if (typeof data !== "string") throw new Error("test requires string");
      if (args.length === 0) throw new Error("test requires an argument");
      const pattern = String(evaluate(args[0], data)[0]);
      return [new RegExp(pattern).test(data)];
    }

    case "match": {
      if (typeof data !== "string") throw new Error("match requires string");
      if (args.length === 0) throw new Error("match requires an argument");
      const pattern = String(evaluate(args[0], data)[0]);
      const m = data.match(new RegExp(pattern));
      if (!m) return [null];
      return [{ offset: m.index, length: m[0].length, string: m[0], captures: (m.slice(1) || []).map((c, i) => ({ offset: data.indexOf(c), length: c?.length ?? 0, string: c, name: null })) }];
    }

    case "range": {
      if (args.length === 1) {
        const end = evaluate(args[0], data)[0] as number;
        const results: number[] = [];
        for (let j = 0; j < end; j++) results.push(j);
        return results;
      }
      if (args.length >= 2) {
        const start = evaluate(args[0], data)[0] as number;
        const end = evaluate(args[1], data)[0] as number;
        const step = args.length > 2 ? (evaluate(args[2], data)[0] as number) : 1;
        const results: number[] = [];
        for (let j = start; step > 0 ? j < end : j > end; j += step) results.push(j);
        return results;
      }
      return [];
    }

    case "floor": return [Math.floor(data as number)];
    case "ceil": return [Math.ceil(data as number)];
    case "round": return [Math.round(data as number)];
    case "sqrt": return [Math.sqrt(data as number)];
    case "fabs": return [Math.abs(data as number)];

    case "tojson": return [JSON.stringify(data)];
    case "fromjson": return [JSON.parse(data as string)];

    case "empty": return [];

    case "not": return [!isTruthy(data)];

    case "del": {
      if (args.length === 0) throw new Error("del requires an argument");
      // Only handle field deletion
      if (Array.isArray(data)) {
        const indices = evaluate(args[0], data)
          .filter((v): v is number => typeof v === "number")
          .sort((a, b) => b - a);
        const result = [...data];
        for (const idx of indices) result.splice(idx, 1);
        return [result];
      }
      if (data !== null && typeof data === "object") {
        const result = { ...(data as Record<string, unknown>) };
        // Try to figure out what fields to delete
        const arg = args[0];
        if (arg.type === "field") {
          delete result[arg.name];
        }
        return [result];
      }
      return [data];
    }

    case "indices":
    case "index": {
      if (args.length === 0) throw new Error(`${name} requires an argument`);
      const target = evaluate(args[0], data)[0];
      if (typeof data === "string" && typeof target === "string") {
        if (name === "indices") {
          const indices: number[] = [];
          let idx = data.indexOf(target);
          while (idx !== -1) {
            indices.push(idx);
            idx = data.indexOf(target, idx + 1);
          }
          return [indices];
        }
        return [data.indexOf(target) === -1 ? null : data.indexOf(target)];
      }
      if (Array.isArray(data)) {
        if (name === "indices") {
          const indices: number[] = [];
          for (let j = 0; j < data.length; j++) {
            if (deepEqual(data[j], target)) indices.push(j);
          }
          return [indices];
        }
        const idx = data.findIndex((item) => deepEqual(item, target));
        return [idx === -1 ? null : idx];
      }
      return [null];
    }

    case "rindex": {
      if (args.length === 0) throw new Error("rindex requires an argument");
      const target = evaluate(args[0], data)[0];
      if (typeof data === "string" && typeof target === "string") {
        const idx = data.lastIndexOf(target);
        return [idx === -1 ? null : idx];
      }
      if (Array.isArray(data)) {
        for (let j = data.length - 1; j >= 0; j--) {
          if (deepEqual(data[j], target)) return [j];
        }
        return [null];
      }
      return [null];
    }

    case "paths": {
      return [allPaths(data)];
    }

    case "leaf_paths": {
      return [allPaths(data).filter((p) => {
        const v = getPath(data, p);
        return v === null || typeof v !== "object";
      })];
    }

    case "getpath": {
      if (args.length === 0) throw new Error("getpath requires an argument");
      const path = evaluate(args[0], data)[0] as Array<string | number>;
      return [getPath(data, path)];
    }

    case "setpath": {
      if (args.length < 2) throw new Error("setpath requires two arguments");
      const path = evaluate(args[0], data)[0] as Array<string | number>;
      const value = evaluate(args[1], data)[0];
      return [setPath(data, path, value)];
    }

    case "path": {
      if (args.length === 0) throw new Error("path requires an argument");
      // Limited: only supports simple field paths
      const arg = args[0];
      const paths = extractPaths(arg);
      return paths.map((p) => p);
    }

    case "recurse": {
      return recurseAll(data);
    }

    case "error": {
      const msg = args.length > 0 ? String(evaluate(args[0], data)[0]) : String(data);
      throw new Error(msg);
    }

    case "debug": {
      // In jq, debug prints to stderr. We'll just return the data unchanged.
      return [data];
    }

    case "input":
    case "inputs":
      // These are stream operations — not applicable in our context
      return [null];

    case "_index_expr": {
      // Dynamic indexing with an expression
      if (args.length === 0) return [null];
      const key = evaluate(args[0], data)[0];
      if (typeof key === "number" && Array.isArray(data)) {
        const idx = key < 0 ? data.length + key : key;
        return [data[idx] ?? null];
      }
      if (typeof key === "string" && data !== null && typeof data === "object" && !Array.isArray(data)) {
        return [(data as Record<string, unknown>)[key] ?? null];
      }
      return [null];
    }

    default:
      throw new Error(`Unknown builtin: ${name}`);
  }
}

function flattenArray(arr: unknown[], depth: number): unknown[] {
  if (depth <= 0) return arr;
  const result: unknown[] = [];
  for (const item of arr) {
    if (Array.isArray(item)) {
      result.push(...flattenArray(item, depth - 1));
    } else {
      result.push(item);
    }
  }
  return result;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (typeof a === "string" && typeof b === "string") return a === b;
  if (typeof a === "boolean" && typeof b === "boolean") return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj).sort();
    const bKeys = Object.keys(bObj).sort();
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((k, i) => k === bKeys[i] && deepEqual(aObj[k], bObj[k]));
  }
  return false;
}

function compare(a: unknown, b: unknown): number {
  // jq ordering: null < false < true < numbers < strings < arrays < objects
  const typeOrder = (v: unknown): number => {
    if (v === null) return 0;
    if (v === false) return 1;
    if (v === true) return 2;
    if (typeof v === "number") return 3;
    if (typeof v === "string") return 4;
    if (Array.isArray(v)) return 5;
    if (typeof v === "object") return 6;
    return 7;
  };

  const ta = typeOrder(a);
  const tb = typeOrder(b);
  if (ta !== tb) return ta - tb;

  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  if (Array.isArray(a) && Array.isArray(b)) {
    const minLen = Math.min(a.length, b.length);
    for (let i = 0; i < minLen; i++) {
      const c = compare(a[i], b[i]);
      if (c !== 0) return c;
    }
    return a.length - b.length;
  }
  if (typeof a === "object" && typeof b === "object" && a !== null && b !== null) {
    const aEntries = Object.entries(a as Record<string, unknown>).sort(([k1], [k2]) => k1 < k2 ? -1 : k1 > k2 ? 1 : 0);
    const bEntries = Object.entries(b as Record<string, unknown>).sort(([k1], [k2]) => k1 < k2 ? -1 : k1 > k2 ? 1 : 0);
    const minLen = Math.min(aEntries.length, bEntries.length);
    for (let i = 0; i < minLen; i++) {
      const kc = aEntries[i][0] < bEntries[i][0] ? -1 : aEntries[i][0] > bEntries[i][0] ? 1 : 0;
      if (kc !== 0) return kc;
      const vc = compare(aEntries[i][1], bEntries[i][1]);
      if (vc !== 0) return vc;
    }
    return aEntries.length - bEntries.length;
  }
  return 0;
}

function containsValue(a: unknown, b: unknown): boolean {
  if (deepEqual(a, b)) return true;
  if (typeof a === "string" && typeof b === "string") return a.includes(b);
  if (Array.isArray(a) && Array.isArray(b)) {
    return b.every((bItem) => a.some((aItem) => containsValue(aItem, bItem)));
  }
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    return Object.keys(bObj).every((k) => k in aObj && containsValue(aObj[k], bObj[k]));
  }
  return false;
}

function allPaths(data: unknown, prefix: Array<string | number> = []): Array<Array<string | number>> {
  const result: Array<Array<string | number>> = [prefix];
  if (Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) {
      result.push(...allPaths(data[i], [...prefix, i]));
    }
  } else if (data !== null && typeof data === "object") {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      result.push(...allPaths(v, [...prefix, k]));
    }
  }
  return result;
}

function getPath(data: unknown, path: Array<string | number>): unknown {
  let current: unknown = data;
  for (const key of path) {
    if (current === null || current === undefined) return null;
    if (Array.isArray(current) && typeof key === "number") {
      current = current[key];
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[String(key)];
    } else {
      return null;
    }
  }
  return current ?? null;
}

function setPath(data: unknown, path: Array<string | number>, value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (typeof head === "number") {
    const arr = Array.isArray(data) ? [...data] : [];
    while (arr.length <= head) arr.push(null);
    arr[head] = setPath(arr[head], rest, value);
    return arr;
  }
  const obj = (data !== null && typeof data === "object" && !Array.isArray(data))
    ? { ...(data as Record<string, unknown>) }
    : {};
  obj[String(head)] = setPath(obj[String(head)] ?? null, rest, value);
  return obj;
}

function extractPaths(node: ASTNode): Array<Array<string | number>> {
  switch (node.type) {
    case "field": return [[node.name]];
    case "index": return [[node.index]];
    case "pipe": {
      const lefts = extractPaths(node.left);
      const rights = extractPaths(node.right);
      return lefts.flatMap((l) => rights.map((r) => [...l, ...r]));
    }
    case "identity": return [[]];
    default: return [[]];
  }
}
