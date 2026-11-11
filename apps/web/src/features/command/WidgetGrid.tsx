'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

// Draggable, resizable, collapsible dashboard widgets with a per-browser saved layout.
// Drag a widget by its grip, or use the arrow buttons (keyboard and touch friendly).

export type WidgetSize = 's' | 'm' | 'l' | 'xl';
const SIZES: readonly WidgetSize[] = ['s', 'm', 'l', 'xl'];
const SIZE_LABEL: Record<WidgetSize, string> = { s: 'S', m: 'M', l: 'L', xl: 'XL' };

export interface WidgetDef {
  id: string;
  title: string;
  defaultSize: WidgetSize;
  actions?: ReactNode;
  render: () => ReactNode;
}

interface SavedLayout {
  order: string[];
  sizes: Record<string, WidgetSize>;
  collapsed: string[];
}

function readLayout(key: string): SavedLayout | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedLayout;
    if (!Array.isArray(parsed.order)) return null;
    return {
      order: parsed.order.filter((x) => typeof x === 'string'),
      sizes: parsed.sizes && typeof parsed.sizes === 'object' ? parsed.sizes : {},
      collapsed: Array.isArray(parsed.collapsed) ? parsed.collapsed : [],
    };
  } catch {
    return null;
  }
}

/** Keeps saved order for known widgets and appends any new widgets at the end. */
export function reconcileOrder(saved: readonly string[], ids: readonly string[]): string[] {
  const known = saved.filter((id) => ids.includes(id));
  return [...known, ...ids.filter((id) => !known.includes(id))];
}

export function moveItem(order: readonly string[], id: string, toIndex: number): string[] {
  const from = order.indexOf(id);
  if (from < 0) return [...order];
  const next = order.filter((x) => x !== id);
  next.splice(Math.max(0, Math.min(next.length, toIndex)), 0, id);
  return next;
}

export function WidgetGrid({ storageKey, widgets }: { storageKey: string; widgets: WidgetDef[] }) {
  const ids = useMemo(() => widgets.map((w) => w.id), [widgets]);
  const [layout, setLayout] = useState<SavedLayout>({ order: ids, sizes: {}, collapsed: [] });
  const [loaded, setLoaded] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);

  useEffect(() => {
    // Restore after paint: reading storage during render would break hydration.
    const handle = window.setTimeout(() => {
      const saved = readLayout(storageKey);
      // Unknown or new widget ids are reconciled at render time.
      if (saved) setLayout(saved);
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [storageKey]);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(layout));
    } catch {
      // Private mode or storage full: the layout just won't persist.
    }
  }, [layout, loaded, storageKey]);

  const order = reconcileOrder(layout.order, ids);
  const byId = new Map(widgets.map((w) => [w.id, w]));

  const update = useCallback((fn: (l: SavedLayout) => SavedLayout) => setLayout((l) => fn(l)), []);

  return (
    <>
      <div
        className="cc-no-print"
        style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.6rem' }}
      >
        <button
          type="button"
          className="cc-btn cc-btn--sm"
          onClick={() => setLayout({ order: ids, sizes: {}, collapsed: [] })}
        >
          Reset layout
        </button>
      </div>
      <div className="cc-grid">
        {order.map((id, index) => {
          const w = byId.get(id)!;
          const size = layout.sizes[id] ?? w.defaultSize;
          const collapsed = layout.collapsed.includes(id);
          return (
            <div
              key={id}
              className="cc-widget"
              data-size={size}
              data-collapsed={collapsed}
              data-dragging={dragId === id}
              data-drop={dropId === id && dragId !== id}
              style={{ animationDelay: `${index * 45}ms` }}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dropId !== id) setDropId(id);
              }}
              onDragLeave={() => setDropId((d) => (d === id ? null : d))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId && dragId !== id) {
                  update((l) => ({ ...l, order: moveItem(order, dragId, order.indexOf(id)) }));
                }
                setDragId(null);
                setDropId(null);
              }}
            >
              <section className="cc-panel" aria-labelledby={`w-${id}`}>
                <div className="cc-panel__head">
                  <span
                    className="cc-widget__handle cc-no-print"
                    draggable
                    title="Drag to move"
                    aria-hidden="true"
                    onDragStart={(e) => {
                      setDragId(id);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', id);
                      const card = (e.currentTarget as HTMLElement).closest('.cc-widget');
                      if (card) e.dataTransfer.setDragImage(card, 24, 18);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setDropId(null);
                    }}
                  >
                    ⋮⋮
                  </span>
                  <h2 className="cc-panel__title" id={`w-${id}`}>
                    {w.title}
                  </h2>
                  {w.actions}
                  <span className="cc-no-print" style={{ display: 'inline-flex', gap: 2 }}>
                    <button
                      type="button"
                      className="cc-iconbtn"
                      aria-label={`Move ${w.title} earlier`}
                      disabled={index === 0}
                      onClick={() =>
                        update((l) => ({ ...l, order: moveItem(order, id, index - 1) }))
                      }
                    >
                      ◀
                    </button>
                    <button
                      type="button"
                      className="cc-iconbtn"
                      aria-label={`Move ${w.title} later`}
                      disabled={index === order.length - 1}
                      onClick={() =>
                        update((l) => ({ ...l, order: moveItem(order, id, index + 1) }))
                      }
                    >
                      ▶
                    </button>
                    <button
                      type="button"
                      className="cc-iconbtn"
                      aria-label={`Resize ${w.title} (now ${SIZE_LABEL[size]})`}
                      title="Resize"
                      onClick={() =>
                        update((l) => ({
                          ...l,
                          sizes: {
                            ...l.sizes,
                            [id]: SIZES[(SIZES.indexOf(size) + 1) % SIZES.length]!,
                          },
                        }))
                      }
                    >
                      {SIZE_LABEL[size]}
                    </button>
                    <button
                      type="button"
                      className="cc-iconbtn"
                      aria-label={collapsed ? `Expand ${w.title}` : `Collapse ${w.title}`}
                      aria-expanded={!collapsed}
                      onClick={() =>
                        update((l) => ({
                          ...l,
                          collapsed: collapsed
                            ? l.collapsed.filter((x) => x !== id)
                            : [...l.collapsed, id],
                        }))
                      }
                    >
                      {collapsed ? '▾' : '▴'}
                    </button>
                  </span>
                </div>
                <div className="cc-panel__body">{w.render()}</div>
              </section>
            </div>
          );
        })}
      </div>
    </>
  );
}
