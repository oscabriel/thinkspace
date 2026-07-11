<!-- Tokens applied to packages/ui/src/styles/globals.css (light + dark) on 2026-07-05; the run card lives in packages/ui/src/components/run-card.tsx with a dev gallery at /design/run-card. Re-run /impeccable document (scan mode) once more components land, to capture drift and generate the .impeccable/design.json sidecar. -->

---
name: Thinkspace
description: A calm, multi-tenant workspace where channels are bespoke agents and deep work happens in threads.
colors:
  paper: "oklch(1 0 0)"
  panel: "oklch(0.972 0.006 230)"
  ink: "oklch(0.19 0.012 230)"
  ink-muted: "oklch(0.48 0.022 230)"
  hairline: "oklch(0.9 0.008 230)"
  cobalt: "oklch(0.45 0.086 230)"
  cobalt-text-on: "oklch(0.985 0 0)"
  brass: "oklch(0.62 0.115 70)"
  moss: "oklch(0.55 0.12 150)"
  claret: "oklch(0.58 0.22 27)"
  night: "oklch(0.16 0.012 230)"
  night-panel: "oklch(0.21 0.014 230)"
  night-ink: "oklch(0.93 0.008 230)"
  night-ink-muted: "oklch(0.68 0.02 230)"
  night-cobalt: "oklch(0.75 0.09 230)"
typography:
  # Compact component scale — the blessed tighter scale carried by the semantic
  # tokens in packages/ui/src/styles/globals.css (--text-headline / title / body
  # / label / meta) and used by the packages/ui primitives. See §3.
  headline:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.43
  body:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  label:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.33
  meta:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.33
  code:
    fontFamily: "ui-monospace, 'JetBrains Mono', monospace"
    fontSize: "0.875em"
    fontWeight: 400
  # Content / prose scale — long-form reading, distinct from the compact scale
  # above. The run card is the exemplar (run-card.tsx) and an intentional
  # exception to the component scale; not tokenized in globals.css.
  proseBody:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.cobalt-text-on}"
    rounded: "{rounded.pill}"
    padding: "8px 20px"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "8px 20px"
  button-destructive-text:
    backgroundColor: "transparent"
    textColor: "{colors.claret}"
    rounded: "{rounded.pill}"
    padding: "8px 12px"
  run-card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "20px 24px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "10px 14px"
  code-chip:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "2px 6px"
---

# Design System: Thinkspace

## 1. Overview

**Creative North Star: "The Reading Room"**

A university reading room after hours: quiet daylight, deep ink, one considered cobalt.
Thinkspace is a place for sustained thought, and the interface behaves like the room, not
the conversation — it holds the work, keeps the light even, and never raises its voice. The
chrome is neutral and cool-tinted; the only things allowed to carry color are actions a
human can take and states a run can be in. Agents are colleagues here, not characters:
their presence is legible (name, initial-glyph avatar, activity state), never costumed.

This system explicitly rejects gamer density, terminal cosplay, mascot playfulness, stark
sharp-angled brutalism, colorful gradients, and decorative serifs (see PRODUCT.md
anti-references). It borrows three things from hilos.sh and nothing else: agents rendered
as first-class members, agent output as a structured reviewable card with decisive human
actions, and quiet light chrome that lets the content carry the meaning.

**Key Characteristics:**
- Soft geometry everywhere — nothing sharper than 6px, primary actions are pills.
- Pure white content surface; cool-tinted panel layer for sidebar and rails.
- One brand blue (cobalt) for action and selection; brass strictly for "working".
- Flat at rest; depth only when something floats.
- Motion states, never choreography.

## 2. Colors

Quiet cool neutrals around a single deep cobalt; warmth appears only when an agent is
working.

### Primary
- **Deep Cobalt** (oklch(0.45 0.086 230)): the one brand color. Primary buttons, current
  selection, links, focus rings, the active channel in the sidebar. Always carries white
  text (oklch(0.985 0 0)) when filled. In dark mode it lightens to **Night Cobalt**
  (oklch(0.75 0.09 230)) and carries dark ink text instead.

### Secondary
- **Brass** (oklch(0.62 0.115 70)): the working color. Run-in-progress indicators,
  "agent is thinking" states, schedule-pending badges. White text when filled. Never used
  decoratively; if nothing is running, no brass is visible on screen.

### Tertiary (semantic states)
- **Moss** (oklch(0.55 0.12 150)): success — completed runs, presence, approvals.
- **Claret** (oklch(0.58 0.22 27)): destructive/failed — failed runs, reject actions,
  delete confirmations. As text-only for secondary destructive actions.

### Neutral
- **Paper** (oklch(1 0 0)): the content surface. Pure white, no hidden warmth — the
  calm comes from the cool panel tint and soft geometry, not a tinted body.
