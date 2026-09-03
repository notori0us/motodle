---
name: Motodle
description: A daily motorbike guessing game — five guesses, three tiles, one photograph that opens up.
colors:
  ink: "#18181b"
  paper: "#ffffff"
  surface: "#f4f4f5"
  muted: "#6b6b70"
  border: "#d9d9de"
  accent: "#2563eb"
  accent-fg: "#ffffff"
  danger: "#b91c1c"
  overlay: "rgb(0 0 0 / 45%)"
  ink-dark: "#f2f2f4"
  paper-dark: "#121214"
  elevated-dark: "#1c1c1f"
  surface-dark: "#232327"
  muted-dark: "#a3a3a9"
  border-dark: "#3a3a40"
  accent-dark: "#6d9bff"
  danger-dark: "#ff8a8a"
  tile-green: "#3b7d22"
  tile-yellow: "#946c0a"
  tile-red: "#b32222"
  tile-red-dark: "#a13a3a"
  tile-cb-right: "#c2410c"
  tile-cb-close: "#1d4ed8"
  tile-cb-wrong: "#17171a"
typography:
  title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.4
  headline:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.4
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.4
  tile:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "0.85rem"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
  micro:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "0.7rem"
    fontWeight: 400
    lineHeight: 1.25
rounded:
  sm: "6px"
  md: "10px"
  lg: "16px"
  pill: "999px"
spacing:
  space-1: "0.25rem"
  space-2: "0.5rem"
  space-3: "0.75rem"
  space-4: "1rem"
  space-5: "1.5rem"
  space-6: "2rem"
components:
  button:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 1rem"
    height: "44px"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-fg}"
    rounded: "{rounded.md}"
    padding: "0 1rem"
    height: "44px"
  button-primary-soft-disabled:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.accent}"
    rounded: "{rounded.md}"
    height: "44px"
  button-disabled:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    height: "44px"
  icon-button:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    size: "44px"
  link-button:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.body}"
  select:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 0.75rem"
    height: "44px"
  select-locked:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "44px"
  tile-empty:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    rounded: "{rounded.sm}"
    padding: "0.25rem 0.5rem"
    height: "2rem"
  tile-right:
    backgroundColor: "{colors.tile-green}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    typography: "{typography.tile}"
  tile-close:
    backgroundColor: "{colors.tile-yellow}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    typography: "{typography.tile}"
  tile-wrong:
    backgroundColor: "{colors.tile-red}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    typography: "{typography.tile}"
  scrub-segment:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    size: "44px"
  scrub-segment-active:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-fg}"
    rounded: "{rounded.sm}"
    size: "44px"
  lock-chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
    padding: "0 0.5rem"
    height: "1.05rem"
  modal:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "1.5rem"
    width: "min(100%, 30rem)"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
---

# Design System: Motodle

> **Scan-mode record of the system as built on 2026-09-03, before the Impeccable pass.** It is a
> faithful description of `src/styles/tokens.css`, `src/styles/app.css`, the eleven components in
> `src/components/`, `index.html` and `public/404.html` — not a target state. The design brief that
> supersedes parts of it is `docs/PLAN.md` §5.14; re-run `/impeccable document` once that pass lands
> so this file describes the shipped world again. Descriptive names below (Signal Blue, Grass,
> Ochre…) were inferred from the values, not confirmed by the operator.

## Overview

**Creative North Star: "The Instrument Panel That Isn't Built Yet"**

Motodle today is an honest, well-engineered *default*. Every decision that could be reasoned about
mechanically — contrast ratios, touch targets, focus rings, the fold, disabled-vs-locked semantics,
theme cascade specificity — has been decided carefully and written down. Every decision that can only
be made by taste — the face, the accent hue, the shape language, the depth model, the icons, the
rhythm — has been left at the framework default: system sans at one weight, a 6/10/16 px radius
ladder, a single Tailwind-family blue, Unicode glyphs where icons belong, and one uniform 8/16 px gap
between every group on the page.

The result reads as *a correct implementation of a plan* rather than as a product. Nothing on screen
except the photograph and the tile colors says "motorbike", "game", or "Motodle". The identity is
carried entirely by content: a real photograph in a 4:3 frame, a five-row grid of colored plates, and
a form. That content is strong; the container around it is anonymous.

