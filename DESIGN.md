---
version: alpha
name: Field Pro command center
description: 'A dark, futuristic construction command center. Deep navy-black canvas (#050a12), glassy navy panels with thin cyan hairlines, cyan (#22d3ee) as the main accent with a cyan-to-blue gradient on primary buttons, violet (#a78bfa) as a second accent for review states, and amber (#fbbf24) for focus rings. Text is cool white (#e6f1ff) with blue-gray secondary text. Numbers, measurements and codes use a monospace font. The feel is a mission-control screen for field crews: dense, readable, glowing only where something needs attention.'

colors:
  canvas: '#050a12'
  canvas-2: '#08111d'
  surface: '#0d1726'
  surface-glass: 'rgba(12, 22, 36, 0.72)'
  surface-raised: '#122036'
  surface-sunken: '#060c15'
  hairline: 'rgba(94, 214, 255, 0.16)'
  hairline-strong: 'rgba(94, 214, 255, 0.38)'
  ink: '#e6f1ff'
  ink-muted: '#9fb3c8'
  primary: '#22d3ee'
  primary-hover: '#67e8f9'
  on-primary: '#031018'
  primary-gradient: 'linear-gradient(135deg, #22d3ee, #3b82f6)'
  blue: '#3b82f6'
  teal: '#2dd4bf'
  accent: '#a78bfa'
  focus: '#fbbf24'
  link: '#67e8f9'
  success-fg: '#a7f3c4'
  success-bg: 'rgba(74, 222, 128, 0.14)'
  warning-fg: '#fde68a'
  warning-bg: 'rgba(251, 191, 36, 0.14)'
  danger-fg: '#fecaca'
  danger-bg: 'rgba(248, 113, 113, 0.14)'
  info-fg: '#a9cbff'
  info-bg: 'rgba(59, 130, 246, 0.16)'
  review-fg: '#ddd0ff'
  review-bg: 'rgba(167, 139, 250, 0.16)'

typography:
  sans: 'var(--fl-font-sans) (system UI stack)'
  mono: 'ui-monospace, SFMono-Regular, JetBrains Mono, Menlo, Consolas, monospace'
  sizes:
    { xs: 0.75rem, sm: 0.875rem, md: 1rem, lg: 1.125rem, xl: 1.375rem, 2xl: 1.75rem, 3xl: 2.25rem }
  weights: { regular: 400, semibold: 600, bold: 700 }

spacing:
  {
    1: 0.25rem,
    2: 0.5rem,
    3: 0.75rem,
    4: 1rem,
    5: 1.25rem,
    6: 1.5rem,
    8: 2rem,
    10: 2.5rem,
    12: 3rem,
  }
radius: { sm: 4px, md: 8px, lg: 14px, pill: 999px }
shadow:
  glow: '0 0 0 1px rgba(34, 211, 238, 0.18), 0 0 24px rgba(34, 211, 238, 0.12)'
  glow-strong: '0 0 0 1px rgba(34, 211, 238, 0.45), 0 0 32px rgba(34, 211, 238, 0.28)'
  raised: '0 8px 28px rgba(0, 0, 0, 0.45)'
  modal: '0 24px 60px rgba(0, 0, 0, 0.6)'
motion:
  ease: 'cubic-bezier(0.22, 1, 0.36, 1)'
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)'
layout:
  sidebar-width: 15.5rem
  topbar-height: 3.75rem
  content-max-width: 96rem
---

# Field Pro design rules

Use this file when building or changing any screen in `apps/web`. The tokens above already exist as
CSS variables (`--cc-*` in `apps/web/src/app/command-center.css`, `--fl-*` in the design tokens). Use
the variables, never new hex values.

## Visual theme and atmosphere

- Dark command center for contractors in the field. Calm navy canvas, information in glassy panels.
- Glow means "look here": the active nav item, the primary action, a selected map shape, a live
  status. Do not glow decoration.
- Numbers matter most: totals, measurements, squares, linear feet and permit numbers use the mono
  font and line up in tables.

## Color roles

- Cyan is the one main accent: primary buttons, links, active states, selected geometry.
- Violet marks "needs review" (import queue, unverified fields). Amber is only for keyboard focus and
  warnings. Red only for errors and destructive actions. Green only for success and "paid".
- Status chips use the matching `*-bg` with `*-fg` text, never a solid bright fill.
- Body text is `ink`; help text, captions and units are `ink-muted`.

## Typography

- Page title: 2xl or 3xl, bold. Section titles: lg or xl, semibold. Body: md. Tables and captions: sm.
- Plain, short sentences in labels and help text. Say what a number counts.

## Components

- Buttons: `cc-btn` for normal, `cc-btn cc-btn--primary` (cyan-to-blue gradient, dark text) for the
  one main action per area. Destructive actions ask for confirmation.
- Panels and cards: `web-card` or `cc-*` panels on `surface` / `surface-glass` with a `hairline`
  border and radius lg.
- Forms: label above input, full width on phones, visible amber focus ring.
- Tables: horizontal scroll on small screens; money right-aligned; totals in mono.
- Empty states say what to do next and link to it. Errors use `ErrorNotice` with a retry.

## Layout

- Sidebar navigation plus top bar on desktop; one column on phones and tablets.
- Content max width 96rem. Spacing uses the 4px scale above.
- Every tool must work on laptop, iPad, iPhone and Android: tap targets at least 44px.

## Do and don't

- Do reuse existing components from `apps/web/src/components` before making new ones.
- Do keep one primary button per area.
- Don't add light-theme screens, new fonts, or new accent colors.
- Don't show invented data in mockups or empty states.
