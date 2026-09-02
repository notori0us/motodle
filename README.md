# Motodle

A daily motorbike-guessing game, in the shape of Wordle/Cardle: guess the make, model and year
of a motorbike from a progressively-revealed photo. Fully static — Vite + TypeScript + Svelte 5,
no runtime dependencies, no backend, no third-party scripts. See `docs/PLAN.md` for the full
design (data contracts, game logic, content pipeline, test plan, implementation workstreams).

## Quickstart

```sh
npm ci                 # exact, pinned install — see "Toolchain" below
npm run dev             # local dev server (Vite)
npm test                # unit + contract + component tests, plus the two-timezone date suite
npm run check            # svelte-check + tsc --noEmit
npm run build             # production build, then payload-budget enforcement
npm run preview            # serve the production build on http://127.0.0.1:4173
npm run test:e2e            # Playwright (chromium) end-to-end specs
```

`npm run preview` and the Playwright `webServer` both bind explicitly to `127.0.0.1` — Vite binds
IPv6-only by default on some hosts, which makes a plain `curl http://127.0.0.1:4173/` return
nothing even though the server is up.

## Content pipeline scripts

These build the catalog and the daily puzzles from Wikimedia Commons; see `docs/PLAN.md` §6.

```sh
npm run generate    # offline: fixtures/ -> public/puzzles/** + docs/ATTRIBUTION.md (idempotent)
npm run catalog      # network: rebuild public/catalog.json from Commons/Wikidata
npm run fetch         # network: find candidate photos -> data/review/<batch>.json for approval
npm run crop           # offline: crop.ts's five WebP levels + full reveal for one source image
npm run schedule        # offline: an approved review batch -> public/puzzles/** + manifest.json
```

## Toolchain

Versions are pinned and were verified together on this host (see `docs/PLAN.md` §10). Use
`npm ci`, not `npm install` — `ci` hard-fails on any drift from the committed lockfile, whereas
`install` would silently re-resolve the dependency tree against the live registry. After `npm ci`,
`npm ls typescript` must report `6.0.3` — `typescript@*` resolves to a version that crashes
`svelte-check`.

## Status

This repo is being built in workstreams (`docs/PLAN.md` §8). `src/App.svelte` is currently a
placeholder shell; the game itself is not yet wired up.

<!-- W5 appends the full "runs great locally" acceptance checklist, `npx playwright install
     chromium`, MOTODLE_UA_CONTACT, todayOverride, and the image-licence paragraph below. -->
