// Minimal ISO-10303-21 (STEP) reader used by the IFC importer. It understands the subset that IFC
// files written by this package and by common tools use: entity lines `#n=NAME(args);`, string,
// number, enum, reference, `$` (unset), `*` (derived) and nested lists/typed values.

export type StepValue =
  | { kind: 'ref'; id: number }
  | { kind: 'str'; value: string }
  | { kind: 'num'; value: number }
  | { kind: 'enum'; value: string }
  | { kind: 'list'; items: StepValue[] }
  | { kind: 'typed'; name: string; args: StepValue[] }
  | { kind: 'null' };

export interface StepEntity {
  id: number;
  name: string;
  args: StepValue[];
}

const ENTITY_LINE = /^#(\d+)\s*=\s*([A-Z0-9_]+)\s*\((.*)\)\s*;\s*$/;

class Cursor {
  pos = 0;
  constructor(readonly text: string) {}
  peek(): string {
    return this.text[this.pos] ?? '';
  }
  skipSpace(): void {
    while (/\s/.test(this.peek())) this.pos += 1;
  }
}

function parseValue(c: Cursor): StepValue {
  c.skipSpace();
  const ch = c.peek();
  if (ch === '$') {
    c.pos += 1;
    return { kind: 'null' };
  }
  if (ch === '*') {
    c.pos += 1;
    return { kind: 'null' };
  }
  if (ch === "'") {
    let out = '';
    c.pos += 1;
    for (;;) {
      const next = c.text[c.pos];
      if (next === undefined) throw new SyntaxError('Unterminated STEP string');
      if (next === "'") {
        if (c.text[c.pos + 1] === "'") {
          out += "'";
          c.pos += 2;
          continue;
        }
        c.pos += 1;
        return { kind: 'str', value: out };
      }
      out += next;
      c.pos += 1;
    }
  }
  if (ch === '#') {
    const m = /^#(\d+)/.exec(c.text.slice(c.pos));
    if (!m) throw new SyntaxError(`Bad reference at ${c.pos}`);
    c.pos += m[0].length;
    return { kind: 'ref', id: Number(m[1]) };
  }
  if (ch === '.') {
    const m = /^\.([A-Z_]+)\./.exec(c.text.slice(c.pos));
    if (!m) throw new SyntaxError(`Bad enum at ${c.pos}`);
    c.pos += m[0].length;
    return { kind: 'enum', value: m[1]! };
  }
  if (ch === '(') {
    c.pos += 1;
    const items: StepValue[] = [];
    c.skipSpace();
    if (c.peek() === ')') {
      c.pos += 1;
      return { kind: 'list', items };
    }
    for (;;) {
      items.push(parseValue(c));
      c.skipSpace();
      if (c.peek() === ',') {
        c.pos += 1;
        continue;
      }
      if (c.peek() === ')') {
        c.pos += 1;
        return { kind: 'list', items };
      }
      throw new SyntaxError(`Expected , or ) at ${c.pos}`);
    }
  }
  const typed = /^([A-Z][A-Z0-9_]*)\s*\(/.exec(c.text.slice(c.pos));
  if (typed) {
    c.pos += typed[0].length - 1; // leave the '(' for the list parser
    const inner = parseValue(c);
    if (inner.kind !== 'list') throw new SyntaxError('Typed value without arguments');
    return { kind: 'typed', name: typed[1]!, args: inner.items };
  }
  const num = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(c.text.slice(c.pos));
  if (num) {
    c.pos += num[0].length;
    return { kind: 'num', value: Number(num[0]) };
  }
  throw new SyntaxError(`Unexpected character "${ch}" at ${c.pos}`);
}

/** Parse a single entity's argument list (the text between the outer parentheses). */
export function parseArgs(text: string): StepValue[] {
  const c = new Cursor(`(${text})`);
  const list = parseValue(c);
  if (list.kind !== 'list') throw new SyntaxError('Expected argument list');
  return list.items;
}

/** Parse every entity line of a STEP DATA section into a map keyed by id. */
export function parseStep(text: string): Map<number, StepEntity> {
  const entities = new Map<number, StepEntity>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const m = ENTITY_LINE.exec(line);
    if (!m) continue;
    const id = Number(m[1]);
    if (entities.has(id)) throw new SyntaxError(`Duplicate STEP entity #${id}`);
    entities.set(id, { id, name: m[2]!, args: parseArgs(m[3]!) });
  }
  return entities;
}
