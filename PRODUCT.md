# Product

<!-- impeccable:product-schema 1 -->

> **How this file was written.** `/impeccable init` normally interviews the operator. This session
> had no question tool and no interactive channel available (the harness exposes no
> `AskUserQuestion` and no decision-page server), so every fact below is **inferred from the
> operator's written brief and from the repository** (`docs/PLAN.md`, `README.md`, `src/`,
> `schema/constants.ts`, `public/`) rather than confirmed in an interview. Lines marked
> **[assumed]** are the ones an interview would normally have settled: correct them in place — this
> file, not the plan, is where product truth lives from here on.

## Platform

web

## Users

**Primary:** motorcycle enthusiasts of all ages who play one puzzle a day. **[assumed]** They mostly
arrive on a phone (the layout contract in `docs/PLAN.md` §5.8 is written mobile-first and the fold
rule is enforced at 360×640), play once, share a spoiler-free emoji grid, and come back the next day
for the streak. A smaller desktop audience plays the same puzzle in a browser tab.

**The scene:** one bike photo, five guesses, two minutes, usually standing or one-handed, often in
the morning. The player is not browsing — they came to do one specific thing and leave. **[assumed]**

**Secondary:** the operator (a single maintainer) curates puzzles through a CLI review loop
(`docs/PLAN.md` §6.3) and schedules them; there is no admin UI.

## Product Purpose

A free daily motorbike guessing game in the Wordle / Cardle family, live at
<https://playmotodle.com>. One puzzle per local day, the same bike for everyone. The player names a
motorbike's **make, model and year** from a photograph that opens up with every wrong guess; five
guesses; three tiles per guess (green / yellow / red).

Success is a player who finishes in under two minutes, understands why each tile is the color it is,
shares the grid without spoiling the answer, and returns tomorrow.

## Positioning

The only daily guessing game built for motorbikes, and the only one whose "close" tiles reward real
domain knowledge rather than proximity in a word list:

- **Make yellow** — the guessed make shares a **country** with the answer's make (guess Honda against
  a Kawasaki: yellow, because both are Japanese).
- **Model yellow** — the guessed model was **on sale in the year the answer was built**, so an era
  match counts even when the bike is wrong.
- **Year yellow** — within ten years.

A neighboring word game cannot copy that: it depends on a curated catalog carrying `makes[].country`
and `models[].years` (`docs/PLAN.md` §3.2, §4.2). The photograph is the second half of the position —
every puzzle is a real, CC-licensed Wikimedia Commons photo of a real bike, credited in full.

## Operating Context

- **One puzzle per local day**, resolved from the player's own clock; a new Motodle appears at local
  midnight. Rollover is watched while the page is open.
- **Five guesses.** Each guess draws three tiles. A green tile scores a point and **locks** that
  field; yellow locks and scores nothing. Score = green tiles at the end × a speed multiplier
  (×5 on guess 1 down to ×1), best possible 15.
- **The photo is the hero and it is progressively revealed** — a five-step geometric crop ladder
  (`docs/PLAN.md` §4.7a); the player may scrub *back* to earlier crops, never forward, and all five
  unlock once the game ends.
- **Licensing is part of play**, not a footnote: the license name is on screen the whole time the
  photo is (spoiler-safe — author, file title and Commons URL would give the answer away), and the
  full credit appears at the reveal plus in a permanent back-catalogue view.
- **Practice / archive** replays past days in isolation; practice never touches stats or streaks.
- **Everything is local.** No accounts, no server, no analytics, no third-party requests of any kind
  (CSP `default-src 'none'`). Progress, stats and preferences live in `localStorage`.

## Capabilities and Constraints

**Confirmed capabilities:** daily puzzle, guess form (make / model / year), five-row scoreboard,
progressive photo reveal with scrub, help, statistics with an 8-bucket score distribution and a
next-midnight countdown, result modal with full reveal and attribution, photo-credits back
catalogue, archive/practice, share text with an emoji grid, three themes (light, dark, colorblind).

**Durable technical constraints** (frozen by `docs/PLAN.md`; a design that violates one is wrong):

- **Static site.** Vite + Svelte 5 (runes), TypeScript, no runtime dependencies, no UI kit, no icon
  package, no third-party requests. Deployed as static files behind CloudFront.
