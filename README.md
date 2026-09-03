# Motodle

[![CI](https://github.com/reenchree/motodle/actions/workflows/ci.yml/badge.svg?branch=main&event=push)](https://github.com/reenchree/motodle/actions/workflows/ci.yml)

This repo is private, so the badge image above only renders for viewers authenticated with repo
access — it shows as broken in an anonymous or mirrored context. That's expected, not a config bug.

A daily motorbike-guessing game, in the shape of Wordle/Cardle. Guess the motorbike in 5 tries.
A new motorbike is available each day. Fully static — Vite + TypeScript + Svelte 5,
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
npm run prefetch       # network: cache approved candidates' originals (schedule needs them) + write review thumbnails
npm run crop           # offline: crop.ts's five WebP levels + full reveal for one source image
npm run schedule        # offline: an approved review batch -> public/puzzles/** + manifest.json
```

`docs/CATALOG-REVIEW.md` is a render of `public/catalog.json` and a unit test pins the two together
byte for byte — after editing the catalog (the source of truth), re-render it with
`npm run catalog -- --review-only` (offline) or `npm test` goes red.

`npm run catalog` and `npm run fetch` are the two scripts that talk to Wikimedia, and both require
`MOTODLE_UA_CONTACT` — a contact URL sent as part of the Wikimedia API `User-Agent`
(`motodle/0.1 (<contact>) node-fetch`, assembled in `tools/lib/wikimedia.ts`). It defaults to
`https://playmotodle.com; homelab hobby project` — the live site, not this repo, since the repo is
private and a Wikimedia operator following a repo URL here would just get a 404; override it for a
fork:

```sh
MOTODLE_UA_CONTACT="https://github.com/<you>/<fork>" npm run catalog
```

Wikimedia's UA policy wants a real, dereferenceable URL — a `<placeholder>` angle-bracket template
or an empty string is rejected before any request is made (fail fast, not a bad first request). No
email address is used anywhere in this pipeline (operator decision D5, `docs/PLAN.md` §1.3).

## Toolchain

Versions are pinned and were verified together on this host (see `docs/PLAN.md` §10). Use
`npm ci`, not `npm install` — `ci` hard-fails on any drift from the committed lockfile, whereas
`install` would silently re-resolve the dependency tree against the live registry. After `npm ci`,
`npm ls typescript` must report `6.0.3` — `typescript@*` resolves to a version that crashes
`svelte-check`.

## Status

This repo is being built in workstreams (`docs/PLAN.md` §8). All of W0-W5 have landed: the game
is fully wired up, the content pipeline and its contract tests are in place, and the e2e suite
below covers the full playthrough. See `docs/PLAN.md` §11 for the workstream-by-workstream log.

## Playing a specific day locally (`todayOverride` / `?today=`)

The app's notion of "today" always comes from the real clock, **except** in a `vite dev`/`vite
preview` build where two DEV-only overrides are honoured (guarded by `import.meta.env.DEV`, so
neither can leak into a production build):

- **`?today=YYYY-MM-DD`** in the URL — the quickest way to jump to a specific puzzle by hand, e.g.
  `http://localhost:5173/?today=2026-09-03`. `npm run dev` does NOT pass `--host`, so it binds
  `[::1]:5173` only; use `localhost`, or run `npm run dev -- --host 127.0.0.1`.
- **`todayOverride`** in `src/config.ts` — a persistent override for a whole local session,
  instead of retyping the query string every reload. Leave it `null` (the committed value) to
  track the real date.

Only the three committed fixture dates (`2026-09-02`, `2026-09-03`, `2026-09-04`) have puzzle
files. A real static host 404s any other date's `puzzles/YYYY-MM-DD.json`, and the app turns that
into the "no puzzle today" screen (`docs/PLAN.md` §7.4a, §7.5 step 9, §4.6) — that is a pass, not
a failure. `vite.config.ts` sets `appType: 'mpa'` so `npm run dev` and `npm run preview` 404 a missing
puzzle file exactly like a real static host (the Vite default, `'spa'`, would serve `index.html` with
status 200 instead and the app would show the `load-failed` screen); the Playwright "no puzzle today"
spec exercises that real 404, not a route stub.

**Note:** `npm run build` and `npm run preview` produce a *production* build
(`import.meta.env.DEV` is `false`), so neither override has any effect there — pin the real
system/browser clock instead, or drive `npm run test:e2e`'s Playwright specs, which pin
`page.clock` directly against the production build (see "End-to-end tests" below).

## End-to-end tests

`npm run test:e2e` runs the Playwright (chromium) suite in `e2e/` against a production build
served by `vite preview`. One-time setup, before the first run on a machine:

```sh
npx playwright install chromium   # downloads the pinned browser into ~/.cache/ms-playwright
```

This needs network access and is a no-op if the browser is already cached. A zero-download
alternative that floats with the OS's installed Chrome instead of a pinned version: set
`channel: 'chrome'` in `playwright.config.ts`'s `projects` entry.

Every spec pins `page.clock` to one of the three fixture dates (or the day after, for the "no
puzzle today" screen) — see `docs/PLAN.md` §7.4a for why this is mandatory, not a convenience: an
unpinned suite is self-contradictory on every single calendar date once fixtures exist for only
three of them.

| Spec | Proves |
|---|---|
| `playthrough.spec.ts` | Full win playthrough (§7.4 steps 1-9): first-visit help modal, level unlock/scrub, all three RULE A/B tile colours across 3 guesses, the make/model cascade and the make-lock leaving `#mtd-model` listing that make's full range, score, byte-exact share text, stats-modal numbers, and that a reload restores the finished game instead of replaying it. |
| `loss.spec.ts` | A loss after 5 guesses: make locks green and stays green, model/year never do, score/share/stats for a loss. |
| `giveup.spec.ts` | Give-up before any guess: counts as a loss, appends no share-grid row (the zero-row collapse, §4.4), and the give-up control disappears once the game has ended. |
| `practice.spec.ts` | The "no puzzle today" screen on a date past the last fixture, the archive listing only `date < today`, and a full practice win that never writes `motodle:stats` (byte-identical before/after). |
| `rollover.spec.ts` | The persistent rollover banner at local midnight (`page.clock.install` + `pauseAt` + `runFor`, §4.5) without disturbing an in-progress board, and that the two days' state never mixes once Reload is clicked. |
| `blocked-submit.spec.ts` | The submit button is `aria-disabled`, not natively `disabled` — the inline "Choose a make" / "Choose a model" / year-range message stays reachable via a forced click or Enter in a select or the year field, and no path submits a guess. |
| `colorblind.spec.ts` | The `[data-colorblind="true"]` CSS cascade wins over both an explicit dark theme and OS-level `prefers-color-scheme: dark` (jsdom cannot resolve this cascade at all, so it is asserted only here). |
| `mobile-layout.spec.ts` | At 360×640, with no focus call and no scroll, the submit button sits above the fold; the viewport meta preserves pinch-zoom (no `user-scalable=no`/`maximum-scale`). |

## Payload budgets

`npm run build` runs `vite build` and then `tools/check-budget.ts`, which gzips every shipped
artifact in memory and fails the build (non-zero exit) if any of the limits in
`schema/constants.ts` are exceeded: app JS/CSS gzipped, `catalog.json` gzipped, and — for **every**
committed puzzle — its `puzzles/<date>.json` plus its 5 level WebPs (raw bytes, the "day budget")
and its full reveal image (raw bytes, measured separately since it is fetched lazily and excluded
from the day budget). It prints one row per measurement with its actual size and its limit.

## Image licensing

Code is MIT, see LICENSE; photos keep their own licences, see docs/ATTRIBUTION.md.

The images under `fixtures/images/` and `public/puzzles/img/` are **not** covered by this
repository's code licence. Each is a cropped, resized, WebP-re-encoded derivative of a Wikimedia
Commons photograph and is distributed under **that photograph's own licence**, named per puzzle
in `docs/ATTRIBUTION.md` and shown in the game's result screen. Where the source is CC BY-SA, the
derivative is offered under the **same CC BY-SA version**; reusers inherit that share-alike
obligation.

## "Runs great locally" acceptance checklist

From a clean clone, in order (`docs/PLAN.md` §7.5). Every command must exit 0, and — because every
e2e spec pins its own clock — this checklist is runnable on any date, not only the ones with a
fixture puzzle.

CI runs rows 0–6 and 8 of this table headless on every push and PR — see `docs/PLAN.md` §12; row
7's `preview` is what row 8's Playwright `webServer` starts, so it isn't a separate CI step. Rows 9
and 10 stay manual.

| # | Command | Expected |
|---|---|---|
| 0 | `npx playwright install chromium` | One-time, needs network; a no-op once `~/.cache/ms-playwright` is populated. |
| 1 | `npm ci` | Exit 0, no `ERESOLVE` warning. `node -p "require('./node_modules/typescript/package.json').version"` reports `6.0.3` — not `npm ls typescript`, which can exit non-zero over benign `sharp` optional-dep residue (§10.7 gotcha 7); CI reads the version off disk for the same reason. |
| 2 | `npx svelte-check --tsconfig ./tsconfig.json` | 0 errors. |
| 3 | `npx tsc --noEmit` | Clean. |
| 4 | `npm test` | All unit + tool + contract + component tests pass, including the two-timezone `test:tz` run. |
| 5 | `unshare -rn npm run generate` | Regenerates `public/puzzles/**` and `docs/ATTRIBUTION.md`; `git status` shows no diff (idempotent, output is committed). `unshare -rn` proves "no network access" mechanically — use `systemd-run --user -p PrivateNetwork=yes npm run generate` where `unshare` needs privileges this host doesn't grant. |
| 6 | `npm run build` | `vite build` succeeds and `check-budget.ts` prints every budget green with real numbers. |
| 7 | `npm run preview` | Serves on `http://127.0.0.1:4173`; `curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:4173/` → `200`. |
| 8 | `npm run test:e2e` | All Playwright specs pass, on any date. |
| 9 | `unshare -rn sh -c 'ip link set lo up && npm run dev -- --host 127.0.0.1'` | Exit 0; app loads offline; the make/model dropdowns populate from the local `catalog.json`; `todayOverride`/`?today=` renders the chosen fixture puzzle. A bare `unshare -rn npm run dev` (no `ip link set lo up`) exits 1 — `EADDRNOTAVAIL: ::1:5173` — because a fresh netns starts with `lo` down. The browser driving this check must run **inside the same namespace** (append `&& node <driver-script>` to the same `sh -c`) — a browser outside the namespace cannot reach a server inside it. |
| 10 | Operator plays a full round by hand in a real browser | Final gate — the one thing e2e cannot check: 360×640 with the on-screen keyboard actually open, on a real phone or in device emulation (§5.8). |

Note on step 5: `npm run generate`'s byte-for-byte determinism holds only for a fixed sharp/libvips
build; if a future sharp bump makes the WebPs differ, the meaningful guarantee becomes "schema +
budget valid" (the `schema/*.test.ts` contract suite), not "no diff".

## Deploying

The site is S3 + CloudFront at `https://playmotodle.com` (apex canonical; `www` 301s to it).
Infrastructure is the Terraform root module in `infra/` — state lives in HCP Terraform,
organization `reenchree`, workspace `motodle`, **execution mode `local`** (plan/apply run on the
operator's laptop against the AWS SSO `default` profile; no AWS credentials are ever stored in HCP).

Deploys are automatic: `.github/workflows/deploy.yml` fires on every CI run that succeeds on
`main`, builds, and syncs `dist/` to the bucket with per-path-class `Cache-Control` headers, then
invalidates the mutable paths. It reads three repository variables, set once after the first
`terraform apply` from that run's `terraform output`:

| Variable | Source |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | `terraform output deploy_role_arn` |
| `SITE_BUCKET` | `terraform output site_bucket` |
| `CLOUDFRONT_DISTRIBUTION_ID` | `terraform output distribution_id` |

Full operator runbook (Terraform install, AWS SSO, HCP Terraform login and workspace setup,
`init`/`plan`/`apply`, setting the variables above, first deploy, and rollback) and the full
verification matrix: `docs/PLAN.md` §13.6–§13.7.
