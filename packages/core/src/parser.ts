// AST node types for jq expressions

export type ASTNode =
  | { type: "identity" }
  | { type: "field"; name: string }
  | { type: "index"; index: number }
  | { type: "slice"; from?: number; to?: number }
  | { type: "iterate" }
  | { type: "pipe"; left: ASTNode; right: ASTNode }
  | { type: "comma"; left: ASTNode; right: ASTNode }
  | { type: "literal"; value: unknown }
  | { type: "object"; entries: Array<{ key: string | ASTNode; value: ASTNode }> }
  | { type: "array"; expr?: ASTNode }
  | { type: "builtin"; name: string; args: ASTNode[] }
  | { type: "comparison"; op: string; left: ASTNode; right: ASTNode }
  | { type: "arithmetic"; op: string; left: ASTNode; right: ASTNode }
  | { type: "logical"; op: string; left: ASTNode; right: ASTNode }
  | { type: "not" }
  | { type: "alternative"; left: ASTNode; right: ASTNode }
  | { type: "if"; cond: ASTNode; then: ASTNode; else?: ASTNode }
  | { type: "string_interp"; parts: Array<string | ASTNode> }
  | { type: "negate"; expr: ASTNode }
  | { type: "recursive_descent" };

// Token types
type Token =
  | { type: "dot" }
  | { type: "pipe" }
  | { type: "comma" }
  | { type: "colon" }
  | { type: "semicolon" }
  | { type: "lparen" }
  | { type: "rparen" }
  | { type: "lbracket" }
  | { type: "rbracket" }
  | { type: "lbrace" }
  | { type: "rbrace" }
  | { type: "question" }
  | { type: "ident"; value: string }
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "string_interp"; parts: Array<string | Token[]> }
  | { type: "op"; value: string }
  | { type: "eof" };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  const peek = () => (i < input.length ? input[i] : "");
  const advance = () => input[i++];
  const skipWhitespace = () => {
    while (i < input.length && /\s/.test(input[i])) i++;
  };

  while (i < input.length) {
    skipWhitespace();
    if (i >= input.length) break;

    const ch = peek();

    if (ch === "." && i + 1 < input.length && input[i + 1] === ".") {
      // ".." recursive descent
      i += 2;
      tokens.push({ type: "ident", value: ".." });
      continue;
    }

    if (ch === ".") {
      advance();
      // Check if followed by an identifier
      if (i < input.length && /[a-zA-Z_]/.test(input[i])) {
        let name = "";
        while (i < input.length && /[a-zA-Z_0-9]/.test(input[i])) {
          name += advance();
        }
        // Check for optional operator "?"
        if (i < input.length && input[i] === "?") {
          advance(); // skip ?
        }
        tokens.push({ type: "dot" });
        tokens.push({ type: "ident", value: name });
      } else {
        tokens.push({ type: "dot" });
      }
      continue;
    }

    if (ch === "|") {
      advance();
      tokens.push({ type: "pipe" });
      continue;
    }

    if (ch === ",") {
      advance();
      tokens.push({ type: "comma" });
      continue;
    }

    if (ch === ":") {
      advance();
      tokens.push({ type: "colon" });
      continue;
    }

    if (ch === ";") {
      advance();
      tokens.push({ type: "semicolon" });
      continue;
    }

    if (ch === "(") {
      advance();
      tokens.push({ type: "lparen" });
      continue;
    }

    if (ch === ")") {
      advance();
      tokens.push({ type: "rparen" });
      continue;
    }

    if (ch === "[") {
      advance();
      tokens.push({ type: "lbracket" });
      continue;
    }

    if (ch === "]") {
      advance();
      tokens.push({ type: "rbracket" });
      continue;
    }

    if (ch === "{") {
      advance();
      tokens.push({ type: "lbrace" });
      continue;
    }

    if (ch === "}") {
      advance();
      tokens.push({ type: "rbrace" });
      continue;
    }

    if (ch === "?") {
      advance();
      tokens.push({ type: "question" });
      continue;
    }

    // String with interpolation support
    if (ch === '"') {
      advance(); // skip opening quote
      const parts: Array<string | Token[]> = [];
      let current = "";

      while (i < input.length && input[i] !== '"') {
        if (input[i] === "\\" && i + 1 < input.length) {
          if (input[i + 1] === "(") {
            // String interpolation \(...)
            if (current) {
              parts.push(current);
              current = "";
            }
            i += 2; // skip \(
            // Collect tokens until matching )
            let depth = 1;
            let interpExpr = "";
            while (i < input.length && depth > 0) {
              if (input[i] === "(") depth++;
              else if (input[i] === ")") {
                depth--;
                if (depth === 0) {
                  i++;
                  break;
                }
              }
              interpExpr += input[i];
              i++;
            }
            parts.push(tokenize(interpExpr));
          } else {
            // Regular escape
            i++; // skip backslash
            const esc = advance();
            switch (esc) {
              case "n": current += "\n"; break;
              case "t": current += "\t"; break;
              case "r": current += "\r"; break;
              case "\\": current += "\\"; break;
              case '"': current += '"'; break;
              case "/": current += "/"; break;
              default: current += "\\" + esc;
            }
          }
        } else {
          current += advance();
        }
      }
      if (i < input.length) advance(); // skip closing quote

      if (parts.length === 0) {
        tokens.push({ type: "string", value: current });
      } else {
        if (current) parts.push(current);
        // Check if all parts are strings (no interpolation)
        if (parts.every((p) => typeof p === "string")) {
          tokens.push({ type: "string", value: parts.join("") });
        } else {
          tokens.push({ type: "string_interp", parts });
        }
      }
      continue;
    }

    // Numbers (including negative when preceded by an operator or at start)
    if (/[0-9]/.test(ch) || (ch === "-" && i + 1 < input.length && /[0-9]/.test(input[i + 1]) && isNegativeContext(tokens))) {
      let num = "";
      if (ch === "-") num += advance();
      while (i < input.length && /[0-9.]/.test(input[i])) {
        num += advance();
      }
      tokens.push({ type: "number", value: Number(num) });
      continue;
    }

    // Operators
    if (ch === "=" && i + 1 < input.length && input[i + 1] === "=") {
      i += 2;
      tokens.push({ type: "op", value: "==" });
      continue;
    }
    if (ch === "!" && i + 1 < input.length && input[i + 1] === "=") {
      i += 2;
      tokens.push({ type: "op", value: "!=" });
      continue;
    }
    if (ch === "<" && i + 1 < input.length && input[i + 1] === "=") {
      i += 2;
      tokens.push({ type: "op", value: "<=" });
      continue;
    }
    if (ch === ">" && i + 1 < input.length && input[i + 1] === "=") {
      i += 2;
      tokens.push({ type: "op", value: ">=" });
      continue;
    }
    if (ch === "<") {
      advance();
      tokens.push({ type: "op", value: "<" });
      continue;
    }
    if (ch === ">") {
      advance();
      tokens.push({ type: "op", value: ">" });
      continue;
    }
    if (ch === "/" && i + 1 < input.length && input[i + 1] === "/") {
      i += 2;
      tokens.push({ type: "op", value: "//" });
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "%") {
      advance();
      tokens.push({ type: "op", value: ch });
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = "";
      while (i < input.length && /[a-zA-Z_0-9]/.test(input[i])) {
        ident += advance();
      }
      tokens.push({ type: "ident", value: ident });
      continue;
    }

    throw new Error(`Unexpected character '${ch}' at position ${i}`);
  }

  tokens.push({ type: "eof" });
  return tokens;
}

