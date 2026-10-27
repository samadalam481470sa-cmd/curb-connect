// A small, dependency-free parser for the YAML subset used by docs/requirements/*.yaml.
//
// The traceability tooling must run with plain `node` and no installed packages, so instead of
// pulling in a YAML library we support exactly what our requirement files need and reject
// everything else with a line-numbered error (rather than guessing):
//
//   - block mappings (`key: value`, `key:` + indented block) with plain or quoted keys
//   - block sequences (`- value`, `- key: value` compact mappings, `-` + indented block)
//   - scalars: plain (null/~, true/false, integers, decimals, otherwise strings), 'single-quoted',
//     "double-quoted" (with YAML escapes), and `|` / `>` block scalars (with -/+ chomping)
//   - flow sequences of scalars, which may span several lines (`[a, 'b', "c"]`), and the empty
//     flow mapping `{}`
//   - full-line comments and ` #` trailing comments; a leading `---` document marker
//
// Not supported (rejected): anchors/aliases, tags, multi-line plain or quoted scalars, nested flow
// collections, complex keys, multiple documents, tab indentation.

export class YamlLiteError extends Error {
  constructor(message) {
    super(message);
    this.name = 'YamlLiteError';
  }
}

const DOUBLE_ESCAPES = {
  0: '\0',
  a: '\x07',
  b: '\b',
  t: '\t',
  '\t': '\t',
  n: '\n',
  v: '\v',
  f: '\f',
  r: '\r',
  e: '\x1b',
  ' ': ' ',
  '"': '"',
  '/': '/',
  '\\': '\\',
  N: '\x85',
  _: '\xa0',
  L: ' ',
  P: ' ',
};

/**
 * Parse a YAML document in the supported subset.
 * @param {string} source
 * @param {{ filename?: string }} [options]
 * @returns {unknown}
 */
export function parseYaml(source, options = {}) {
  const text = String(source).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  return new Parser(text.split('\n'), options.filename ?? '<yaml>').parseDocument();
}

class Parser {
  constructor(lines, filename) {
    this.lines = lines;
    this.filename = filename;
    this.i = 0;
  }

  fail(message, lineIndex = this.i) {
    throw new YamlLiteError(`${this.filename}:${lineIndex + 1}: ${message}`);
  }

  /** Next content line (skipping blank and comment-only lines), without consuming it. */
  peek() {
    while (this.i < this.lines.length) {
      const raw = this.lines[this.i];
      const body = raw.trimStart();
      const indentText = raw.slice(0, raw.length - body.length);
      if (indentText.includes('\t')) this.fail('tab characters are not allowed in indentation');
      if (body === '' || body.startsWith('#')) {
        this.i++;
        continue;
      }
      return { indent: indentText.length, text: body.trimEnd(), index: this.i };
    }
    return null;
  }