- **Panel** (oklch(0.972 0.006 230)): sidebar, toolbars, rails, quote blocks, code-chip
  backgrounds. The second neutral layer, tinted faintly toward cobalt's hue.
- **Ink** (oklch(0.19 0.012 230)): body text. ~15:1 on Paper.
- **Ink Muted** (oklch(0.48 0.022 230)): timestamps, metadata, secondary labels. ≥4.5:1
  on Paper — muted means quieter, never illegible.
- **Hairline** (oklch(0.9 0.008 230)): borders and dividers, always 1px.
- **Dark set**: Night (oklch(0.16 0.012 230)) bg, Night Panel (oklch(0.21 0.014 230)),
  Night Ink (oklch(0.93 0.008 230)), Night Ink Muted (oklch(0.68 0.02 230)); borders
  become white at 10% alpha. Dark mode is first-class, tuned per-token, never inverted.

### Named Rules
**The Quiet Chrome Rule.** Color covers ≤10% of any screen. Cobalt means "you can act
here or you are here"; brass means "an agent is working"; moss and claret are verdicts.
Everything else is neutral. A screen with no possible action and no running agent is
entirely grayscale-plus-tint.

**The No-Gradient Rule.** No color gradients, anywhere, ever. Not in buttons, not in
avatars, not in empty states. Flat fills only.

## 3. Typography

**Display Font:** none — this product has no display register.
**Body Font:** Inter Variable (system-ui, sans-serif fallback)
**Label/Mono Font:** ui-monospace / JetBrains Mono — code blocks and path chips ONLY.

**Character:** One quiet humanist sans doing every job through weight and size, never
through novelty. The one family works in two registers: a **compact component scale** that
keeps packages/ui primitives dense and legible, and a **content/prose scale** for
long-form reading. Hierarchy is tight (fixed rem — no fluid clamp in product UI). Within
the generic UI primitives the ceiling is a 600-weight 1rem title; the loudest type on a
screen — a 600-weight page heading up to 1.25rem — belongs to page-level headers *outside*
the generic primitives (channel pages, dialog titles), never to a card, button, or bubble.

### Compact component scale
The blessed working scale for packages/ui primitives — buttons, cards, chat bubbles,
labels, empty states. Deliberately tighter than the prose scale so dense surfaces stay
scannable, and carried by semantic tokens (`--text-headline`, `--text-title`,
`--text-body`, `--text-label`, `--text-meta` in globals.css) rather than raw utility sizes
repeated per component.
- **Headline** (600, 1rem, 1.4, -0.01em): the ceiling for a generic primitive, and the
  size page-level headings settle at. Dialog titles, channel names.
- **Title** (600, 0.875rem, 1.43): card titles, empty-state titles, section heads.
- **Body** (400, 0.875rem, 1.43; 1.6 relaxed for descriptions): readable text inside
  compact components — empty-state copy, card content.
- **Label** (500, 0.75rem, 1.33): buttons, form labels, sidebar items, tabs, message
  author names.
- **Meta** (400, 0.75rem, 1.33, Ink Muted): timestamps, counts, "2 replies", card
  descriptions, run duration.
- **Code** (mono, 0.875em): fenced code blocks and inline path/branch chips on Panel bg.

### Content / prose scale
Long-form reading register — thread comments and run output, where line length and rhythm
matter more than density.
- **Prose body** (400, 0.9375rem, 1.6): comments and run-card prose. Max width 70ch in
  threads. The **run card is the exemplar and an intentional exception** to the compact
  scale: its body renders at 0.9375rem/1.6 (`run-card.tsx:99-108`) and its section
  headings and status at 0.8125rem (`run-card.tsx:89`, `:139`) — a deliberately roomier
  register for reviewable agent output, not a candidate for the compact tokens above.

### Named Rules
**The Mono-Means-Code Rule.** Monospace appears only inside code blocks and file-path /
branch / model-id chips. Never in headings, labels, buttons, timestamps, or numerals.

**The No-Shouting Rule.** No uppercase-tracked eyebrow labels, no letter-spacing wider
than 0.02em, nothing bolder than 600. Emphasis comes from weight and ink, not volume.

## 4. Elevation

Flat by default. Depth is conveyed by the two-layer neutral system (Panel below, Paper
above) and 1px Hairline borders — a run card sits on Paper inside a Hairline border, not
under a shadow. Shadows exist only for things that genuinely float above the page.

### Shadow Vocabulary
- **floating** (`box-shadow: 0 4px 16px oklch(0.19 0.012 230 / 0.08), 0 1px 3px
  oklch(0.19 0.012 230 / 0.06)`): popovers, dropdowns, command palette.
