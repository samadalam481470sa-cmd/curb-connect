/**
 * PLT-012 / PLT-019: Field Pro design tokens. This file is the single source of truth for token
 * values; `styles.css` mirrors them as CSS custom properties and `tokens.test.ts` fails if the two
 * drift or if any declared text/background pair falls below WCAG 2.2 AA contrast.
 *
 * The palette is original to Field Pro: a deep field-teal primary, a survey-amber accent and warm
 * neutral greys. Status tones never rely on color alone; every tone is paired with an icon or text.
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
    bg: '#f6f7f4',
    surface: '#ffffff',
    'surface-sunken': '#eceee9',
    'surface-raised': '#ffffff',
    text: '#14212b',
    'text-muted': '#4a5862',
    'text-inverse': '#ffffff',
    border: '#d3d9d5',
    'border-strong': '#68767f',
    primary: '#0f5b5c',
    'primary-hover': '#0a4647',
    'on-primary': '#ffffff',
    accent: '#e8a33d',
    'on-accent': '#1d1404',
    focus: '#9a4300',
    link: '#0d5657',
    overlay: 'rgba(12, 20, 24, 0.55)',
    'neutral-bg': '#eceeed',
    'neutral-fg': '#3b4750',
    'info-bg': '#e3edf9',
    'info-fg': '#1b4a87',
    'success-bg': '#e1f1e6',
    'success-fg': '#1c6235',
    'warning-bg': '#fcefd3',
    'warning-fg': '#714300',
    'danger-bg': '#fbe5e3',
    'danger-fg': '#9b1f19',
    'review-bg': '#eee8f7',
    'review-fg': '#553885',
    danger: '#b42318',
    'on-danger': '#ffffff',
    'measured-bg': '#e6f2f1',
    'measured-fg': '#0b4a4b',
    'suggested-bg': '#fdf3e1',
    'suggested-fg': '#6b4100',
    'assumption-bg': '#eef0f6',
    'assumption-fg': '#34406b',
    'approved-bg': '#e3f1e7',
    'approved-fg': '#1a5c32',
  },
  dark: {
    bg: '#0e1719',
    surface: '#152225',
    'surface-sunken': '#0b1214',
    'surface-raised': '#1c2c30',
    text: '#e7ecea',
    'text-muted': '#a9b6b2',
    'text-inverse': '#0e1719',
    border: '#2c3e42',
    'border-strong': '#7f938f',
    primary: '#62c6c0',
    'primary-hover': '#86d5d0',
    'on-primary': '#04201f',
    accent: '#f0b55e',
    'on-accent': '#1d1404',
    focus: '#ffb45c',
    link: '#7fd3ce',
    overlay: 'rgba(0, 0, 0, 0.65)',
    'neutral-bg': '#223236',
    'neutral-fg': '#d3dcd9',
    'info-bg': '#14294a',
    'info-fg': '#a9c8f2',
    'success-bg': '#123222',
    'success-fg': '#97dcb0',
    'warning-bg': '#3a2a0c',
    'warning-fg': '#f6cf85',
    'danger-bg': '#41171a',
    'danger-fg': '#f6aaa4',
    'review-bg': '#2c2142',
    'review-fg': '#cfb8f2',
    danger: '#f0857c',
    'on-danger': '#240605',
    'measured-bg': '#103033',
    'measured-fg': '#9fdcd7',
    'suggested-bg': '#36280e',
    'suggested-fg': '#f3cd88',
    'assumption-bg': '#1f2540',
    'assumption-fg': '#bcc6ef',
    'approved-bg': '#12301f',
    'approved-fg': '#9fdbb3',
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

/** Typography: system UI stack for the app (no web-font download on job sites). */
export const TYPOGRAPHY = {
  'font-sans':
    "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif",
  'font-mono': "ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace",
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
