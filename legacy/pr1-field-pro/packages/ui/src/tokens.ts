/**
 * PLT-012 / PLT-019: Field Pro design tokens. This file is the single source of truth for token
 * values; `styles.css` mirrors them as CSS custom properties and `tokens.test.ts` fails if the two
 * drift or if any declared text/background pair falls below WCAG 2.2 AA contrast.
 *
 * Enterprise construction palette: cool white surfaces, graphite neutrals, deep navy primary and
 * carefully placed blue accents. Status tones never rely on color alone; every tone is paired with
 * an icon or text.
 */

export type ThemeName = 'light' | 'dark';

/** Semantic color roles. Components use these names only, never raw hex values. */
export const COLOR_ROLES = [
  'bg',
  'surface',
  'surface-sunken',
  'surface-raised',
  'text',
  'text-muted',
  'text-inverse',
  'border',
  'border-strong',
  'primary',
  'primary-hover',
  'on-primary',
  'accent',
  'on-accent',
  'focus',
  'link',
  'overlay',
  'neutral-bg',
  'neutral-fg',
  'info-bg',
  'info-fg',
  'success-bg',
  'success-fg',
  'warning-bg',
  'warning-fg',
  'danger-bg',
  'danger-fg',
  'review-bg',
  'review-fg',
  'danger',
  'on-danger',
  'measured-bg',
  'measured-fg',
  'suggested-bg',
  'suggested-fg',
  'assumption-bg',
  'assumption-fg',
  'approved-bg',
  'approved-fg',
] as const;

export type ColorRole = (typeof COLOR_ROLES)[number];

export const COLORS: Record<ThemeName, Record<ColorRole, string>> = {
  light: {
    bg: '#f3f5f8',
    surface: '#ffffff',
    'surface-sunken': '#e8edf3',
    'surface-raised': '#ffffff',
    text: '#121a26',
    'text-muted': '#4b5568',
    'text-inverse': '#ffffff',
    border: '#d5dde8',
    'border-strong': '#5b6b82',
    primary: '#13294b',
    'primary-hover': '#0e1f3a',
    'on-primary': '#ffffff',
    accent: '#1d4ed8',
    'on-accent': '#ffffff',
    focus: '#1d4ed8',
    link: '#1e40af',
    overlay: 'rgba(10, 18, 32, 0.55)',
    'neutral-bg': '#e9eef5',
    'neutral-fg': '#334155',
    'info-bg': '#dbeafe',
    'info-fg': '#1e3a8a',
    'success-bg': '#dcfce7',
    'success-fg': '#166534',
    'warning-bg': '#fef3c7',
    'warning-fg': '#92400e',
    'danger-bg': '#fee2e2',
    'danger-fg': '#991b1b',
    'review-bg': '#ede9fe',
    'review-fg': '#5b21b6',
    danger: '#b91c1c',
    'on-danger': '#ffffff',
    'measured-bg': '#e0e7ff',
    'measured-fg': '#1e3a8a',
    'suggested-bg': '#eff6ff',
    'suggested-fg': '#1e40af',
    'assumption-bg': '#eef2ff',
    'assumption-fg': '#312e81',
    'approved-bg': '#dcfce7',
    'approved-fg': '#14532d',
  },
  dark: {
    bg: '#0b1220',
    surface: '#121a2b',
    'surface-sunken': '#080e18',
    'surface-raised': '#182338',
    text: '#e8eef8',
    'text-muted': '#a8b4c8',
    'text-inverse': '#0b1220',
    border: '#2a3852',
    'border-strong': '#8b9bb5',
    primary: '#93c5fd',
    'primary-hover': '#bfdbfe',
    'on-primary': '#0b1220',
    accent: '#60a5fa',
    'on-accent': '#0b1220',
    focus: '#93c5fd',
    link: '#93c5fd',
    overlay: 'rgba(0, 0, 0, 0.65)',
    'neutral-bg': '#1c2740',
    'neutral-fg': '#d5deec',
    'info-bg': '#172554',
    'info-fg': '#bfdbfe',
    'success-bg': '#14532d',
    'success-fg': '#bbf7d0',
    'warning-bg': '#451a03',
    'warning-fg': '#fde68a',
    'danger-bg': '#450a0a',
    'danger-fg': '#fecaca',
    'review-bg': '#2e1065',
    'review-fg': '#ddd6fe',
    danger: '#fca5a5',
    'on-danger': '#450a0a',
    'measured-bg': '#1e3a8a',
    'measured-fg': '#dbeafe',
    'suggested-bg': '#1e3a8a',
    'suggested-fg': '#bfdbfe',
    'assumption-bg': '#312e81',
    'assumption-fg': '#c7d2fe',
    'approved-bg': '#14532d',
    'approved-fg': '#bbf7d0',
  },
};