function isNegativeContext(tokens: Token[]): boolean {
  if (tokens.length === 0) return true;
  const last = tokens[tokens.length - 1];
  return (
    last.type === "op" ||
    last.type === "pipe" ||
    last.type === "comma" ||
    last.type === "lparen" ||
    last.type === "lbracket" ||
    last.type === "colon" ||
    last.type === "semicolon"
  );
}

// Recursive descent parser
export function parse(input: string): ASTNode {
  const tokens = tokenize(input);
  let pos = 0;

  const current = (): Token => tokens[pos];
  const advance = (): Token => tokens[pos++];
  const expect = (type: string): Token => {
    const tok = current();
    if (tok.type !== type) {
      throw new Error(`Expected ${type}, got ${tok.type}${("value" in tok) ? ` (${tok.value})` : ""}`);
    }
    return advance();
  };

  const isOp = (value: string) => {
    const tok = current();
    return tok.type === "op" && tok.value === value;
  };

  const KEYWORDS = new Set(["then", "else", "elif", "end", "and", "or", "as", "catch"]);
  const isKeyword = (value: string) => KEYWORDS.has(value);

  const isIdent = (value: string) => {
    const tok = current();
    return tok.type === "ident" && tok.value === value;
  };

  // Top level: comma-separated (multiple outputs)
  function parseExpr(): ASTNode {
    let left = parsePipe();
    while (current().type === "comma") {
      advance(); // skip comma
      const right = parsePipe();
      left = { type: "comma", left, right };
    }
    return left;
  }

  // Pipe: left | right
  function parsePipe(): ASTNode {
    let left = parseAlternative();
    while (current().type === "pipe") {
      advance(); // skip |
      const right = parseAlternative();
      left = { type: "pipe", left, right };
    }
    return left;
  }

  // Alternative: left // right
  function parseAlternative(): ASTNode {
    let left = parseOr();
    while (isOp("//")) {
      advance();
      const right = parseOr();
      left = { type: "alternative", left, right };
    }
    return left;
  }

  // Logical or
  function parseOr(): ASTNode {
    let left = parseAnd();
    while (isIdent("or")) {
      advance();
      const right = parseAnd();
      left = { type: "logical", op: "or", left, right };
    }
    return left;
  }

  // Logical and
  function parseAnd(): ASTNode {
    let left = parseComparison();
    while (isIdent("and")) {
      advance();
      const right = parseComparison();
      left = { type: "logical", op: "and", left, right };
    }
    return left;
  }

  // Comparison: ==, !=, <, >, <=, >=
  function parseComparison(): ASTNode {
    let left = parseAddSub();
    const compOps = ["==", "!=", "<", ">", "<=", ">="];
    while (current().type === "op" && compOps.includes((current() as { type: "op"; value: string }).value)) {
      const op = (advance() as { type: "op"; value: string }).value;
      const right = parseAddSub();
      left = { type: "comparison", op, left, right };
    }
    return left;
  }

  // Addition/subtraction
  function parseAddSub(): ASTNode {
    let left = parseMulDiv();
    while (isOp("+") || isOp("-")) {
      const op = (advance() as { type: "op"; value: string }).value;
      const right = parseMulDiv();
      left = { type: "arithmetic", op, left, right };
    }
    return left;
  }

  // Multiplication/division/modulo
  function parseMulDiv(): ASTNode {
    let left = parseUnary();
    while (isOp("*") || isOp("/") || isOp("%")) {
      const op = (advance() as { type: "op"; value: string }).value;
      const right = parseUnary();
      left = { type: "arithmetic", op, left, right };
    }
    return left;
  }

  // Unary negation
  function parseUnary(): ASTNode {
    if (isOp("-")) {
      advance();
      const expr = parsePostfix();
      return { type: "negate", expr };
    }
    return parsePostfix();
  }

  // Postfix: field access, indexing, iteration after a primary
  function parsePostfix(): ASTNode {
    let node = parsePrimary();

    while (true) {
      if (current().type === "dot") {
        advance(); // skip dot
        if (current().type === "ident" && !isKeyword((current() as { type: "ident"; value: string }).value)) {
          const name = (advance() as { type: "ident"; value: string }).value;
          node = { type: "pipe", left: node, right: { type: "field", name } };
        } else {
          // just a dot by itself as postfix — shouldn't normally happen
          break;
        }
      } else if (current().type === "lbracket") {
        advance(); // skip [
        if (current().type === "rbracket") {
          // .[] iterate
          advance();
          node = { type: "pipe", left: node, right: { type: "iterate" } };
        } else if (current().type === "number") {
          const num = (current() as { type: "number"; value: number }).value;
          advance();
          if (current().type === "colon") {
            // slice [n:m]
            advance();
            let to: number | undefined;
            if (current().type === "number") {
              to = (advance() as { type: "number"; value: number }).value;
            }
            expect("rbracket");
            node = { type: "pipe", left: node, right: { type: "slice", from: num, to } };
          } else {
            expect("rbracket");
            node = { type: "pipe", left: node, right: { type: "index", index: num } };
          }
        } else if (current().type === "colon") {
          // slice [:m]
          advance();
          let to: number | undefined;
          if (current().type === "number") {
            to = (advance() as { type: "number"; value: number }).value;
          }
          expect("rbracket");
          node = { type: "pipe", left: node, right: { type: "slice", to } };
        } else {
          // Expression index - parse full expression
          const indexExpr = parseExpr();
          expect("rbracket");
          node = { type: "pipe", left: node, right: { type: "builtin", name: "_index_expr", args: [indexExpr] } };
        }
      } else if (current().type === "question") {
        // Try/optional operator - just skip it
        advance();
      } else {
        break;
      }
    }

    return node;
  }

  // Primary expressions
  function parsePrimary(): ASTNode {
    const tok = current();

    // Identity "."
    if (tok.type === "dot") {
      advance();
      // Check for field access immediately after dot (but not keywords)
      if (current().type === "ident" && !isKeyword((current() as { type: "ident"; value: string }).value)) {
        const name = (advance() as { type: "ident"; value: string }).value;
        return { type: "field", name };
      }
      // Check for [] iterate or [n] index after dot
      if (current().type === "lbracket") {
        // Let postfix handle it — return identity so postfix chains from it
        return { type: "identity" };
      }
      return { type: "identity" };
    }

    // Recursive descent ".."
    if (tok.type === "ident" && tok.value === "..") {
      advance();
      return { type: "recursive_descent" };
    }

    // Number literal
    if (tok.type === "number") {
      advance();
      return { type: "literal", value: tok.value };
    }

    // String literal
    if (tok.type === "string") {
      advance();
      return { type: "literal", value: tok.value };
    }

    // String interpolation
    if (tok.type === "string_interp") {
      advance();
      const parts: Array<string | ASTNode> = tok.parts.map((p) => {
        if (typeof p === "string") return p;
        // p is Token[] — parse them
        const savedPos = pos;
        const savedTokens = tokens.splice(0, tokens.length, ...p, { type: "eof" as const });
        pos = 0;
        const node = parseExpr();
        tokens.splice(0, tokens.length, ...savedTokens);
        pos = savedPos;
        return node;
      });
      return { type: "string_interp", parts };
    }

    // Boolean and null literals
    if (tok.type === "ident" && (tok.value === "true" || tok.value === "false")) {
      advance();
      return { type: "literal", value: tok.value === "true" };
    }
    if (tok.type === "ident" && tok.value === "null") {
      advance();
      return { type: "literal", value: null };
    }

    // "not" as a filter
    if (tok.type === "ident" && tok.value === "not") {
      advance();
      return { type: "not" };
    }

    // if-then-else-end
    if (tok.type === "ident" && tok.value === "if") {
      advance();
      const cond = parsePipe();
      if (!isIdent("then")) {
        throw new Error("Expected 'then' in if expression");
      }
      advance(); // skip "then"
      const then_ = parsePipe();
      let else_: ASTNode | undefined;
      if (isIdent("elif")) {
        // Desugar elif into nested if
        // Don't consume "elif" — rewrite it as "if" and recurse
        (tokens[pos] as { type: string; value: string }).value = "if";
        else_ = parsePrimary();
      } else if (isIdent("else")) {
        advance();
        else_ = parsePipe();
      }
      if (isIdent("end")) {
        advance();
      }
      return { type: "if", cond, then: then_, else: else_ };
    }

    // Builtins with arguments
    if (tok.type === "ident") {
      const name = tok.value;
      const builtinsNoArgs = [
        "length", "keys", "values", "type",
        "sort", "flatten", "first", "last",
        "not", "empty", "null", "true", "false",
        "nan", "infinite", "infinite", "env",
        "keys_unsorted", "to_entries", "from_entries",
        "ascii_downcase", "ascii_upcase", "ltrimstr", "rtrimstr",
        "startswith", "endswith", "test", "split", "join",
        "tostring", "tonumber", "reverse", "min", "max",
        "add", "any", "all", "range", "floor", "ceil", "round",
        "sqrt", "pow", "log", "exp", "fabs",
        "indices", "inside", "contains", "input", "inputs",
        "debug", "stderr", "paths", "leaf_paths",
        "getpath", "setpath", "delpaths",
        "has", "in", "limit", "until", "while", "repeat",
        "recurse", "walk", "transpose", "ascii",
        "explode", "implode", "tojson", "fromjson",
        "error", "halt", "halt_error",
      ];
      const builtinsWithArgs = [
        "select", "map", "sort_by", "group_by", "unique_by",
        "map_values", "del", "to_entries", "from_entries",
        "with_entries", "path", "getpath", "setpath", "delpaths",
        "has", "in", "contains", "inside", "test", "match",
        "capture", "scan", "splits", "split", "join",
        "ltrimstr", "rtrimstr", "startswith", "endswith",
        "limit", "until", "while", "repeat",
        "range", "min_by", "max_by", "unique_by",
        "indices", "index", "rindex", "any", "all",
        "flatten", "recurse", "env", "ascii",
        "reduce", "foreach", "label", "try",
        "unique",
      ];

      if (builtinsWithArgs.includes(name)) {
        advance();
        if (current().type === "lparen") {
          advance(); // skip (
          const args: ASTNode[] = [];
          if (current().type !== "rparen") {
            args.push(parseExpr());
            while (current().type === "semicolon") {
              advance();
              args.push(parseExpr());
            }
          }
          expect("rparen");
          return { type: "builtin", name, args };
        }
        // No args — that's ok for some builtins like unique, flatten
        return { type: "builtin", name, args: [] };
      }

      if (builtinsNoArgs.includes(name)) {
        advance();
        // Some no-arg builtins can also accept args
        if (current().type === "lparen") {
          advance();
          const args: ASTNode[] = [];
          if (current().type !== "rparen") {
            args.push(parseExpr());
            while (current().type === "semicolon") {
              advance();
              args.push(parseExpr());
            }
          }
          expect("rparen");
          return { type: "builtin", name, args };
        }
        return { type: "builtin", name, args: [] };
      }

      // Unknown identifier — treat as a field name or error
      advance();
      throw new Error(`Unknown function or identifier: ${name}`);
    }

    // Array construction [expr]
    if (tok.type === "lbracket") {
      advance(); // skip [
      if (current().type === "rbracket") {
        advance();
        return { type: "array" };
      }
      const expr = parseExpr();
      expect("rbracket");
      return { type: "array", expr };
    }

    // Object construction { ... }
    if (tok.type === "lbrace") {
      advance(); // skip {
      const entries: Array<{ key: string | ASTNode; value: ASTNode }> = [];
      while (current().type !== "rbrace") {
        if (entries.length > 0) {
          expect("comma");
        }
        let key: string | ASTNode;
        let value: ASTNode;

        if (current().type === "ident") {
          const name = (advance() as { type: "ident"; value: string }).value;
          if (current().type === "colon") {
            advance(); // skip :
            key = name;
            value = parsePipe();
          } else {
            // Shorthand { name } means { name: .name }
            key = name;
            value = { type: "field", name };
          }
        } else if (current().type === "string") {
          const name = (advance() as { type: "string"; value: string }).value;
          expect("colon");
          key = name;
          value = parsePipe();
        } else if (current().type === "lparen") {
          // Dynamic key: { (.name): .value }
          advance(); // skip (
          key = parseExpr();
          expect("rparen");
          expect("colon");
          value = parsePipe();
        } else if (current().type === "dot") {
          // Handle .field as key
          advance(); // skip dot
          if (current().type === "ident") {
            const name = (advance() as { type: "ident"; value: string }).value;
            if (current().type === "colon") {
              advance();
              key = name;
              value = parsePipe();
            } else {
              // Shorthand
              key = name;
              value = { type: "field", name };
            }
          } else {
            throw new Error("Expected field name after dot in object");
          }
        } else {
          throw new Error(`Unexpected token in object construction: ${current().type}`);
        }
        entries.push({ key, value });
      }
      expect("rbrace");
      return { type: "object", entries };
    }

    // Parenthesized expression
    if (tok.type === "lparen") {
      advance();
      const expr = parseExpr();
      expect("rparen");
      return expr;
    }

    throw new Error(`Unexpected token: ${tok.type}${("value" in tok) ? ` (${tok.value})` : ""}`);
  }

  const result = parseExpr();
  if (current().type !== "eof") {
    throw new Error(`Unexpected token after expression: ${current().type}${("value" in current()) ? ` (${(current() as { value: unknown }).value})` : ""}`);
  }
  return result;
}
