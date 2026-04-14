import { describe, it, expect } from "vitest";
import { jq, compile, parse, evaluate } from "fnjq";

describe("jq", () => {
  describe("identity and field access", () => {
    it("returns identity", () => {
      expect(jq({ a: 1 }, ".")).toEqual({ a: 1 });
    });

    it("accesses a field", () => {
      expect(jq({ name: "Alice" }, ".name")).toBe("Alice");
    });

    it("accesses nested fields", () => {
      expect(jq({ a: { b: { c: 42 } } }, ".a.b.c")).toBe(42);
    });

    it("returns null for missing fields", () => {
      expect(jq({ a: 1 }, ".b")).toBe(null);
    });

    it("returns null for field access on null", () => {
      expect(jq(null, ".foo")).toBe(null);
    });
  });

  describe("array iteration and indexing", () => {
    it("iterates array elements", () => {
      expect(jq([1, 2, 3], ".[]")).toEqual([1, 2, 3]);
    });

    it("indexes into an array", () => {
      expect(jq([10, 20, 30], ".[1]")).toBe(20);
    });

    it("supports negative indexing", () => {
      expect(jq([10, 20, 30], ".[-1]")).toBe(30);
    });

    it("slices an array", () => {
      expect(jq([0, 1, 2, 3, 4], ".[2:5]")).toEqual([2, 3, 4]);
    });

    it("slices from start", () => {
      expect(jq([0, 1, 2, 3, 4], ".[:3]")).toEqual([0, 1, 2]);
    });

    it("iterates object values", () => {
      const result = jq({ a: 1, b: 2 }, ".[]");
      expect(result).toEqual([1, 2]);
    });

    it("returns null for out-of-bounds index", () => {
      expect(jq([1, 2], ".[5]")).toBe(null);
    });

    it("handles empty array iteration", () => {
      expect(jq([], ".[]")).toEqual(undefined);
    });
  });

  describe("pipe", () => {
    it("pipes field access", () => {
      expect(jq({ a: { b: 1 } }, ".a | .b")).toBe(1);
    });

    it("pipes through iteration", () => {
      expect(jq({ items: [1, 2, 3] }, ".items | .[]")).toEqual([1, 2, 3]);
    });

    it("chains multiple pipes", () => {
      expect(jq({ a: { b: [10, 20] } }, ".a | .b | .[0]")).toBe(10);
    });
  });

  describe("select", () => {
    it("filters by predicate", () => {
      expect(jq([1, 2, 3, 4, 5], "[.[] | select(. > 3)]")).toEqual([4, 5]);
    });

    it("selects with field comparison", () => {
      const data = [
        { name: "Alice", age: 30 },
        { name: "Bob", age: 20 },
        { name: "Carol", age: 25 },
      ];
      expect(jq(data, "[.[] | select(.age >= 25)]")).toEqual([
        { name: "Alice", age: 30 },
        { name: "Carol", age: 25 },
      ]);
    });

    it("selects with equality", () => {
      const data = [{ type: "a" }, { type: "b" }, { type: "a" }];
      expect(jq(data, '[.[] | select(.type == "a")]')).toEqual([
        { type: "a" },
        { type: "a" },
      ]);
    });
  });

  describe("map", () => {
    it("maps over array", () => {
      expect(jq([1, 2, 3], "map(. * 2)")).toEqual([2, 4, 6]);
    });

    it("maps with field access", () => {
      const data = [{ name: "Alice" }, { name: "Bob" }];
      expect(jq(data, "map(.name)")).toEqual(["Alice", "Bob"]);
    });
  });

  describe("sort_by", () => {
    it("sorts by field", () => {
      const data = [
        { name: "Charlie", age: 25 },
        { name: "Alice", age: 30 },
        { name: "Bob", age: 20 },
      ];
      expect(jq(data, "sort_by(.age)")).toEqual([
        { name: "Bob", age: 20 },
        { name: "Charlie", age: 25 },
        { name: "Alice", age: 30 },
      ]);
    });

    it("sorts by string field", () => {
      const data = [{ n: "c" }, { n: "a" }, { n: "b" }];
      expect(jq(data, "sort_by(.n)")).toEqual([{ n: "a" }, { n: "b" }, { n: "c" }]);
    });
  });

  describe("group_by", () => {
    it("groups by field", () => {
      const data = [
        { type: "a", val: 1 },
        { type: "b", val: 2 },
        { type: "a", val: 3 },
      ];
      expect(jq(data, "group_by(.type)")).toEqual([
        [{ type: "a", val: 1 }, { type: "a", val: 3 }],
        [{ type: "b", val: 2 }],
      ]);
    });
  });

  describe("unique", () => {
    it("deduplicates values", () => {
      expect(jq([1, 2, 1, 3, 2], "unique")).toEqual([1, 2, 3]);
    });

    it("unique_by field", () => {
      const data = [
        { name: "Alice", dept: "eng" },
        { name: "Bob", dept: "eng" },
        { name: "Carol", dept: "sales" },
      ];
      const result = jq<Array<{ name: string; dept: string }>>(data, "unique_by(.dept)");
      expect(result).toHaveLength(2);
      expect(result.map((x) => x.dept).sort()).toEqual(["eng", "sales"]);
    });
  });

  describe("object construction", () => {
    it("constructs an object with literal keys", () => {
      expect(jq({ first: "Alice", last: "Smith" }, "{ name: .first, surname: .last }")).toEqual({
        name: "Alice",
        surname: "Smith",
      });
    });

    it("constructs with shorthand", () => {
      expect(jq({ name: "Alice", age: 30 }, "{ name, age }")).toEqual({
        name: "Alice",
        age: 30,
      });
    });
  });

  describe("array construction", () => {
    it("collects iterated values", () => {
      expect(jq({ a: 1, b: 2, c: 3 }, "[.[] | . * 2]")).toEqual([2, 4, 6]);
    });

    it("constructs array from fields", () => {
      const data = [{ name: "Alice" }, { name: "Bob" }];
      expect(jq(data, "[.[] | .name]")).toEqual(["Alice", "Bob"]);
    });
  });

  describe("arithmetic", () => {
    it("adds numbers", () => {
      expect(jq(null, "1 + 2")).toBe(3);
    });

    it("subtracts", () => {
      expect(jq(null, "10 - 3")).toBe(7);
    });

    it("multiplies", () => {
      expect(jq(null, "4 * 5")).toBe(20);
    });

    it("divides", () => {
      expect(jq(null, "10 / 4")).toBe(2.5);
    });

    it("modulo", () => {
      expect(jq(null, "17 % 5")).toBe(2);
    });

    it("adds fields", () => {
      expect(jq({ a: 10, b: 20 }, ".a + .b")).toBe(30);
    });

    it("concatenates strings with +", () => {
      expect(jq({ first: "hello", last: "world" }, ".first + .last")).toBe("helloworld");
    });

    it("concatenates arrays with +", () => {
      expect(jq(null, "[1, 2] + [3, 4]")).toEqual([1, 2, 3, 4]);
    });
  });

  describe("comparison", () => {
    it("equals", () => {
      expect(jq(null, "1 == 1")).toBe(true);
      expect(jq(null, "1 == 2")).toBe(false);
    });

    it("not equals", () => {
      expect(jq(null, "1 != 2")).toBe(true);
    });

    it("less than", () => {
      expect(jq(null, "1 < 2")).toBe(true);
      expect(jq(null, "2 < 1")).toBe(false);
    });

    it("greater than", () => {
      expect(jq(null, "2 > 1")).toBe(true);
    });

    it("less or equal", () => {
      expect(jq(null, "2 <= 2")).toBe(true);
      expect(jq(null, "3 <= 2")).toBe(false);
    });

    it("greater or equal", () => {
      expect(jq(null, "2 >= 2")).toBe(true);
    });

    it("compares strings", () => {
      expect(jq(null, '"a" < "b"')).toBe(true);
    });
  });

  describe("logical operators", () => {
    it("and", () => {
      expect(jq(null, "true and true")).toBe(true);
      expect(jq(null, "true and false")).toBe(false);
      expect(jq(null, "false and true")).toBe(false);
    });

    it("or", () => {
      expect(jq(null, "false or true")).toBe(true);
      expect(jq(null, "false or false")).toBe(false);
      expect(jq(null, "true or false")).toBe(true);
    });

    it("not", () => {
      expect(jq(true, "not")).toBe(false);
      expect(jq(false, "not")).toBe(true);
      expect(jq(null, "null | not")).toBe(true);
    });
  });

  describe("alternative operator //", () => {
    it("returns left when non-null", () => {
      expect(jq({ a: 1 }, ".a // 42")).toBe(1);
    });

    it("returns right when left is null", () => {
      expect(jq({ a: null }, ".a // 42")).toBe(42);
    });

    it("returns right when left is false", () => {
      expect(jq({ a: false }, ".a // 42")).toBe(42);
    });

    it("returns right for missing field", () => {
      expect(jq({}, ".missing // 0")).toBe(0);
    });
  });

  describe("if-then-else", () => {
    it("evaluates then branch", () => {
      expect(jq(5, "if . > 3 then . * 2 else . end")).toBe(10);
    });

    it("evaluates else branch", () => {
      expect(jq(1, "if . > 3 then . * 2 else . end")).toBe(1);
    });

    it("works without else", () => {
      expect(jq(5, "if . > 3 then . * 2 end")).toBe(10);
    });
  });

  describe("string interpolation", () => {
    it("interpolates a field", () => {
      expect(jq({ name: "Alice" }, '"Hello, \\(.name)!"')).toBe("Hello, Alice!");
    });

    it("interpolates an expression", () => {
      expect(jq({ a: 1, b: 2 }, '"sum: \\(.a + .b)"')).toBe("sum: 3");
    });
  });

  describe("builtins", () => {
    it("length of array", () => {
      expect(jq([1, 2, 3], "length")).toBe(3);
    });

    it("length of string", () => {
      expect(jq("hello", "length")).toBe(5);
    });

    it("length of object", () => {
      expect(jq({ a: 1, b: 2 }, "length")).toBe(2);
    });

    it("length of null", () => {
      expect(jq(null, "length")).toBe(0);
    });

    it("keys of object", () => {
      expect(jq({ b: 2, a: 1 }, "keys")).toEqual(["a", "b"]);
    });

    it("values of object", () => {
      const result = jq({ a: 1, b: 2 }, "values");
      expect(result).toEqual([1, 2]);
    });

    it("type detection", () => {
      expect(jq(null, "type")).toBe("null");
      expect(jq(42, "type")).toBe("number");
      expect(jq("hi", "type")).toBe("string");
      expect(jq(true, "type")).toBe("boolean");
      expect(jq([], "type")).toBe("array");
      expect(jq({}, "type")).toBe("object");
    });

    it("sort", () => {
      expect(jq([3, 1, 2], "sort")).toEqual([1, 2, 3]);
    });

    it("flatten", () => {
      expect(jq([[1, 2], [3, [4]]], "flatten")).toEqual([1, 2, 3, 4]);
    });

    it("flatten with depth", () => {
      expect(jq([[1, [2]], [3, [4]]], "flatten(1)")).toEqual([1, [2], 3, [4]]);
    });

    it("first and last", () => {
      expect(jq([10, 20, 30], "first")).toBe(10);
      expect(jq([10, 20, 30], "last")).toBe(30);
    });

    it("add", () => {
      expect(jq([1, 2, 3], "add")).toBe(6);
    });

    it("reverse", () => {
      expect(jq([1, 2, 3], "reverse")).toEqual([3, 2, 1]);
    });

    it("min and max", () => {
      expect(jq([3, 1, 2], "min")).toBe(1);
      expect(jq([3, 1, 2], "max")).toBe(3);
    });

    it("has", () => {
      expect(jq({ a: 1 }, 'has("a")')).toBe(true);
      expect(jq({ a: 1 }, 'has("b")')).toBe(false);
    });

    it("contains", () => {
      expect(jq([1, 2, 3], "contains([2, 3])")).toBe(true);
      expect(jq([1, 2, 3], "contains([4])")).toBe(false);
    });

    it("tostring", () => {
      expect(jq(42, "tostring")).toBe("42");
    });

    it("tonumber", () => {
      expect(jq("42", "tonumber")).toBe(42);
    });

    it("any and all", () => {
      expect(jq([true, false], "any")).toBe(true);
      expect(jq([true, true], "all")).toBe(true);
      expect(jq([true, false], "all")).toBe(false);
    });

    it("to_entries and from_entries", () => {
      const obj = { a: 1, b: 2 };
      expect(jq(obj, "to_entries")).toEqual([
        { key: "a", value: 1 },
        { key: "b", value: 2 },
      ]);
      expect(jq([{ key: "a", value: 1 }], "from_entries")).toEqual({ a: 1 });
    });

    it("ascii_downcase and ascii_upcase", () => {
      expect(jq("Hello", "ascii_downcase")).toBe("hello");
      expect(jq("Hello", "ascii_upcase")).toBe("HELLO");
    });

    it("split and join", () => {
      expect(jq("a,b,c", 'split(",")')).toEqual(["a", "b", "c"]);
      expect(jq(["a", "b", "c"], 'join(",")')).toBe("a,b,c");
    });

    it("startswith and endswith", () => {
      expect(jq("hello world", 'startswith("hello")')).toBe(true);
      expect(jq("hello world", 'endswith("world")')).toBe(true);
    });

    it("test (regex)", () => {
      expect(jq("foobar", 'test("foo")')).toBe(true);
      expect(jq("foobar", 'test("^bar")')).toBe(false);
    });
  });

  describe("compile()", () => {
    it("creates a reusable function", () => {
      const getName = compile<string>(".name");
      expect(getName({ name: "Alice" })).toBe("Alice");
      expect(getName({ name: "Bob" })).toBe("Bob");
    });

    it("compiled function preserves complex expression", () => {
      const transform = compile<string[]>("[.[] | select(.active) | .name]");
      const data1 = [
        { name: "Alice", active: true },
        { name: "Bob", active: false },
      ];
      const data2 = [
        { name: "Carol", active: true },
        { name: "Dave", active: true },
      ];
      expect(transform(data1)).toEqual(["Alice"]);
      expect(transform(data2)).toEqual(["Carol", "Dave"]);
    });
  });

  describe("edge cases", () => {
    it("handles null input", () => {
      expect(jq(null, ".")).toBe(null);
    });

    it("handles missing nested fields", () => {
      expect(jq({}, ".a.b.c")).toBe(null);
    });

    it("handles empty array", () => {
      expect(jq([], "length")).toBe(0);
    });

    it("handles empty object", () => {
      expect(jq({}, "keys")).toEqual([]);
    });

    it("map on empty array", () => {
      expect(jq([], "map(. + 1)")).toEqual([]);
    });

    it("sort empty array", () => {
      expect(jq([], "sort")).toEqual([]);
    });

    it("select filtering out everything", () => {
      expect(jq([1, 2, 3], "[.[] | select(. > 10)]")).toEqual([]);
    });

    it("deeply nested access", () => {
      const data = { a: { b: { c: { d: { e: 42 } } } } };
      expect(jq(data, ".a.b.c.d.e")).toBe(42);
    });

    it("multiple outputs with comma", () => {
      expect(jq({ a: 1, b: 2 }, ".a, .b")).toEqual([1, 2]);
    });

    it("boolean literals", () => {
      expect(jq(null, "true")).toBe(true);
      expect(jq(null, "false")).toBe(false);
    });

    it("null literal", () => {
      expect(jq(42, "null")).toBe(null);
    });

    it("number literals", () => {
      expect(jq(null, "42")).toBe(42);
    });

    it("string literals", () => {
      expect(jq(null, '"hello"')).toBe("hello");
    });
  });

  describe("complex expressions", () => {
    it("full pipeline: iterate, select, transform", () => {
      const users = [
        { name: "Alice", age: 30 },
        { name: "Bob", age: 20 },
        { name: "Carol", age: 25 },
      ];
      expect(jq(users, '[.[] | select(.age > 25) | .name]')).toEqual(["Alice"]);
    });

    it("the README example", () => {
      const data = {
        users: [
          { name: "Alice", age: 30 },
          { name: "Bob", age: 20 },
          { name: "Carol", age: 28 },
        ],
      };
      expect(jq(data, '.users[] | select(.age > 25) | .name')).toEqual(["Alice", "Carol"]);
    });

    it("nested map with arithmetic", () => {
      expect(jq([[1, 2], [3, 4]], "map(map(. * 10))")).toEqual([[10, 20], [30, 40]]);
    });

    it("object construction from array items", () => {
      const data = [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ];
      expect(jq(data, "map({ id, upper_name: .name })")).toEqual([
        { id: 1, upper_name: "Alice" },
        { id: 2, upper_name: "Bob" },
      ]);
    });
  });

  describe("parse and evaluate directly", () => {
    it("parse produces an AST", () => {
      const ast = parse(".foo | .bar");
      expect(ast.type).toBe("pipe");
    });

    it("evaluate returns multiple outputs", () => {
      const ast = parse(".[]");
      const results = evaluate(ast, [1, 2, 3]);
      expect(results).toEqual([1, 2, 3]);
    });
  });
});