/**
 * Text/background pairs that components actually render, with the WCAG 2.2 minimum that applies:
 * 4.5 for body text (1.4.3), 3 for large text and for UI component boundaries/focus (1.4.11).
 */
export const CONTRAST_PAIRS: ReadonlyArray<{
  fg: ColorRole;
  bg: ColorRole;
  min: 4.5 | 3;
  use: string;
}> = [
  { fg: 'text', bg: 'bg', min: 4.5, use: 'body text on page' },
  { fg: 'text', bg: 'surface', min: 4.5, use: 'body text on cards' },
  { fg: 'text', bg: 'surface-sunken', min: 4.5, use: 'text in sunken wells' },
  { fg: 'text', bg: 'surface-raised', min: 4.5, use: 'text in dialogs and sheets' },
  { fg: 'text-muted', bg: 'bg', min: 4.5, use: 'hints on page' },
  { fg: 'text-muted', bg: 'surface', min: 4.5, use: 'hints on cards' },
  { fg: 'text-muted', bg: 'surface-sunken', min: 4.5, use: 'hints in sunken wells' },
  { fg: 'link', bg: 'surface', min: 4.5, use: 'links on cards' },
  { fg: 'link', bg: 'bg', min: 4.5, use: 'links on page' },
  { fg: 'on-primary', bg: 'primary', min: 4.5, use: 'primary button label' },
  { fg: 'on-primary', bg: 'primary-hover', min: 4.5, use: 'primary button hover label' },
  { fg: 'on-accent', bg: 'accent', min: 4.5, use: 'accent badge label' },
  { fg: 'on-danger', bg: 'danger', min: 4.5, use: 'danger button label' },
  { fg: 'primary', bg: 'surface', min: 4.5, use: 'secondary button label' },
  { fg: 'primary', bg: 'bg', min: 4.5, use: 'ghost button label' },
  { fg: 'danger', bg: 'surface', min: 4.5, use: 'field error text' },
  { fg: 'border-strong', bg: 'surface', min: 3, use: 'input boundary (1.4.11)' },
  { fg: 'border-strong', bg: 'bg', min: 3, use: 'input boundary on page (1.4.11)' },
  { fg: 'focus', bg: 'bg', min: 3, use: 'focus ring on page (2.4.13)' },
  { fg: 'focus', bg: 'surface', min: 3, use: 'focus ring on cards (2.4.13)' },
  { fg: 'focus', bg: 'surface-raised', min: 3, use: 'focus ring in dialogs (2.4.13)' },
  { fg: 'neutral-fg', bg: 'neutral-bg', min: 4.5, use: 'neutral status pill' },
  { fg: 'info-fg', bg: 'info-bg', min: 4.5, use: 'info status / notice' },
  { fg: 'success-fg', bg: 'success-bg', min: 4.5, use: 'success status / notice' },
  { fg: 'warning-fg', bg: 'warning-bg', min: 4.5, use: 'warning status / notice' },
  { fg: 'danger-fg', bg: 'danger-bg', min: 4.5, use: 'danger status / notice' },
  { fg: 'review-fg', bg: 'review-bg', min: 4.5, use: 'review-required status' },
  { fg: 'measured-fg', bg: 'measured-bg', min: 4.5, use: 'measured input section' },
  { fg: 'suggested-fg', bg: 'suggested-bg', min: 4.5, use: 'suggested quantity section' },
  { fg: 'assumption-fg', bg: 'assumption-bg', min: 4.5, use: 'pricing assumption section' },
  { fg: 'approved-fg', bg: 'approved-bg', min: 4.5, use: 'approved output section' },
];