- **modal** (`box-shadow: 0 12px 40px oklch(0.19 0.012 230 / 0.16)`): dialogs only.

### Named Rules
**The Flat-At-Rest Rule.** Nothing in the document flow has a shadow. If an element has a
shadow, it must be dismissible and layered above the page. Hover never adds shadows —
hover is a background tint shift.

## 5. Components

Soft, consistent, state-complete. Every interactive component ships default, hover, focus,
active, disabled, loading, and (where applicable) error — no half-vocabularies.

### Buttons
- **Shape:** full pill (9999px radius), 8px 20px padding, Label type (500, 0.75rem).
- **Primary:** Deep Cobalt fill, white text. Hover darkens fill ~6% L; focus-visible shows
  a 2px cobalt ring offset 2px; disabled drops to 50% opacity, never a different hue.
- **Secondary:** Panel fill, Ink text, no border. Hover deepens the tint.
- **Destructive:** Claret as *text-only* button for secondary placements (Reject); filled
  Claret pill only inside confirmation dialogs.

### Chips
- **Style:** code chips (paths, branches, model ids) are mono 0.875em on Panel, 6px
  radius, 2px 6px padding. Status chips (run states) are Label type with a leading dot
  glyph: brass dot = running, moss = complete, claret = failed. Text always accompanies
  the dot — color is never the sole carrier.

### Cards / Containers
- **The run card is the signature component** (see below). Generic containers: Paper bg,
  Hairline 1px border, 14px radius, 20–24px padding. **Never nested cards** — inside a
  card, structure comes from spacing and Hairline dividers.

### Inputs / Fields
- **Style:** Paper bg, Hairline 1px border, 10px radius, 10px 14px padding, Body type.
- **Focus:** border shifts to Deep Cobalt plus a soft 3px cobalt ring at 15% alpha.
- **Error:** border shifts to Claret with a Meta-sized message below; placeholder text
  meets 4.5:1 (a darkened Ink Muted, not default gray).
- **The composer** (comment box) is the room's one persistent input: same vocabulary,
  slightly larger (12px 16px), pinned bottom with a Hairline top border.

### Navigation
- **Sidebar on Panel:** Label type; items get a soft 8px-radius tint on hover, Deep Cobalt
  text + cobalt-tinted bg (10% alpha) when active. Channel lifecycle is legible: archived
  channels render in Ink Muted with an archive glyph. No unread-count badge storms — a
  600-weight name is the unread signal.

### Run Card (signature component)
The rendering of "agents propose, people decide." A run's output lands in the thread as a
structured card: title row (run trigger + status chip), body prose, then explicit
**Caveats** and **To do** sections when present, and a decisive action row — filled
cobalt pill for the primary affirmative, secondary pill for "request changes"-class
actions, claret text button for reject. Attribution (agent name, model chip, duration)
sits in Meta type at the card edge. While running, the card shows a brass status chip and
skeleton lines — never a spinner centered in a void.

## 6. Do's and Don'ts

### Do:
- **Do** keep color ≤10% of any screen (The Quiet Chrome Rule); cobalt for action and
  selection, brass only while an agent works.
- **Do** render every agent action as a structured, attributed card with explicit human
  controls — "agents propose, people decide" is a visual contract.
- **Do** use skeletons for loading and teaching empty states ("Channels are goals — create
  one to give an agent its purpose"), never bare spinners or "nothing here."
- **Do** keep both themes token-tuned: dark mode is required, per-token, first-class.
- **Do** keep motion 150–250ms, ease-out, state-conveying, with `prefers-reduced-motion`
  fallbacks.
- **Do** keep pill buttons, ≥6px radii, and 1px Hairline borders — soft geometry is the
  brand's handshake.

### Don't:
- **Don't** ship anything "gamer-y" — Discord density, neon accents, dark-for-cool's-sake.
- **Don't** ship "terminal cosplay" — monospace outside code blocks and path chips is
  prohibited (The Mono-Means-Code Rule).
- **Don't** use "bubbly/playful" character identities — no mascot avatars, no illustrated
  animal portraits (the hilos element we explicitly rejected), no cutesy copy.
- **Don't** use "stark, high-contrast, sharp-angled" treatments — no 0-radius geometry,
  no black-on-white brutalist slabs.
- **Don't** use "colorful gradients" — anywhere (The No-Gradient Rule).
- **Don't** use "decorative serif fonts" — there is no serif in this product.
- **Don't** use side-stripe borders (`border-left` > 1px as accent), gradient text,
  decorative glassmorphism, nested cards, or uppercase tracked eyebrows.
- **Don't** reach for a modal first — inline and progressive disclosure before overlay.
- **Don't** let muted text drop below 4.5:1 on its background; quiet ≠ illegible.
