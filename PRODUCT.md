# Product

## Register

product

## Users

Individuals and small teams solving real, deep problems — the kind that require sustained
research, guidance, and knowledge management rather than quick answers. They work in
multi-tenant workspaces with invited members, building bespoke "shape" agents (prompt +
tools + skills + MCP servers + artifacts + model) that live one-per-channel. Sessions are
long and thoughtful; the user is usually mid-problem, not browsing. The output of this work
may eventually feed external coding agents, but thinkspace itself is the thinking layer,
not the shipping layer.

## Product Purpose

Thinkspace is a multi-tenant, Slack-adjacent workspace where channels *are* agents:
goal-scoped, ephemeral surfaces, each hosting exactly one bespoke agent. Threads are the
post primitive — recency-ordered units of deep-thinking work with nested comments, where
humans and the channel's agent co-participate. Dispatches and scheduled runs produce agent
work that lands back in the thread. Success looks like a workspace whose channels
accumulate real progress toward stated goals, get archived when the goal is done, and whose
knowledge (artifacts, library) compounds over time.

## Brand Personality

**Calm, deliberate, collegial.**

- *Calm*: the interface recedes; long sessions should feel like a quiet study, not a
  notification feed.
- *Deliberate*: every affordance implies intent — goals, dispatches, approvals. Nothing
  fires accidentally; nothing decorates.
- *Collegial*: agents and humans share the room as peers with distinct, legible roles.
  Warm in tone, professional in form — collaboration without mascots or theatrics.

## Anti-references

- **Gamer aesthetics** (Discord-style density, neon, dark-for-cool's-sake).
- **Terminal cosplay** (mono-forward UI, scanlines, hacker green; monospace is for code
  blocks and file-path chips ONLY).
- **Bubbly / playful character identities** — no illustrated mascot avatars for agents, no
  cutesy microcopy. (hilos.sh's animal-portrait warmth is explicitly NOT wanted.)
- **Stark, high-contrast, sharp-angled design** — no brutalism, no hard black-on-white
  slabs, no 0-radius geometry.
- **Colorful gradients** — the generic AI-SaaS purple-gradient chrome above all.
- **Decorative serif fonts** anywhere in the UI.

## Design Principles

1. **Calm by default.** Attention is the scarce resource this product exists to protect.
   Chrome is quiet and neutral; color appears only to signal state or invite action. No
   competing badges, no ambient animation, no noise.
2. **Agents propose, people decide.** Every agent action (run output, curator suggestion,
   schedule fire) renders as a structured, attributable, reviewable artifact with explicit
   human controls — never as an anonymous wall of text. Human authority is a visible design
   feature, not a settings toggle. (Adopted from hilos.sh: the inline run-report card with
   caveats and decisive actions.)
3. **The work lives in the room.** Runs, schedules, artifacts, diffs, and library knowledge
   unfurl inline in the thread where the conversation is. No tab-switching to see what an
   agent did. (Adopted from hilos.sh: the repo is in the room.)
4. **Structure carries meaning.** Channels are goals; threads are work units; recency is
   the organizing physics (bumping). The UI makes lifecycle legible — active vs. archived,
   queued vs. running vs. complete — through typography and layout, not decoration.
5. **Familiar before novel.** Earned familiarity of the best product tools (Slack's
   information architecture, Linear's restraint). The novelty budget is spent on exactly
   one place: the agent proposal/run card and the thinking surfaces around it.

## Accessibility & Inclusion

- WCAG 2.2 AA baseline: body text ≥ 4.5:1, large text and UI glyphs ≥ 3:1, visible focus
  states on every interactive element.
- **Dark mode is required from day one**, first-class and token-driven — not an inversion
  afterthought. Long-session users will live in it.
- `prefers-reduced-motion` honored on every animation; keyboard-completeness for the core
  loop (navigate channels → open thread → comment → dispatch → review run).
- Color never the sole carrier of state (run status also carried by icon/label).