The system's real character, and what any successor must keep, is its **restraint under
constraint**: 3.9 KB of gzipped CSS, no runtime dependencies, no webfont, no icon package, three
themes that all pass contrast, and a mobile fold rule that is machine-verified on every commit.

**Key Characteristics:**

- Single 480 px (30 rem) centered column at every viewport, phone to 1920.
- One system font stack, one weight axis (400/600/700), sizes from 0.65 rem to 1.5 rem.
- Neutral gray-zinc palette (no hue tint) plus one blue accent and three state colors.
- Flat: exactly one shadow token in the whole system, used only by modals and the toast.
- Every interactive control is 44 px tall with a 10 px radius and a 1 px border.
- Color state is doubled by a glyph in colorblind mode; nothing depends on color alone.

## Colors

A neutral zinc-family gray scale with no hue tint, one blue accent for action and wayfinding, and a
three-color state palette that belongs to the scoreboard. Light and dark are separate token sets, not
an inversion; colorblind mode is a third set that overrides only the tile fills.

### Primary

- **Signal Blue** (`#2563eb`; `#6d9bff` in dark): the only accent in the system. It fills the primary
  button, the active crop-level segment, the score-distribution bars and the rollover banner, and it
  colors every link and the single focus ring. It is a stock framework blue with no product meaning
  and it collides with the colorblind "close" tile (contrast between the two: **1.3:1**).

### Secondary

- **Grass** (`#3b7d22`): the "right" tile, and the only color the 404 page and the favicon carry.
  5.07:1 against white text.
- **Ochre** (`#946c0a`): the "close" tile. 4.76:1 — the tightest pair in the system, and it reads
  olive-brown rather than yellow at tile scale.
- **Brick** (`#b32222`; `#a13a3a` in dark): the "wrong" tile. 6.63:1.

### Tertiary

Colorblind mode replaces the three state fills and nothing else: **Burnt Orange** (`#c2410c`, right),
**Deep Blue** (`#1d4ed8`, close), **Near-Black** (`#17171a`, wrong). Every tile additionally renders a
`✓ ~ ✗` glyph in this mode. In the shared grid the colorblind "wrong" square is `⬜`, not `⬛`, so it
survives someone else's dark-themed chat client.

### Neutral

- **Ink** (`#18181b` light / `#f2f2f4` dark): all body and heading text. 17.7:1 on paper.
- **Paper** (`#ffffff` light / `#121214` dark): the page ground. In light mode the *elevated* surface
  is also `#ffffff` — modals, buttons, selects and cards are separated from the page by a 1 px border
  alone (**1.41:1**), not by tone.
- **Surface** (`#f4f4f5` / `#232327`): empty tiles, disabled controls, the practice bar, distribution
  tracks, the textarea.
- **Muted** (`#6b6b70` / `#a3a3a9`): field labels, license line, credit paragraphs, footer, the
  give-up button, disabled labels. 5.3:1 on paper.
- **Border** (`#d9d9de` / `#3a3a40`): one hairline weight everywhere.
- **Danger** (`#b91c1c` / `#ff8a8a`): validation messages and the give-up confirmation.

### Named Rules

**The One Signal Rule.** Green, yellow and red belong to the scoreboard's vocabulary. Nothing
decorative borrows them — the only exception in the code is the stats modal, which paints today's
score bucket in the "right" green because that bar *is* a game state.

**The Glyph Rule.** Colorblind mode never changes color alone: it swaps the fill **and** renders a
glyph, and that glyph is markup, not CSS `content`, so it stays in the accessibility tree.

**The Cascade Rule.** `:root[data-colorblind='true']` is the last block in `tokens.css` and is
selector-specificity `(0,2,0)` — the same as both theme blocks — so source order decides and
colorblind always wins over light *and* dark. A bare `[data-colorblind]` selector is `(0,1,0)` and
silently loses to both; that was a real bug, and `e2e/colorblind.spec.ts` exists to keep it fixed.

## Typography

**Display Font:** none — the UI stack is used at every size.
**Body Font:** `system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`, with
`'Apple Color Emoji', 'Segoe UI Emoji'` appended (the header controls rely on it).
**Label/Mono Font:** none. `font-variant-numeric: tabular-nums` appears exactly once, on the stats
countdown.