/** Typography: IBM Plex for a durable engineering feel (loaded by the web app; system fallbacks). */
export const TYPOGRAPHY = {
  'font-sans':
    "'IBM Plex Sans', 'Segoe UI', system-ui, -apple-system, sans-serif",
  'font-mono': "'IBM Plex Mono', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  'font-size-xs': '0.75rem',
  'font-size-sm': '0.875rem',
  'font-size-md': '1rem',
  'font-size-lg': '1.125rem',
  'font-size-xl': '1.375rem',
  'font-size-2xl': '1.75rem',
  'font-size-3xl': '2.25rem',
  'line-height-tight': '1.25',
  'line-height-normal': '1.5',
  'font-weight-regular': '400',
  'font-weight-semibold': '600',
  'font-weight-bold': '700',
} as const;

/** 4px spacing grid. */
export const SPACING = {
  'space-0': '0',
  'space-1': '0.25rem',
  'space-2': '0.5rem',
  'space-3': '0.75rem',
  'space-4': '1rem',
  'space-5': '1.25rem',
  'space-6': '1.5rem',
  'space-8': '2rem',
  'space-10': '2.5rem',
  'space-12': '3rem',
} as const;

export const RADII = {
  'radius-sm': '4px',
  'radius-md': '8px',
  'radius-lg': '12px',
  'radius-pill': '999px',
} as const;

export const ELEVATION = {
  'shadow-1': '0 1px 2px rgba(12, 20, 24, 0.08), 0 1px 1px rgba(12, 20, 24, 0.04)',
  'shadow-2': '0 4px 12px rgba(12, 20, 24, 0.12), 0 1px 3px rgba(12, 20, 24, 0.08)',
  'shadow-3': '0 16px 40px rgba(12, 20, 24, 0.2), 0 4px 12px rgba(12, 20, 24, 0.1)',
} as const;

/**
 * Focus and touch targets. WCAG 2.2: 2.4.11 focus not obscured, 2.4.13 focus appearance
 * (>= 2px, >= 3:1), 2.5.8 target size (24px minimum; Field Pro uses 44px for gloved field use).
 */
export const INTERACTION = {
  'focus-ring-width': '3px',
  'focus-ring-offset': '2px',
  'target-min': '44px',
  'target-min-compact': '32px',
  'duration-fast': '120ms',
  'duration-normal': '200ms',
} as const;

/**
 * Stacking order. PLT-012 safety rule: risk notices (permit, utility, right-of-way, calibration)
 * sit ABOVE floating controls so a dense mobile capture screen can never cover them, and the
 * layout reserves space for the bottom navigation so content never scrolls underneath it.
 */
export const LAYERS = {
  'z-base': '0',
  'z-sticky': '10',
  'z-floating': '20',
  'z-risk': '30',
  'z-nav': '40',
  'z-overlay': '50',
  'z-dialog': '60',
  'z-toast': '70',
} as const;

export const LAYOUT = {
  'sidebar-width': '16rem',
  'topbar-height': '3.5rem',
  'bottom-nav-height': '4rem',
  'content-max-width': '80rem',
  'breakpoint-phone-max': '40rem',
} as const;

/** All non-color tokens, flattened, as written to `:root` in styles.css (prefixed `--fl-`). */
export const STATIC_TOKENS: Record<string, string> = {
  ...TYPOGRAPHY,
  ...SPACING,
  ...RADII,
  ...ELEVATION,
  ...INTERACTION,
  ...LAYERS,
  ...LAYOUT,
};

/** CSS custom property name for a token, e.g. `cssVar('primary')` -> `var(--fl-color-primary)`. */
export function cssVar(role: ColorRole): string {
  return `var(--fl-color-${role})`;
}

// --- WCAG contrast math (used by tests and available to theme tooling) ---------------------------

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a #rrggbb color (WCAG 2.x definition). */
export function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`Expected #rrggbb, got ${hex}`);
  const [r, g, b] = [match[1], match[2], match[3]].map((h) => channel(Number.parseInt(h!, 16)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG contrast ratio between two opaque #rrggbb colors, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
