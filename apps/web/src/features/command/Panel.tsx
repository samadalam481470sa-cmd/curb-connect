import type { ReactNode } from 'react';

/** Glass instrument panel with a mono uppercase title bar (command-center primitive). */
export function Panel({
  title,
  actions,
  children,
  className,
  bodyClassName,
  id,
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section className={`cc-panel ${className ?? ''}`} aria-labelledby={headingId}>
      <div className="cc-panel__head">
        <h2 className="cc-panel__title" id={headingId}>
          {title}
        </h2>
        {actions}
      </div>
      <div className={`cc-panel__body ${bodyClassName ?? ''}`}>{children}</div>
    </section>
  );
}

export function Kpi({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  accent?: boolean;
}) {
  return (
    <div className={accent ? 'cc-kpi cc-kpi--accent' : 'cc-kpi'}>
      <div className="cc-kpi__label">{label}</div>
      <div className="cc-kpi__value">
        {value}
        {unit && <small>{unit}</small>}
      </div>
    </div>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className="cc-field">
      <span>
        {label}
        {suffix ? ` (${suffix})` : ''}
      </span>
      <input
        className="cc-input"
        type="number"
        inputMode="decimal"
        value={Number.isFinite(value) ? value : ''}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = e.currentTarget.valueAsNumber;
          onChange(Number.isFinite(n) ? n : 0);
        }}
      />
    </label>
  );
}

export function SelectField<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <label className="cc-field">
      <span>{label}</span>
      <select
        className="cc-input"
        value={String(value)}
        onChange={(e) => {
          const hit = options.find((o) => String(o.value) === e.currentTarget.value);
          if (hit) onChange(hit.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usd0 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
export const money = (n: number) => usd.format(n);
export const money0 = (n: number) => usd0.format(n);
export const num = (n: number, digits = 1) =>
  n.toLocaleString('en-US', { maximumFractionDigits: digits });

/** Low / base / high estimate band. */
export function EstimateBand({ low, base, high }: { low: number; base: number; high: number }) {
  const max = Math.max(high * 1.15, 1);
  const pos = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  return (
    <div
      className="cc-band"
      role="img"
      aria-label={`Low ${money0(low)}, base ${money0(base)}, high ${money0(high)}`}
    >
      <div className="cc-band__track" />
      <div
        className="cc-band__range"
        style={{ left: pos(low), width: `calc(${pos(high)} - ${pos(low)})` }}
      />
      {(
        [
          ['LOW', low],
          ['BASE', base],
          ['HIGH', high],
        ] as const
      ).map(([label, v]) => (
        <div key={label} className="cc-band__mark" style={{ left: pos(v) }}>
          {label}
          <b>{money0(v)}</b>
        </div>
      ))}
    </div>
  );
}