**Character:** whatever the operating system supplies — San Francisco, Segoe UI, Roboto, and DejaVu
Sans on the CI runner. Weight does most of the hierarchy work; there is no tracking, case or family
contrast anywhere, and no display voice.

### Hierarchy

- **Title** (700, 1.25 rem / 20 px): the `Motodle` wordmark, and the only text above 1.1 rem on the
  game screen. It ellipsizes rather than wraps so the five header controls always fit.
- **Headline** (700, 1.5 rem / 24 px, browser default `h2`): modal titles — *How to play*,
  *Statistics*, *You got it!*, *Photo credits*, *Archive*.
- **Body** (400, 1 rem / 16 px): modal prose, selects, the year field, buttons. 16 px is a floor, not
  a preference: anything smaller triggers iOS focus zoom on the form controls.
- **Tile** (400, 0.85 rem / 13.6 px): scoreboard tile labels, ellipsized on overflow, centered.
- **Label** (400, 0.75 rem / 12 px): the `Make` / `Model` / `Year` field labels, validation messages,
  the stat captions, the footer.
- **Micro** (400, 0.7 rem / 11.2 px, and 0.65 rem / 10.4 px for the `LOCKED` chip): the in-play
  license line and the lock chip. The chip is the only uppercase, letter-spaced text in the app
  (`0.04em`, presentational only — its `textContent` stays `Locked`).

### Named Rules

**The 16 px Floor.** Every focusable text input renders at ≥ 1 rem, because iOS zooms the viewport
into anything smaller and the fold rule cannot survive that.

**The Label-Line Rule.** Each field's label line exists in every state and reserves its own height
(`min-height: 1.05rem`), so a validation message or a `Locked` chip appears *inside* it and costs the
layout zero pixels. `e2e/mobile-layout.spec.ts` asserts the submit button does not move when a
validation error appears.

## Layout

One centered column, `max-width: 30rem` (480 px), at every viewport from 320 px to 1920 px; there is
no wide-screen composition and no breakpoint that changes the topology. The shell is
`min-height: 100svh` (never `dvh`, never `vh` alone) with `padding: max(0.75rem, env(safe-area-inset-*))`.

**Vertical order, fixed:** header · [practice bar] · photo frame · license + crop scrub row ·
scoreboard · guess form · footer. DOM order, visual order and focus order agree.

**Rhythm:** one `--space-4` (16 px) gap between every top-level section, tightened globally to
`--space-2` (8 px) below `max-height: 1000px`, plus two local tightenings — the scoreboard's row gap
and tile padding at the same height, and the guess form's own gap and confirm row at
`max-height: 700px`. Within the form, a 4 px row gap binds a label to its control and an 8 px margin
separates the control blocks, which is the only deliberate tight/loose contrast in the system.

**The photo frame is height-driven, not width-driven:** `--stage-max-h: clamp(120px, 100svh - 500px, 36svh)`,
and the frame's *width* follows at 4:3 of that height (`width: min(100%, calc(var(--stage-max-h) * 4 / 3))`),
centered. Measured frame sizes: **186×140** at 360×640, **366×274.5** at 390×844, **480×360** at
768×1024, **384×288** at 1280×800, **480×360** at 1920×1080.

**Measured fold budget** at 360×640 (light, unfocused, `scrollY 0`): header 12→56, frame 64→204, scrub
row 212→256, scoreboard 264→429.9, form 437.9→632.5, **submit 531.5→575.5**, viewport 640 — 64.5 px
of slack.

### Named Rules

**The Fold Rule.** At 360×640, unfocused, `scrollY === 0`, `submit.getBoundingClientRect().bottom ≤ window.innerHeight`,
and `documentElement.scrollWidth ≤ clientWidth` at every width. Machine-verified.

**The Shared-Row Rule.** The in-play license link shares the crop-scrub row rather than taking a row
of its own; it costs zero vertical pixels, and the scrub segments still clear 44×44 px because they
are allowed to shrink to that minimum first (asserted in e2e).

**The Non-Interactive Exemption.** Scoreboard tiles are `<span role="cell">` — never focusable, never
tappable — so the 44 px floor does not apply to them; they run at `min-height: 2rem`, and 1.6 rem on
short viewports. This is what buys the fold.