  parseDocument() {
    let line = this.peek();
    if (line && line.indent === 0 && /^---(\s+#.*)?$/.test(line.text)) {
      this.i++;
      line = this.peek();
    }
    if (!line) return null;
    if (line.indent !== 0) this.fail('the document must start at column 1');
    const value = this.parseNode(0);
    const extra = this.peek();
    if (extra) {
      if (/^(---|\.\.\.)(\s|$)/.test(extra.text))
        this.fail('multiple YAML documents are not supported');
      this.fail('unexpected content (check the indentation)', extra.index);
    }
    return value;
  }

  parseNode(indent) {
    const line = this.peek();
    if (!line) return null;
    if (isSequenceItem(line.text)) return this.parseSequence(line.indent);
    if (findKeySeparator(line.text) >= 0 && !/^["'[{]/.test(line.text)) {
      return this.parseMapping(line.indent);
    }
    if (/^["']/.test(line.text) && findKeySeparator(line.text) >= 0) {
      const closing = matchQuoted(line.text, 0);
      if (closing && /^\s*:(\s|$)/.test(line.text.slice(closing.end))) {
        return this.parseMapping(line.indent);
      }
    }
    // A bare scalar or flow collection as the whole node.
    return this.parseInlineValue(line.text, indent - 1, line.index);
  }

  parseMapping(indent) {
    const result = {};
    for (;;) {
      const line = this.peek();
      if (!line || line.indent < indent) break;
      if (line.indent > indent) this.fail('unexpected indentation', line.index);
      if (isSequenceItem(line.text)) break; // belongs to an enclosing `key:` at this indent
      const { key, rest } = this.splitKey(line.text, line.index);
      if (Object.prototype.hasOwnProperty.call(result, key)) {
        this.fail(`duplicate key "${key}"`, line.index);
      }
      result[key] = this.parseInlineValue(rest, indent, line.index);
    }
    return result;
  }

  parseSequence(indent) {
    const result = [];
    for (;;) {
      const line = this.peek();
      if (!line || line.indent < indent) break;
      if (line.indent > indent) this.fail('unexpected indentation', line.index);
      if (!isSequenceItem(line.text)) break;
      const afterDash = line.text === '-' ? '' : line.text.slice(1);
      const rest = afterDash.trimStart();
      const contentIndent = indent + 1 + (afterDash.length - rest.length);
      if (rest === '' || rest.startsWith('#')) {
        this.i++;
        const next = this.peek();
        result.push(next && next.indent > indent ? this.parseNode(next.indent) : null);
        continue;
      }
      if (startsCompactMapping(rest)) {
        // Re-read the remainder of this line as the first key of a mapping at its own column.
        this.lines[line.index] = ' '.repeat(contentIndent) + rest;
        result.push(this.parseMapping(contentIndent));
        continue;
      }
      result.push(this.parseInlineValue(rest, indent, line.index));
    }
    return result;
  }

  splitKey(text, lineIndex) {
    if (text.startsWith('"') || text.startsWith("'")) {
      const quoted = matchQuoted(text, 0);
      if (!quoted) this.fail('unterminated quoted key', lineIndex);
      const after = text.slice(quoted.end);
      const m = after.match(/^\s*:(\s+|$)/);
      if (!m) this.fail('expected ":" after quoted key', lineIndex);
      return {
        key: this.decodeQuoted(text.slice(0, quoted.end), lineIndex),
        rest: after.slice(m[0].length).trim(),
      };
    }
    const sep = findKeySeparator(text);
    if (sep < 0) this.fail(`expected "key: value", got "${text}"`, lineIndex);
    const key = text.slice(0, sep).trim();
    if (!key) this.fail('empty mapping key', lineIndex);
    if (/^[[{&*!|>%@`?]/.test(key)) this.fail(`unsupported key syntax "${key}"`, lineIndex);
    return { key, rest: text.slice(sep + 1).trim() };
  }

  /**
   * Parse the value that follows `key:` or `- ` on line `lineIndex`. Consumes that line and any
   * lines that belong to the value. `parentIndent` is the indentation of the owning key or dash.
   */
  parseInlineValue(rest, parentIndent, lineIndex) {
    if (rest === '' || rest.startsWith('#')) {
      this.i = lineIndex + 1;
      const next = this.peek();
      if (!next) return null;
      if (next.indent > parentIndent) return this.parseNode(next.indent);
      if (next.indent === parentIndent && isSequenceItem(next.text)) {
        return this.parseSequence(parentIndent);
      }
      return null;
    }
    const block = rest.match(/^([|>])([-+]?)(\s+#.*)?$/);
    if (block) return this.parseBlockScalar(block[1], block[2], parentIndent, lineIndex);
    if (/^[&*!]/.test(rest)) this.fail('anchors, aliases and tags are not supported', lineIndex);
    if (rest.startsWith('[')) return this.parseFlowSequence(rest, lineIndex);
    if (rest.startsWith('{')) {
      if (/^\{\s*\}(\s+#.*)?$/.test(rest)) {
        this.i = lineIndex + 1;
        return {};
      }
      this.fail('flow mappings are not supported (only {} is)', lineIndex);
    }
    this.i = lineIndex + 1;
    if (rest.startsWith('"') || rest.startsWith("'")) {
      const quoted = matchQuoted(rest, 0);
      if (!quoted)
        this.fail('unterminated quoted string (multi-line strings are not supported)', lineIndex);
      const tail = rest.slice(quoted.end).trim();
      if (tail && !tail.startsWith('#'))
        this.fail(`unexpected text after string: "${tail}"`, lineIndex);
      return this.decodeQuoted(rest.slice(0, quoted.end), lineIndex);
    }
    const plain = stripComment(rest);
    if (/:(\s|$)/.test(plain)) this.fail('plain value contains ": "; quote the value', lineIndex);
    return typePlain(plain);
  }

  parseBlockScalar(style, chomp, parentIndent, lineIndex) {
    const collected = [];
    let j = lineIndex + 1;
    let blockIndent = -1;
    for (; j < this.lines.length; j++) {
      const raw = this.lines[j];
      if (raw.trim() === '') {
        collected.push('');
        continue;
      }
      const indent = raw.length - raw.trimStart().length;
      if (indent <= parentIndent) break;
      if (blockIndent < 0) blockIndent = indent;
      if (indent < blockIndent)
        this.fail('block scalar line is less indented than its first line', j);
      collected.push(raw.slice(blockIndent));
    }
    this.i = j;
    // Trailing blank lines are handled by chomping, not kept as content lines.
    let trailingBlank = 0;
    while (collected.length && collected[collected.length - 1] === '') {
      collected.pop();
      trailingBlank++;
    }
    let body;
    if (style === '|') {
      body = collected.join('\n');
    } else {
      body = '';
      for (let k = 0; k < collected.length; k++) {
        const current = collected[k];
        if (k === 0) body = current;
        else if (current === '') body += '\n';
        else if (collected[k - 1] === '' || /^\s/.test(current)) body += current;
        else body += ' ' + current;
      }
    }
    if (collected.length === 0) return '';
    if (chomp === '-') return body;
    if (chomp === '+') return body + '\n'.repeat(1 + trailingBlank);
    return body + '\n';
  }

  parseFlowSequence(rest, lineIndex) {
    let buffer = stripTrailingComment(rest);
    let j = lineIndex;
    for (;;) {
      const end = findFlowEnd(buffer);
      if (end >= 0) {
        const tail = buffer.slice(end + 1).trim();
        if (tail) this.fail(`unexpected text after "]": "${tail}"`, j);
        buffer = buffer.slice(0, end + 1);
        break;
      }
      j++;
      if (j >= this.lines.length) this.fail('unterminated flow sequence', lineIndex);
      buffer += ' ' + stripTrailingComment(this.lines[j].trim());
    }
    this.i = j + 1;
    const inner = buffer.slice(1, -1).trim();
    if (inner === '') return [];
    const items = [];
    let pos = 0;
    while (pos <= inner.length) {
      while (inner[pos] === ' ') pos++;
      let token;
      if (inner[pos] === '"' || inner[pos] === "'") {
        const quoted = matchQuoted(inner, pos);
        if (!quoted) this.fail('unterminated quoted string in flow sequence', lineIndex);
        token = this.decodeQuoted(inner.slice(pos, quoted.end), lineIndex);
        pos = quoted.end;
        while (inner[pos] === ' ') pos++;
      } else {
        let end = inner.indexOf(',', pos);
        if (end < 0) end = inner.length;
        const raw = inner.slice(pos, end).trim();
        if (/^[[{]/.test(raw)) this.fail('nested flow collections are not supported', lineIndex);
        if (raw === '') {
          if (end >= inner.length) break; // trailing comma
          this.fail('empty item in flow sequence', lineIndex);
        }
        token = typePlain(raw);
        pos = end;
      }
      items.push(token);
      if (pos >= inner.length) break;
      if (inner[pos] !== ',') this.fail('expected "," between flow sequence items', lineIndex);
      pos++;
    }
    return items;
  }

  decodeQuoted(token, lineIndex) {
    const quote = token[0];
    const body = token.slice(1, -1);
    if (quote === "'") return body.replace(/''/g, "'");
    let out = '';
    for (let k = 0; k < body.length; k++) {
      const ch = body[k];
      if (ch !== '\\') {
        out += ch;
        continue;
      }
      const esc = body[++k];
      if (esc in DOUBLE_ESCAPES) {
        out += DOUBLE_ESCAPES[esc];
      } else if (esc === 'x' || esc === 'u' || esc === 'U') {
        const width = esc === 'x' ? 2 : esc === 'u' ? 4 : 8;
        const hex = body.slice(k + 1, k + 1 + width);
        if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== width) {
          this.fail(`invalid \\${esc} escape`, lineIndex);
        }
        out += String.fromCodePoint(parseInt(hex, 16));
        k += width;
      } else {
        this.fail(`invalid escape "\\${esc ?? ''}" in double-quoted string`, lineIndex);
      }
    }
    return out;
  }
}

function isSequenceItem(text) {
  return text === '-' || text.startsWith('- ');
}

/** Index of the ":" that ends a plain key, or -1. */
function findKeySeparator(text) {
  const m = text.match(/:(\s|$)/);
  if (!m) return -1;
  const idx = m.index;
  // A " #" before the colon means the colon is inside a comment.
  const hash = text.search(/\s#/);
  if (hash >= 0 && hash < idx) return -1;
  return idx;
}

function startsCompactMapping(rest) {
  if (rest.startsWith('"') || rest.startsWith("'")) {
    const quoted = matchQuoted(rest, 0);
    return Boolean(quoted && /^\s*:(\s|$)/.test(rest.slice(quoted.end)));
  }
  if (/^[[{|>&*!]/.test(rest)) return false;
  return findKeySeparator(rest) >= 0;
}

/** Find the end of a quoted string starting at `start`; returns { end } (exclusive) or null. */
function matchQuoted(text, start) {
  const quote = text[start];
  for (let k = start + 1; k < text.length; k++) {
    const ch = text[k];
    if (quote === '"' && ch === '\\') {
      k++;
      continue;
    }
    if (ch === quote) {
      if (quote === "'" && text[k + 1] === "'") {
        k++;
        continue;
      }
      return { end: k + 1 };
    }
  }
  return null;
}

/** Index of the "]" closing a flow sequence that starts at 0, or -1 if not on this text. */
function findFlowEnd(text) {
  let depth = 0;
  for (let k = 0; k < text.length; k++) {
    const ch = text[k];
    if (ch === '"' || ch === "'") {
      const quoted = matchQuoted(text, k);
      if (!quoted) return -1;
      k = quoted.end - 1;
    } else if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      depth--;
      if (depth === 0) return k;
    }
  }
  return -1;
}

function stripComment(text) {
  const idx = text.search(/(^|\s)#/);
  return (idx < 0 ? text : text.slice(0, idx)).trim();
}

/** Like stripComment, but ignores "#" inside quoted strings (used for flow sequences). */
function stripTrailingComment(text) {
  for (let k = 0; k < text.length; k++) {
    const ch = text[k];
    if (ch === '"' || ch === "'") {
      const quoted = matchQuoted(text, k);
      if (!quoted) return text.trim();
      k = quoted.end - 1;
    } else if (ch === '#' && (k === 0 || /\s/.test(text[k - 1]))) {
      return text.slice(0, k).trim();
    }
  }
  return text.trim();
}

function typePlain(text) {
  if (text === '' || text === '~' || text === 'null' || text === 'Null' || text === 'NULL') {
    return null;
  }
  if (/^(true|True|TRUE)$/.test(text)) return true;
  if (/^(false|False|FALSE)$/.test(text)) return false;
  if (/^[-+]?\d+$/.test(text)) {
    const n = Number(text);
    if (Number.isSafeInteger(n)) return n;
    return text;
  }
  if (/^[-+]?(\d+\.\d*|\.\d+)([eE][-+]?\d+)?$/.test(text)) return Number(text);
  return text;
}
