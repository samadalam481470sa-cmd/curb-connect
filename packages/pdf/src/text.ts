import { isValidElement, type ReactNode } from 'react';

/**
 * Collects the literal text a document tree will print, by expanding the (hook-free) template
 * components. Used by tests and by reconciliation checks (RF-036-G: PDF totals reconcile with
 * database totals) without needing a PDF text extractor; react-pdf embeds subset fonts, so the
 * raw PDF bytes do not contain searchable text.
 */
export function collectText(node: ReactNode): string {
  const out: string[] = [];
  const walk = (n: ReactNode): void => {
    if (n === null || n === undefined || typeof n === 'boolean') return;
    if (typeof n === 'string' || typeof n === 'number' || typeof n === 'bigint') {
      out.push(String(n));
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (!isValidElement(n)) return;
    const props = n.props as { children?: ReactNode };
    if (typeof n.type === 'function') {
      const fn = n.type as (p: unknown) => ReactNode;
      // Class components (react-pdf Document) are walked through their children only.
      if (fn.prototype && 'render' in fn.prototype) {
        walk(props.children);
        return;
      }
      walk(fn(n.props));
      return;
    }
    walk(props.children);
  };
  walk(node);
  return out.join('\n');
}