## Elevation & Depth

The system is **flat by construction**. There is exactly one shadow token,
`--shadow-modal: 0 10px 40px rgb(0 0 0 / 25%)` (60% opacity in dark), used by the modal dialog and the
toast and nowhere else. Every other surface is separated by a 1 px border and, in dark mode only, by a
tonal step (`#121214` page → `#1c1c1f` elevated → `#232327` surface). In light mode page and elevated
surfaces are the same white, so the border is the only separator.

### Shadow Vocabulary

- **Modal** (`box-shadow: 0 10px 40px rgb(0 0 0 / 25%)`): dialogs over the `rgb(0 0 0 / 45%)` scrim,
  and the toast.

### Named Rules

**The Flat Rule.** Nothing on the game screen lifts. Depth is reserved for things that interrupt —
dialogs and the toast — and the scrim, not the shadow, is what actually communicates the interruption.

## Shapes

A three-step radius ladder used strictly by size class: **6 px** (`--radius-sm`) for the small,
repeated plates — scoreboard tiles, crop segments, distribution bars, archive rows; **10 px**
(`--radius-md`) for every 44 px control — buttons, selects, the year field and its steppers, icon
buttons, the practice bar, the skeleton; **16 px** (`--radius-lg`) for modal dialogs only. One
exception: the `Locked` chip is a `999px` pill, the single non-rectilinear shape in the app.

Every border is 1 px, `--color-border`, on all four sides; there are no colored left-borders, no
dividers other than the guess form's single hairline above the give-up row and the credits list's
row separators, and no outlines other than the focus ring.

### Named Rules

**The One-Hairline Rule.** Separation is a 1 px `--color-border` line or nothing. The system owns no
2 px rule, no colored edge, and no double border.

## Components

### Buttons

- **Shape:** 10 px radius (`--radius-md`), 1 px border, `min-height: 44px`, `inline-flex` centered,
  `touch-action: manipulation`.
- **Primary:** accent fill, accent-foreground text, accent border (`.button--primary`).
- **Secondary:** elevated background, ink text, border hairline (`.button`).
- **Danger:** `.button--danger` — ink-muted text on a transparent, borderless field in the give-up
  row; it turns `--color-danger` on hover and only the *Confirm* step carries a border.
- **Hover / focus:** icon buttons and archive rows shift to `--color-surface`; everything else has no
  hover state at all. Focus is a single global rule — `outline: 2px solid var(--color-accent)` at
  `outline-offset: 2px`, flipped to `--color-fg` on the accent-filled primary button.
- **Disabled vs soft-disabled (a real distinction in this system):** a genuinely inert button takes
  the neutral surface skin with muted text; the *incomplete-guess* submit stays clickable
  (`aria-disabled`, so it can explain itself) and reads as an outlined accent button, snapping to the
  accent fill the moment the guess is complete. Neither uses `opacity`, which would drop the label
  below 4.5:1.

### Chips

- **Lock chip:** `999px` pill, surface fill, hairline border, muted text at 0.65 rem, uppercase with
  `0.04em` tracking. It sits at the end of a field's label line.

### Cards / Containers

- **Photo frame:** 10 px radius, `overflow: hidden`, `--color-surface` ground, `aspect-ratio: 4 / 3`,
  no border, no shadow; it is a `<button>` (tap to enlarge) with `border: none; padding: 0`.
- **State message** (no-puzzle, load-failed, catalog-failed): 16 px padding, hairline border, 10 px
  radius, left-aligned column with its action button.
- **Practice bar / rollover banner:** 10 px radius; the banner is `position: sticky` at the top,
  accent-filled, `z-index: 20`.

### Inputs / Fields

- **Select:** full-width native `<select>`, 44 px, 10 px radius, hairline border, elevated ground,
  16 px text, `text-overflow: ellipsis`. Native chrome (the OS arrow) is kept.
- **Year field:** a three-column grid, `44px | 1fr | 44px` — `−`, the number input, `+`. The native
  spinner is suppressed (`appearance: textfield`); the two steppers auto-repeat on hold.
