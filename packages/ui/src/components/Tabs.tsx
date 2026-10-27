'use client';

import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../internal/cx';
import { useControllableState } from '../internal/useControllableState';

export interface TabItem<V extends string = string> {
  value: V;
  label: ReactNode;
  panel: ReactNode;
  disabled?: boolean;
  /** Small count or status next to the label, e.g. number of review notes. */
  badge?: ReactNode;
}

export interface TabsProps<V extends string = string> {
  items: ReadonlyArray<TabItem<V>>;
  value?: V;
  defaultValue?: V;
  onValueChange?: (value: V) => void;
  /** Accessible name of the tab list. */
  label: string;
  className?: string;
}

/**
 * WAI-ARIA tabs with automatic activation: Left/Right (wrapping), Home/End, roving tabindex.
 * Inactive panels stay mounted but `hidden`, so form state inside them is kept.
 */
export function Tabs<V extends string = string>({
  items,
  value,
  defaultValue,
  onValueChange,
  label,
  className,
}: TabsProps<V>) {
  const id = useId();
  const firstEnabled = items.find((i) => !i.disabled)?.value;
  const [current, setCurrent] = useControllableState<V>(
    value,
    (defaultValue ?? firstEnabled ?? items[0]?.value) as V,
    onValueChange,
  );
  const refs = useRef(new Map<V, HTMLButtonElement>());

  const onKeyDown = (event: KeyboardEvent) => {
    const enabled = items.filter((i) => !i.disabled);
    if (enabled.length === 0) return;
    const index = enabled.findIndex((i) => i.value === current);
    let next: TabItem<V> | undefined;
    if (event.key === 'ArrowRight') next = enabled[(index + 1) % enabled.length];
    else if (event.key === 'ArrowLeft')
      next = enabled[(index - 1 + enabled.length) % enabled.length];
    else if (event.key === 'Home') next = enabled[0];
    else if (event.key === 'End') next = enabled[enabled.length - 1];
    if (!next) return;
    event.preventDefault();
    setCurrent(next.value);
    refs.current.get(next.value)?.focus();
  };

  return (
    <div className={cx('fl-tabs', className)}>
      <div role="tablist" aria-label={label} className="fl-tabs__list" onKeyDown={onKeyDown}>
        {items.map((item) => {
          const selected = item.value === current;
          return (
            <button
              key={item.value}
              ref={(el) => {
                if (el) refs.current.set(item.value, el);
                else refs.current.delete(item.value);
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${item.value}`}
              aria-selected={selected}
              aria-controls={`${id}-panel-${item.value}`}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              className="fl-tabs__tab"
              onClick={() => setCurrent(item.value)}
            >
              {item.label}
              {item.badge !== undefined && <span className="fl-tabs__badge">{item.badge}</span>}
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.value}
          role="tabpanel"
          id={`${id}-panel-${item.value}`}
          aria-labelledby={`${id}-tab-${item.value}`}
          hidden={item.value !== current}
          tabIndex={0}
          className="fl-tabs__panel"
        >
          {item.panel}
        </div>
      ))}
    </div>
  );
}
