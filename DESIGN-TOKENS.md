# Rakshana — Design Tokens

Source of truth: `src/app/globals.css`. This file documents intent and DON'Ts.
The visual contract is on the `/design-system` page — every new component
must appear there before it ships elsewhere.

## Palette philosophy

Rakshana is a **trustee-and-accountant** product. The aesthetic is calm,
paper-like, and slightly editorial — not a SaaS dashboard, not a fintech
gradient. Think "annual report, well-set." Saffron is an accent, not a
brand colour.

### Light mode

| Token                | Value      | Use                                      |
|----------------------|------------|------------------------------------------|
| `--canvas`           | `#FAF8F3`  | Page background, warm paper              |
| `--surface`          | `#FFFFFF`  | Cards, dialogs, modal panes              |
| `--surface-sunken`   | `#F4F1EA`  | Sidebar, secondary surfaces, table headers |
| `--ink`              | `#1A1814`  | Primary text                             |
| `--ink-muted`        | `#5C5852`  | Secondary text                           |
| `--ink-subtle`       | `#8A857E`  | Tertiary text, helper labels             |
| `--primary`          | `#1A6E5A`  | Trust green — primary actions, links     |
| `--primary-hover`    | `#155A4A`  | Hover state for primary buttons          |
| `--primary-soft`     | `#E8F0ED`  | Primary tinted backgrounds, soft chips   |
| `--accent`           | `#C26B2A`  | Saffron — sparingly, never primary       |
| `--accent-soft`      | `#FBF1E5`  | Accent tinted backgrounds, in-kind chip  |
| `--success`          | `#2F7D5E`  | Approved, saved, filed                   |
| `--warning`          | `#B8761E`  | Action needed, upcoming due date         |
| `--danger`           | `#B5443A`  | Errors, cancelled, destructive           |
| `--info`             | `#2F5D7D`  | Cheque mode, informational toasts        |
| `--border`           | `#E8E3D9`  | Default dividers, input borders          |
| `--border-strong`    | `#D4CEC2`  | Heavy dividers, receipt card frame       |

### Dark mode

Auto-applied via `class="dark"` on `<html>` (next-themes). Same semantic
slots, deeper paper tones. See `globals.css :root.dark { … }`.

### Decision history

- Accent is `#C26B2A` (rust-saffron) in Phase 0; the PRD draft originally
  proposed `#D97706`. The muted value sits better on the `#FAF8F3` canvas.
- Primary `#1A6E5A` was approved as the trust-green identity colour for
  the Rakshana brand.

## Typography

- **Fraunces** (display) — H1 / H2, hero copy, receipt headers. Uses the
  `opsz` axis: 30–48 for headings, 24 for sub-display.
- **Inter Tight** (body) — H3 and below, body, UI text. Letter-spacing
  tightens slightly on H3.
- **JetBrains Mono** (mono) — money, receipt numbers, PAN/GSTIN, UTRs.
  Always with `tabular-nums lining-nums` so columns align.

Apply via Tailwind classes:

- `font-display` → Fraunces
- `font-sans` (default) → Inter Tight
- `font-mono` → JetBrains Mono

## Radii & shadows

| Token         | Value    |
|---------------|----------|
| `--radius-sm` | `4px`    |
| `--radius`    | `6px`    |
| `--radius-md` | `8px`    |
| `--radius-lg` | `12px`   |
| `--shadow-sm` | `0 1px 2px rgba(26, 24, 20, 0.04)`   |
| `--shadow-md` | `0 4px 12px rgba(26, 24, 20, 0.06)`  |
| `--shadow-lg` | `0 12px 32px rgba(26, 24, 20, 0.08)` |

Shadows are subtle — Rakshana isn't a glassy product.

## Component-level rules

### Buttons

- Primary: `--primary` bg, `#FAF8F3` text. Hover → `--primary-hover`. No
  gradient. No shadow at rest.
- Secondary (shadcn `secondary`): `--surface-sunken` bg, `--ink` text.
- Outline / ghost / destructive: shadcn defaults; destructive uses
  `--danger`.

### Inputs

- Default: `--surface` bg, `--border` ring 1px.
- Focus: `--primary` ring, 2px (handled by shadcn focus-visible).
- Error: `--danger` ring; helper text in `--danger`.
- Disabled: 50% opacity; `--ink-subtle` text.

### Tables

- Header row: `--surface-sunken` bg, `--ink-muted` text.
- Body rows: alternating none for now; hover → `--primary-soft`.
- Money columns: `font-mono`, `tabular-nums`, right-aligned.

### Mode chips (donation modes)

| Mode       | Background        | Foreground       |
|------------|-------------------|------------------|
| Cash       | `--warning` / 12  | `--warning`      |
| Cheque     | `--info` / 12     | `--info`         |
| NEFT/RTGS  | `--success` / 14  | `--success`      |
| UPI        | `--primary-soft`  | `--primary`      |
| In-kind    | `--accent-soft`   | `--accent`       |

### Empty states

Use the pattern: short headline + one-sentence body + a primary CTA, no
hero illustration. Example: "No donations yet. Record your first donation →".

## DON'Ts

- ❌ No purple gradients. No neon. No glassmorphism.
- ❌ No emoji in UI (only in test/dev tooling output).
- ❌ Never use `font-mono` for prose — only for monetary values, IDs, and
  codes.
- ❌ Never apply a drop-shadow on body text — shadows are reserved for
  surfaces that sit "above the paper" (modals, popovers, receipt card).
- ❌ Never hardcode hex in component code. Use the CSS variable.
- ❌ Never use the saffron accent as a primary action colour. It's an
  accent for in-kind chips, badges, and the occasional callout.

## Adding a new token

1. Add the variable to both `:root` and `.dark` in `globals.css`.
2. If components should consume it via Tailwind, alias it under
   `@theme inline { --color-foo: var(--foo); }`.
3. Add a row to the swatch grid in `src/app/design-system/page.tsx`.
4. Update this file with the value and intended use.