- **Locked vs disabled:** locked fields keep full-strength ink at weight 600 (the value is the
  player's own, and settled); disabled fields go muted on surface. Never `opacity`.
- **Error:** `aria-invalid` + `aria-describedby` on the control, with the message rendered by the
  parent on the field's label line, right-aligned, `white-space: nowrap`, ellipsized.

### Navigation

There is no navigation. The header carries the wordmark and five 44 px icon buttons — help,
statistics, archive, theme cycle, colorblind toggle — whose glyphs are **Unicode characters and
emoji** (`?`, `📊`, `📅`, `◈`, `◑`), not drawn icons: they render in the platform emoji font at
inconsistent color, weight and optical size, and the two crescents are visually indistinguishable
from each other at 44 px. Every one carries a correct `aria-label` and `title`; the colorblind toggle
carries `aria-pressed`.

### Scoreboard (signature component)

A `role="table"` of one header row and five guess rows, each a `repeat(3, 1fr)` grid with 8 px gaps
(4 px on short viewports). A filled tile is a flat 6 px plate in one of the three state colors with
white text at 0.85 rem, an optional glyph in colorblind mode, and a visually hidden sentence for
screen readers; an empty tile is the surface fill with a hairline border and no content. A separate
polite live region announces the latest row in words.

### Image stage (signature component)

The photo, then a flex row carrying the license link (`flex: 1 1 auto; min-width: 0`, 0.7 rem, muted)
and a five-segment crop scrub (`grid-template-columns: repeat(5, minmax(44px, 1fr))`, 4 px gaps). The
active segment is an accent-filled plate; locked segments are natively `disabled`. Level changes
cross-fade over 200 ms via a CSS `@keyframes` animation — deliberately not a Svelte transition, which
would call the Web Animations API that jsdom lacks.

### Modal

Fixed overlay, `rgb(0 0 0 / 45%)` scrim, centered dialog: elevated ground, 16 px radius, 24 px
padding, `max-width: 30rem`, `max-height: 90vh`, `overflow-y: auto`, the one shadow token, a 44 px
`×` close button pinned at the top-right corner, focus trapped, Esc and backdrop close, focus
returned to the opener, background scroll locked with `overscroll-behavior: contain`.

## Do's and Don'ts

### Do:

- **Do** define every color, radius and space as a token in `src/styles/tokens.css` and consume it as
  `var(--…)`; component styles are Svelte-scoped, so shared appearance is achieved by shared tokens,
  never by a shared selector.
- **Do** redefine dark-mode colors in **both** `@media (prefers-color-scheme: dark) :root:not([data-theme='light'])`
  **and** `:root[data-theme='dark']`, and keep `:root[data-colorblind='true']` last in the file.
- **Do** keep every interactive control at `min-height: 44px` and every focusable text field at
  ≥ 1 rem.
- **Do** express "not editable" as two different visual states: **locked** (full-strength ink, the
  player's own settled value) and **disabled** (muted on surface).
- **Do** reserve the label line's height in every state so validation costs no layout.
- **Do** ship game-state color together with a glyph in colorblind mode.
- **Do** write animation as CSS `@keyframes` rather than Svelte `transition:` directives, so jsdom
  component tests survive.

### Don't:

- **Don't** use `opacity` to express a disabled state; it fades text and border together and drops
  contrast below 4.5:1.
- **Don't** re-derive a tile color anywhere but `evaluateGuess()`; components read
  `guesses[].result` and never compute.
- **Don't** let anything from `credit` other than `license.name` / `license.url` reach the image
  stage subtree — not as text, not in `title`, `alt`, `aria-label` or `data-*`. A tooltip leak is a
  spoiler.
- **Don't** add a `@import`ed or third-party-hosted webfont, an icon package, a UI kit, or any
  runtime dependency; the CSP is `default-src 'none'` and the budgets are enforced by the build.
- **Don't** use `dvh` anywhere; `100svh` is the shell height and it must not jump with the URL bar.
- **Don't** grow the scoreboard tiles to 44 px "for consistency" — they are non-interactive and the
  fold depends on their being smaller.
- **Don't** change the `Photo: ` + `license.name` string, the tagline, the rules table, the scoring
  table, the share text, or any of the `mtd-*` DOM hooks: tests and e2e assert them verbatim.