- **DOM contract** (§5.3.1, §5.10.4): ids `mtd-make`, `mtd-model`, `mtd-year`,
  `mtd-photo-licence`, `mtd-credits*`, `data-mtd-credit-row`; native `<select>`s whose option values
  are catalog ids; the visible label texts `Make` / `Model` / `Year`; the accessible names
  `Guess {n} of 5`, `Give up`, `Confirm`, `Cancel`. Unit tests and e2e assert all of it.
- **Payload budgets**, enforced by `npm run build`: app CSS ≤ 20 KB gzipped, app JS ≤ 60 KB gzipped,
  catalog ≤ 150 KB gzipped, ≤ 400 KB per day of images + JSON.
- **The fold rule:** at 360×640, unfocused, `scrollY 0`, the submit button's bottom edge is at or
  above `innerHeight`; no horizontal overflow at any width; touch targets ≥ 44 px; text inputs
  ≥ 16 px (iOS focus-zoom); pinch zoom never suppressed.
- **Three themes stay:** light, dark (`prefers-color-scheme` **and** `data-theme`), and colorblind
  (`data-colorblind` swaps the tile palette **and** keeps the `✓ ~ ✗` glyphs). Tile fills keep
  ≥ 4.5:1 against their text. `prefers-reduced-motion` is honored, including the game's own logical
  delays.
- **No webfont on the network.** `font-src 'self'` is already permitted by the CSP, so a self-hosted
  subset could ship, but nothing may be fetched from a font host.
- **US English** in every user-facing string (§5.13).

**Explicitly undecided / not built:** accounts and cross-device sync, photo submissions, a crop
editor, a scheduling UI (all §9 "later-phase hooks, do not build now").

## Brand Commitments

- **Name:** Motodle. **Domain:** playmotodle.com.
- **Tagline, verbatim, everywhere the game describes itself:** *"Guess the motorbike in 5 tries. A
  new motorbike is available each day."*
- **Voice:** confident, warm, a little playful, US English. **[assumed]** Short sentences; the game
  explains a rule in a player's words, never in the vocabulary of its own source data (country names,
  never country codes).
- **Game copy is frozen** by the plan: the rules table, the scoring table, the share text and the
  attribution strings are contract, not style.
- No logo, no wordmark artwork, no brand color and no illustration assets exist. The favicon is an
  inline SVG "M" on the tile green. **[assumed]** — nothing in the repo claims otherwise.

## Evidence on Hand

- **Real content:** three committed puzzle fixtures (2026-09-02 Suzuki GSX-R750, 2026-09-03 Kawasaki
  Ninja ZX-6R, 2026-09-04 Ducati 916) with their real Commons photos, licenses and authors in
  `public/puzzles/`; a 55-make / 333-model catalog in `public/catalog.json`.
- **Real photography** is the product's only imagery, and it is user-contributed Commons material of
  variable framing and quality. There is no studio photography, no illustration budget and no
  brand-shot library. Nothing may be invented in its place.
- **No usage data, no player counts, no reviews, no testimonials, no press.** None of these may be
  fabricated anywhere in the product or its marketing surface.

## Product Principles

1. **The photograph leads.** Every layout decision spends space on the crop first; chrome gets what
   is left. The photo never gets smaller than it is today at any viewport.
2. **One puzzle, one minute, no friction.** The player must be able to guess without scrolling, on
   the smallest phone we support, with the keyboard closed.
3. **Color says exactly one thing: the state of a guess.** Green / yellow / red belong to the
   scoreboard's vocabulary; nothing decorative may borrow them, and color is never the only signal.
4. **Credit the photographer, never spoil the answer.** The license shows during play; the author,
   the file and the Commons link wait for the reveal.
5. **Nothing leaves the device.** No accounts, no network calls beyond the app's own static files,
   no third-party anything — a constraint the design must never quietly break.

## Accessibility & Inclusion

- Colorblind mode is a first-class theme: it swaps the tile palette **and** renders a glyph, because
  color may never be the only signal.
- Tile fills hold ≥ 4.5:1 against their labels; the app ships one visible focus ring for every
  interactive element.
- Native `<select>`s and a native number input were chosen deliberately for keyboard and assistive
  technology support; the scoreboard announces each submitted row through a polite live region.
- Touch targets ≥ 44 px, body/input text ≥ 16 px, pinch zoom never disabled (WCAG 1.4.4),
  `prefers-reduced-motion` collapses both animation and the game's own timing delays.
