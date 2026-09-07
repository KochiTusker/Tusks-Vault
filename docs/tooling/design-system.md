# Design system

Tusk's Vault and Tusk's Tomes share one visual language rendered in two
palettes. Tomes is the **cool** half: a spellbook on a violet-lit altar —
amethyst primary, ember accent. Vault is the **warm** half: a candlelit
scriptorium — **ember primary, amethyst accent**. Same OKLCH lightness and
chroma stops, same component shapes, same motion; only the hue emphasis is
flipped. Siblings, not twins.

Everything below is implemented in [src/index.css](../../src/index.css).

## The token contract

Component code never names a colour. It speaks the semantic vocabulary —
both the Vault-native names and the shadcn-style names the sibling project
uses — and the theme resolves them:

| Token | Vault resolves to | Tomes resolves to |
|---|---|---|
| `--color-primary` | ember `oklch(0.72 0.19 55)` | amethyst `oklch(0.65 0.22 295)` |
| `--color-accent` | amethyst | ember |
| `--color-background` | deep umber `oklch(0.11 0.025 50)` | void violet `oklch(0.11 0.04 285)` |
| `--color-card` / `--color-surface` | lifted umber | lifted violet |
| `--color-muted` / `--color-surface-elevated` | `oklch(0.20 0.05 50)` | `oklch(0.20 0.05 285)` |
| `--color-foreground` | warm parchment `oklch(0.94 0.025 90)` | the same — shared, so screenshots read as one book |
| `--color-muted-foreground` | warm `oklch(0.70 0.045 70)` | moonsilver `oklch(0.70 0.04 285)` |
| `--color-border` | ember | violet edge |
| `--color-ring` | light ember | amethyst |
| `--shadow-glow-*` | ember halo | amethyst halo |

Both names work everywhere: `bg-surface` and `bg-card` are the same value,
`text-foreground-strong` and bright text likewise. **A component ported from
the sibling compiles and renders correctly unchanged** — that is the whole
point of the alias block, and it is the property to preserve when adding
tokens: add the pair, not one spelling.

## The hue-swap rule (for porting hardcoded OKLCH)

Some sibling component CSS hardcodes OKLCH values rather than tokens. When
porting those rules:

- amethyst `oklch(L C 285–295)` → ember `oklch(L C 45–60)`
- ember `oklch(L C 45–55)` (their accent) → amethyst `oklch(L C 295)`
- violet base `oklch(L C 285)` → warm umber `oklch(L C≈0.7× 50)`
  (the umber ramp runs slightly lower chroma than the violet one — compare
  the `--color-ink-*` stack against their card stack before eyeballing)

**Keep L and C; move only the hue angle.** Matching lightness/chroma is what
makes the two apps feel like one book under two lamps. Better still, replace
the hardcoded value with the matching token — `var(--color-border)`,
`var(--shadow-glow-md)` — so the next port is free.

## Class-name register

Tomes names its vocabulary for the arcane; Vault names the same shapes for
the scriptorium. The mapping, for anyone porting either way:

| Tomes | Vault | Shape |
|---|---|---|
| `.arcane-card` | `.scriptorium-card` | themed card surface: gradient, rim, entrance rise, hover glow |
| `.spell-glow` | `.ember-glow` | pulsing charged halo utility |
| `.wisp-veil` (+ `.wisp-ember`, `.wisp-silver`) | `.mote-veil` (+ `.mote-cool`, `.mote-bright`) | drifting ambient orbs, additive blend |
| `.arcane-sigil` | `.seal-sigil` | corner sigil that blooms in/out on a long cycle |
| `.arcane-circle` | `.candle-halo` | slow-rotating ring behind the brand mark |
| `.ember-field` | `.ember-field` | rising spark layer — shared name; it is ember in both |
| `.brand-title` / `.brand-subtitle` | same | header wordmark treatment |
| `.rune-divider`, `.ornament-shimmer`, `.rune-shimmer` | same | dividers and drifting seams |
| `.tab-bg[data-tab=…]` | same | per-tab backdrop tint |
| `.docs-alert-*` | same | five-hue callout blocks in rendered markdown |
| `.progress-sheen` | same | moving highlight across a filled bar |
| `data-pipeline="running"` on `<html>` | `data-thinking="true"` on `<html>` | run-reactive ambience: chrome brightens while work happens |

Vault-only (keep; do not replace with ports): `.hearth-*` (the fireplace),
`.candle-flame`, `.illuminated`, `.parchment`, `.gold-hover`,
`details.docs-section`.

## Motion rules

- Ambient layers are decoration only: fixed-position, `aria-hidden`,
  `pointer-events: none`, no layout shifts, nothing that moves under the
  pointer.
- Every bespoke animation bows out under `prefers-reduced-motion: reduce` —
  extend the single existing block in index.css, never add a second one.
  Painted glow may remain (the hearth still lights the room); movement must
  stop.
- Entrance animations run once and short (`card-rise` 320ms, `tab-fade-in`
  260ms). Continuous animations are slow and low-amplitude — they read as a
  live room, not a busy screen.
- Programmatic view changes go through `transitionOrJustDo()`
  ([src/lib/viewTransition.ts](../../src/lib/viewTransition.ts)) — the update
  always runs; only the cross-fade is conditional.

## Primitives

`src/components/ui/` carries the shared API surface, hand-rolled (no Radix,
no CVA — Vault ships fewer dependencies than its sibling by design):

- `Card` / `CardHeader` / `CardTitle` / `CardDescription` / `CardContent` / `CardFooter`
- `Button` — variants `default | secondary | ghost | outline | destructive`,
  sizes `sm | default | lg | icon`; `data-slot="primary-cta"` /
  `"ember-cta"` opt into the charged-glow CSS treatments
- `Input`, `Label`
- `InfoHint` — the click-to-open ⓘ that keeps settings copy to one line
- `Tabs` / `TabsList` / `TabsTrigger` / `TabsContent` — Vault's original;
  the sibling ported it back for the spring-loaded active chip
- `PageSection` / `PageSectionNav` — collapsible section groups + sticky
  jump rail for long settings-style pages
