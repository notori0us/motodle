# Motodle — Implementation Plan

A daily motorbike guessing game (Cardle-style, Wordle-shaped). Fully static. One puzzle per day, the
same for everyone.

- **Repo:** this repository (`motodle/`; started as an empty git-initialized directory)
- **`LAUNCH_DATE` = `2026-09-02`** (local date)
- **Milestone:** "runs great locally" — see §7 acceptance checklist.
- Status of this document: **the frozen contract** for a multi-agent implementation workflow. Agents
  cannot talk to each other; §3 and §4 are load-bearing and must be implemented literally.

---

## 1. Overview, brief conflicts and deviations

### 1.1 Conflicts between the brief and recon — READ THIS FIRST

| # | Conflict | Recon evidence | Resolution taken in this plan |
|---|---|---|---|
| **C1** | **Brief fixes YEAR as a guessed category. Recon proves there is NO structured year source anywhere.** | Wikidata `P571` 0/15, `P576` 0/15, `P2669` 0/15 across all 15 sampled model items (one time-valued claim total: `P5204`=1985 on GSX-R750). Commons SDC `P571` is the **photograph's** date — proven by `File:1966 Triumph Bonneville T120 TT.jpg` carrying `P571 = 2023-01-28`. `Category:<YYYY> motorcycles` exists (138 buckets) but is far too sparse (1976 = 33 files). | **NOT a blocker, and the brief already anticipated it.** The year is **operator-verified free text**, never machine-derived. `tools/fetch` extracts a *candidate* year from title/description, assigns a confidence, and **rejects `low` by default**; the operator confirms or overrides every year in the review file (§6.3) before anything ships. Every puzzle JSON carries a `yearEvidence` block recording where the year came from. **No puzzle may ship with a machine-inferred year that a human did not confirm.** |
| **C2** | **Brief wants 3–5 committed PD/CC0 fixtures. Only 3 of recon's 5 PD/CC0 candidates have year evidence strong enough to pass the brief's own "reject low year-confidence" rule.** | Fixture 4 (`Blue Honda 750 Four.JPG`) year evidence = "NONE explicit". Fixture 5 (`Blue Moto Guzzi 850 Le Mans pic1.JPG`) = "WEAKEST year evidence of the five". | **Ship 3 fixtures** (inside the brief's 3–5 band): GSX-R750 / ZX-6R / 916. A 4th/5th is **permitted, not forbidden** — the brief explicitly allows the operator to override a low-confidence year — but it would mean hand-asserting a year with zero evidence in the very artifact meant to demonstrate the evidence rule. **The operator has fixed the count at 3** (§1.3 D3); the two weak candidates stay recorded as rejected in §6.9. |
| **C3** | **A fixture photo prints its own answer.** `File:Ducati 916.JPG` has a museum placard reading "1995 DUCATI 916" in frame (visually confirmed at 960px during planning). | Recon §4 Fixture 3 caveat, plus direct inspection. | Adds a **`sourceCrop`** field to the puzzle contract (§3.1) — a pre-crop applied before the 5 levels. The 916 fixture uses it to remove the placard (bottom-left) and the intruding blue Yamaha (right edge). **The placard's year line sits at roughly y 0.75–0.79, and the rear wheel's bottom edge (~y 0.77) overlaps it in x — so no rect contains both wheels' bottoms and excludes the year.** The crop therefore cuts the bottom of both wheels; see §6.9 for the computed numbers. Formalized as the **`NO_LEGIBLE_YEAR` curation rule** (§6.6): brand/model badging on bodywork is *fine* (it is inherent to motorbikes and Cardle has the same property with car badges); **legible year text — placards, dated signage, registration plates, event banners — is a hard reject or a mandatory `sourceCrop`.** |
| **C4** | **The GSX-R750 fixture source is only 800×600.** Below any sane minimum. | Recon §4 Fixture 1: "Dimensions: 800 x 600". The Commons *original* is 800×600 — there is no larger version. | Kept (it is the best-framed PD photo found), but it ships an explicit **`cropFractions` override** — `[0.30, 0.41, 0.55, 0.74, 1.00]` since revision 9 (§4.7a) — a feature the brief already mandates. `MIN_LEVEL1_PX = 240` is a hard validation floor, and `MIN_SOURCE_WIDTH` is **derived from it** (`ceil(240 / 0.11) = 2182`) so the fetcher can never wave through a source the crop tool will reject. The floor is checked against `min(W, round(H × CROP_ASPECT))` — the largest 4:3 width the source can actually yield — not against `W` alone (§4.7). **All three fixtures are below 2182 px and therefore all three ship an explicit `cropFractions` override** (§6.9), each re-derived on the §4.7a geometric rule; `DEFAULT_CROP_FRACTIONS` applies to real puzzles sourced at ≥ 2182 px. **Even at the floor, fixture 1's 800 px source cannot go tighter than `f1 = 0.30`, which still frames the SUZUKI wordmark — hence its `focus` moves to `{0.30, 0.68}` (§4.7a).** |
| **C5** | **`typescript@*` resolves to 7.0.2 and hard-crashes `svelte-check` 4.7.6** (a thrown `Error`, not a lint failure). npm only warned, and its warning text was actively misleading (printed `Found: typescript@6.0.3` while installing 7.0.2). | Toolchain recon §1a. | **Pin `typescript@~6` → 6.0.3.** This is the configuration the *entire* toolchain recon was validated on (svelte-check 0 errors, tsc clean, vitest 2/2, build + e2e pass). The `--tsgo` dual-install alternative is untested and is rejected for this milestone. |
| **C6** | The task brief for the UX recon described "the two Ant Design selects for make/model" on Cardle. **False.** | UX recon Risk 1: Cardle's fields are hand-rolled `<input type=text>` + `<ul><li data-value>` with zero ARIA. Ant Design is bundled but used only on the auth pages. | **No conflict with our brief** (which already says "No UI kit"). Recorded so nobody plans against antd `Select` props. Everything Cardle does with those fields is a defect list we are deliberately fixing (§5.3). |
| **C7** | **Catalog build is ~900–1,000 paired API calls** and is therefore off the critical path to `npm run dev`. | Commons recon §3 call-count estimate. | A **hand-authored seed `public/catalog.json`** ships in the repo (**40–60 makes, 300–500 models**, covering the well-known bikes of every decade since 1950 plus the recon-verified models and the fixtures — §6.10). Its `makes[].country` and `models[].years` are hand-authored too, because recon proved Wikidata carries neither. `npm run catalog` regenerates it later, **preserving those hand-authored fields**. `npm run dev` never needs the network. |
| **C8** | Cardle's scoring has a **double-count bug** (the guard reads the previous round's flag, not a sticky flag, so a category can score twice and points can reach 3 without all three ever being simultaneously correct). | UX recon A7. | Our brief already specifies the sticky version ("each category that is **green when the game ends** is worth 1 point"). Combined with **green locks the category**, the bug is structurally impossible here. Recorded so nobody "faithfully reproduces Cardle". |
| **C9** | One requested model, **KTM 990 Adventure, is unsupportable from Commons** — no category at any of 6 spellings probed. | Commons recon §1 row 14, R14. | Catalog scope note only. `tools/catalog` must not fail on missing categories; it logs and skips. |

### 1.2 Deviations from Cardle that are deliberate

Every one of these is either a brief instruction or a fix for a defect the UX recon documented.

| Cardle behaviour | Motodle |
|---|---|
| `user-scalable=no, maximum-scale=1` (WCAG 1.4.4 fail) | Pinch zoom **preserved**: `width=device-width, initial-scale=1, viewport-fit=cover` |
| Correct categories are **not** locked | Green **locks** the category (pre-filled, not editable) |
| 3 separate fields, click-only, no keyboard, no ARIA | **One** ARIA combobox for "make model" + a numeric year input |
| 14px inputs → iOS focus auto-zoom | ≥16px on all controls |
| 80px-tall dropdown, unranked substring match | Tiered fuzzy matcher (§5.3), ≥44px option rows |
| No way to review earlier crops | **Scrub back** through unlocked levels |
| ~2.5 s of unskippable animation per guess | ≤400 ms, and `prefers-reduced-motion` skips it *logically* |
| No dark mode despite a persisted `dark` flag | `prefers-color-scheme` + explicit override |
| No first-visit onboarding (dead code) | How-to-play modal auto-opens on first visit |
| No stats, no distribution, no countdown | Full stats modal + countdown to local midnight |
| Ads, GA4, AdSense ×2, Strapi backend, accounts | **None.** Fully static, no third-party runtime scripts. |
| Streak never checks "was yesterday" | Streak = consecutive calendar days with a **win** |
| No give-up | Give-up button (ends as a loss, multiplier 1) |
| MAKE tile is green/red only | **Yellow** when the guessed make shares the answer make's country (RULE A, §4.2) |
| MODEL tile is green/red only | **Yellow** when the guessed model was on sale in the answer's year (RULE B, §4.2) |

### 1.3 Fixed operator decisions (frozen — do not re-open)

| # | Decision |
|---|---|
| **D1** | `PUZZLE_NUMBER_OFFSET = 1` — **2026-09-02 is Motodle #1.** Baked into every puzzle file and every shared score. |
| **D2** | The **Ducati 916 fixture stays**, cropped with the computed `sourceCrop` (§6.9). Losing the bottom sliver of both wheels is accepted. |
| **D3** | **Exactly three fixtures.** No 4th or 5th; the two zero-year-evidence CC0 candidates stay rejected (§6.9). |
| **D4** | The catalog carries **both** variant families and their depth-2 variants as separate entries (`Ducati Monster` *and* `Ducati Monster 900`); `answer.acceptModelIds` decides correctness (§3.1). |
| **D5** | `SITE_URL = "https://playmotodle.com"` — a config value in `src/config.ts` that the operator may change (§10.6); tests import it rather than hard-coding the string. Wikimedia User-Agent = `motodle/0.1 (https://playmotodle.com; homelab hobby project)` (§6.8) — **amended 2026-09-02**: the contact is now the live site, not the GitHub repo, which is private and therefore a 404 to a Wikimedia operator following it. **No email address anywhere in the repo.** |
| **D6** | **RULE A — the MAKE tile has a yellow band.** Green if the guessed make *is* the answer's make; otherwise **yellow if the two makes share a country**; otherwise red. Requires `makes[].country` (§3.2). Yellow locks nothing and scores nothing. |
| **D7** | **RULE B — the MODEL tile has a yellow band.** Green if the guess is in `acceptModelIds`; otherwise **yellow if the guessed model's production range contains the *answer's* year**; otherwise red. This makes `models[].years` load-bearing (§3.2). Yellow locks nothing and scores nothing. |

Both new rules are implemented **once**, in `evaluateGuess()` (§3.7 signature, §4.2 spec). No component
and no test may re-derive a tile colour.

---

## 2. Repo layout

```
motodle/
├─ package.json                  npm scripts, pinned devDependencies (§10)
├─ package-lock.json             committed; seeded from the verified toolchain probe
├─ vite.config.ts                Vite 8 + Svelte 5 + vitest config (§10, verbatim)
├─ svelte.config.js              vitePreprocess only (§10, verbatim)
├─ tsconfig.json                 strict, bundler resolution (§10, verbatim)
├─ playwright.config.ts          chromium, preview on 127.0.0.1:4173 (§10, verbatim)
├─ index.html                    single entry; viewport meta that KEEPS pinch zoom
├─ .gitignore                    node_modules/, dist/, .cache/, data/, !data/review/.gitkeep
├─ README.md                     quickstart + the §7 acceptance checklist
│
├─ docs/
│  ├─ PLAN.md                    this file
│  ├─ ATTRIBUTION.md             GENERATED wholesale from the puzzle set (§6.3) — never hand-edited
│  └─ CATALOG-REVIEW.md          GENERATED table of make country + model year ranges (§6.10)
│
├─ schema/                       SHARED CONTRACTS — no runtime deps, imported by src/ AND tools/
│  ├─ types.ts                   all TS types (§3.7 name list)
│  ├─ constants.ts               LAUNCH_DATE, DEFAULT_CROP_FRACTIONS, all budgets, licence
│  │                             allowlist, COUNTRY_NAMES (ISO 3166-1 alpha-2 → display)
│  ├─ puzzle.schema.json         JSON Schema (draft 2020-12) for puzzles/YYYY-MM-DD.json
│  ├─ catalog.schema.json        JSON Schema for catalog.json
│  ├─ manifest.schema.json       JSON Schema for manifest.json
│  ├─ review.schema.json         JSON Schema for the fetcher review file
│  ├─ storage.schema.json        JSON Schema for the localStorage payloads
│  └─ validate.ts                tiny dependency-free validator used by tools/ and tests
│
├─ fixtures/                     COMMITTED source material — the offline critical path
│  ├─ images/
│  │  ├─ 2004-suzuki-gsxr750.jpg      PD, 800×600  (Commons M12193306)
│  │  ├─ 2002-kawasaki-zx6r.jpg       PD, 960×720  (Commons M3111849)
│  │  └─ 1995-ducati-916.jpg          PD, 2048×1536 (Commons M4303996)
│  └─ fixtures.json               one FixtureSource per image: id, date, answer, focus, sourceCrop,
│                                  cropFractions override, full credit block, yearEvidence
│
├─ tools/                        Node/TS, run with tsx. Never imported by the app.
│  ├─ catalog.ts                 build catalog.json from Commons/Wikidata      (network)
│  ├─ fetch.ts                   find candidate photos, write a review file    (network)
│  ├─ crop.ts                    sharp → 5 WebP levels + full reveal           (offline, W1)
│  ├─ schedule.ts                approved puzzles → public/puzzles/** + manifest (offline)
│  ├─ generate.ts                crop + schedule over fixtures/ — the offline `npm run generate`
│  ├─ check-budget.ts            enforces every payload budget after `vite build`
│  │                             (W0 ships a passing stub; W5 replaces the body)
│  └─ lib/
│     ├─ wikimedia.ts            API client: UA, maxlag, gzip, serial queue, on-disk cache
│     ├─ licence.ts              licence allowlist/denylist (§6.5)
│     ├─ year.ts                 year-candidate extraction + confidence scoring (§6.4)
│     └─ normalize.ts            id/alias normalization shared with the app matcher
│
├─ public/                       served verbatim; NEVER imported by the bundle
│  ├─ catalog.json               seed catalog (hand-authored), later regenerated
│  └─ puzzles/
│     ├─ manifest.json           archive index (no answers)
│     ├─ 2026-09-02.json         puzzle #1
│     ├─ 2026-09-03.json         puzzle #2
│     ├─ 2026-09-04.json         puzzle #3
│     └─ img/0001/{l1..l5,full}.webp   generated, COMMITTED
│
├─ src/
│  ├─ main.ts                    mount(App)
│  ├─ App.svelte                 shell, routing (?d= archive), rollover watcher
│  ├─ config.ts                  PUZZLE_BASE_URL, CATALOG_URL, SITE_URL — all overridable
│  ├─ lib/                       pure TypeScript, no Svelte — the unit-test surface
│  │  ├─ date.ts                 local date keys, puzzle number, DST-proof arithmetic
│  │  ├─ game.ts                 guess evaluation, locking, win/lose/give-up state machine
│  │  ├─ score.ts                points, multiplier, final score
│  │  ├─ share.ts                PURE `buildShareText()` — emoji grid + header + URL, no DOM
│  │  ├─ match.ts                the typeahead matcher (tiered, §5.3)
│  │  ├─ catalog.ts              catalog load, index build, locked-make filtering
│  │  ├─ puzzle.ts               puzzle fetch (404 → NoPuzzle), manifest fetch
│  │  ├─ storage.ts              StorageBackend + versioned read/write + migration hook
│  │  └─ stats.ts                streak + distribution updates
│  ├─ state/
│  │  ├─ game.svelte.ts          runes store wiring lib/ to the UI
│  │  └─ share.ts                ShareSink — the navigator.share → clipboard → … delivery ladder
│  │                             (the only DOM-touching part of sharing; injected, stubbable)
│  ├─ components/
│  │  ├─ ImageStage.svelte       crop levels, scrub control, full reveal
│  │  ├─ GuessCombobox.svelte    the ARIA combobox
│  │  ├─ YearInput.svelte        numeric + steppers, 1885..currentYear+1
│  │  ├─ Scoreboard.svelte       5×3 tile grid
│  │  ├─ GuessForm.svelte        combobox + year + submit + give-up
│  │  ├─ Modal.svelte            focus-trapped dialog primitive
│  │  ├─ HelpModal.svelte        first-visit how-to-play
│  │  ├─ StatsModal.svelte       played / win% / streaks / distribution / countdown
│  │  ├─ ResultModal.svelte      answer, full image, attribution, share
│  │  ├─ ArchiveList.svelte      practice mode picker
│  │  └─ Toast.svelte            copy confirmation / errors
│  ├─ styles/
│  │  ├─ tokens.css              colour + spacing tokens, light/dark, colourblind
│  │  └─ app.css                 layout, safe areas, reduced motion
│  └─ setup-test.ts              `import '@testing-library/jest-dom/vitest'`
│
└─ e2e/
   └─ playthrough.spec.ts        scripted full playthrough (Playwright chromium)
```

---

## 3. FROZEN DATA CONTRACTS

Rules that apply to every contract below:

- All files are UTF-8 JSON, **no trailing commas, no comments**.
- Every file starts with `"schema": 1` (integer). A consumer that sees an unknown `schema` must fail
  loudly, not guess.
- Dates are `YYYY-MM-DD` **local** calendar dates. There are no timestamps in any shipped file.
- All `src` paths in a puzzle file are **relative** and are resolved against `PUZZLE_BASE_URL`.
  Never absolute, never a full URL — this is what makes the CDN move in §9 a config change.
- Ids are lowercase, `[a-z0-9-]` only, produced by `normalizeId()` (§3.2).
- `public/catalog.json` and `public/puzzles/**` are **fetched at runtime, never `import`ed.**
  Importing them would inline them into the bundle and blow the 60 KB budget.

### 3.1 Per-day puzzle — `public/puzzles/YYYY-MM-DD.json`

**Literal example — `public/puzzles/2026-09-02.json`:**

```json
{
  "schema": 1,
  "id": "mtd-0001",
  "number": 1,
  "date": "2026-09-02",
  "answer": {
    "makeId": "suzuki",
    "make": "Suzuki",
    "modelId": "suzuki-gsxr750",
    "model": "GSX-R750",
    "year": 2004,
    "acceptModelIds": ["suzuki-gsxr750"]
  },
  "image": {
    "aspect": "4:3",
    "focus": { "x": 0.30, "y": 0.68 },
    "sourceCrop": null,
    "cropFractions": [0.30, 0.41, 0.55, 0.74, 1.00],
    "levels": [
      { "level": 1, "src": "img/0001/l1.webp", "w": 240, "h": 180, "rect": { "w": 240, "h": 180 }, "bytes": 6130 },
      { "level": 2, "src": "img/0001/l2.webp", "w": 328, "h": 246, "rect": { "w": 328, "h": 246 }, "bytes": 10124 },
      { "level": 3, "src": "img/0001/l3.webp", "w": 440, "h": 330, "rect": { "w": 440, "h": 330 }, "bytes": 15352 },
      { "level": 4, "src": "img/0001/l4.webp", "w": 592, "h": 444, "rect": { "w": 592, "h": 444 }, "bytes": 27808 },
      { "level": 5, "src": "img/0001/l5.webp", "w": 800, "h": 600, "rect": { "w": 800, "h": 600 }, "bytes": 38862 }
    ],
    "full": { "src": "img/0001/full.webp", "w": 800, "h": 600, "bytes": 38862 }
  },
  "credit": {
    "fileTitle": "File:2004 Suzuki GSXR-750 Left SIde.jpg",
    "descriptionUrl": "https://commons.wikimedia.org/wiki/File:2004_Suzuki_GSXR-750_Left_SIde.jpg",
    "author": "Pawlex",
    "license": {
      "id": "PD",
      "name": "Public domain",
      "url": "https://commons.wikimedia.org/wiki/Template:PD-user",
      "jurisdiction": null
    },
    "attributionRequired": false,
    "modified": "cropped, resized, re-encoded to WebP",
    "creditNote": null
  },
  "yearEvidence": {
    "confidence": "high",
    "source": "title+description",
    "note": "Leading \"2004\" in the file title; description repeats \"2004 Suzuki GSXR-750\".",
    "approvedBy": "operator",
    "approvedOn": "2026-09-02"
  }
}
```

**Field table**

| Path | Type | Req | Meaning / constraints |
|---|---|:--:|---|
| `schema` | `1` | ✓ | Contract version. Unknown ⇒ hard fail. |
| `id` | string | ✓ | **Stable forever.** Exactly `` `mtd-${String(number).padStart(4,'0')}` `` — e.g. `mtd-0001`. **Carries no answer material**, so `manifest.json` can publish it without spoiling (§3.3), and an operator year/model correction never invalidates it. Never reused, never renumbered. The join key for every later phase (§9). Minted **once**, by whoever first creates the puzzle: for the fixtures it is authored in `fixtures.json` (§3.6) and *copied*; for a review batch `schedule` mints it for a date that has no puzzle file yet, and never re-mints for a date that has one (§6.3). |
| `number` | int ≥ 1 | ✓ | Puzzle number. Must equal `puzzleNumber(date)` (§4.1) — enforced by a test. |
| `date` | `YYYY-MM-DD` | ✓ | Must equal the filename stem. |
| `answer.makeId` | id | ✓ | Must exist in `catalog.makes[].id`. |
| `answer.make` | string | ✓ | Display name, e.g. `"Suzuki"`. Denormalized so the result screen needs no catalog. |
| `answer.modelId` | id | ✓ | Must exist in `catalog.models[].id`, and that model's `makeId` must equal `answer.makeId`. |
| `answer.model` | string | ✓ | Display name, **without** the make, e.g. `"GSX-R750"`. |
| `answer.year` | int | ✓ | `1885 ≤ year ≤ currentYear + 1`. Operator-confirmed (C1). |
| `answer.acceptModelIds` | id[] | ✓ | Model ids that count as MODEL-**green**. Must contain `modelId`. Handles catalog variant equivalence (`Ducati Monster` vs `Ducati Monster 900`) — this is the field that makes decision D4 (families *and* depth-2 variants both in the catalog) work. Length ≥ 1. A guessed model **not** in this list may still come back **yellow** under RULE B (§4.2). |
| `image.aspect` | `"4:3"` | ✓ | Only value in schema 1. **Describes the five levels only** — never `image.full`. |
| `image.focus` | `{x,y}` floats | ✓ | Fractions in `[0,1]` **of the source-cropped image**. Default `{x:0.5, y:0.5}`. |
| `image.sourceCrop` | `{x,y,w,h}\|null` | ✓ | Fractions in `[0,1]` of the **original** file. Applied *before* level generation. Use to remove year-revealing placards, intruding vehicles, dead space. `null` = whole image. |
| `image.cropFractions` | float[5] | ✓ | Strictly increasing, each in `(0,1]`, and **geometric** — each `f[i]/f[i-1]` within ±3 % of `(f[4]/f[0])^(1/4)` (§4.7a, contract test §7.2 #15). Written explicitly into every file even when it equals `DEFAULT_CROP_FRACTIONS`, so a puzzle is reproducible if the default ever changes. |
| `image.levels` | Level[5] | ✓ | Ordered, `level` = 1..5. `level 1` is the **tightest**, `level 5` the widest. |
| `image.levels[].src` | rel path | ✓ | Relative to `PUZZLE_BASE_URL`. |
| `image.levels[].w/h` | int | ✓ | Intrinsic **output** pixels (after the `min(CROP_TARGET_WIDTH, rect.w)` resize, which never upscales). Used for `width`/`height` attrs to reserve layout (no CLS). `w/h` must be 4:3 ±1px. **Non-decreasing** across levels 1→5: two adjacent levels legitimately tie once both rects exceed `CROP_TARGET_WIDTH` (fixture 3 does exactly this — §6.9). |
| `image.levels[].rect` | `{w,h}` int | ✓ | The **extracted source rect** in source-cropped pixels, before the resize. **Strictly increasing** in `rect.w` across levels 1→5 — this, not `w`, is the monotonic reveal invariant (§4.7 invariant 2, §7.2 #8). |
| `image.levels[].bytes` | int | ✓ | On-disk size. Summed by `check-budget.ts`. |
| `image.full` | `{src,w,h,bytes}` | ✓ | The reveal image, **without** `level` and **without** `rect`. Encoded **after `sourceCrop`** — the full reveal must never show what `sourceCrop` removed (the 916's placard). Its `w/h` carry **no aspect constraint** (`w = min(1400, source-cropped width)`, height follows the source-cropped aspect), so `ResultModal` must **letterbox, never distort**. Fetched lazily, only at game end. Not counted in the 400 KB day budget. |
| `credit.fileTitle` | string | ✓ | Verbatim Commons title including the `File:` prefix. |
| `credit.descriptionUrl` | url | ✓ | Commons description page. Shown as a link on the result screen. |
| `credit.author` | string | ✓ | Plain text. **HTML stripped** from `extmetadata.Artist`. Never empty — `"Unknown"` is a reject, not a value. |
| `credit.license.id` | enum | ✓ | One of `PD` `CC0` `CC-BY-2.0` `CC-BY-2.5` `CC-BY-3.0` `CC-BY-4.0` `CC-BY-SA-2.0` `CC-BY-SA-2.5` `CC-BY-SA-3.0` `CC-BY-SA-4.0` (+ jurisdiction suffixes, see §6.5). |
| `credit.license.name` | string | ✓ | Human label, **verbatim from `extmetadata.LicenseShortName`** — e.g. `"CC BY-SA 4.0"`, `"CC BY-SA 2.0 de"`. Never constructed. |
| `credit.license.url` | url | ✓ | Deed URL, **verbatim from `extmetadata.LicenseUrl`** (§6.7 already requests that field). **Never derived from `license.id`** — that would link the unported deed for a jurisdiction-ported licence (I10). |
| `credit.license.jurisdiction` | string\|null | ✓ | The jurisdiction suffix the id drops, lowercase as Commons spells it (`"de"`, `"nl"`), else `null`. Keeps `CC BY-SA 2.0 de` distinguishable from `CC BY-SA 2.0` after id normalization. |
| `credit.attributionRequired` | bool | ✓ | From `extmetadata.AttributionRequired`. **Advisory only — the UI always shows the credit** (recon R12: a PD-self file explicitly requested prose credit). |
| `credit.modified` | string | ✓ | The indication-of-modification required by CC BY 4.0 §3(a)(1)(B) and its BY-SA equivalents. Constant for this pipeline: `"cropped, resized, re-encoded to WebP"`. **Rendered on the ResultModal beside the licence link** for every puzzle, PD included (§6.5). |
| `credit.creditNote` | string\|null | ✓ | Free text for an author's prose credit request. Rendered verbatim under the credit when non-null. |
| `yearEvidence.confidence` | `high\|medium\|operator` | ✓ | `low` **may not appear in a shipped puzzle.** `operator` = no machine evidence, a human asserted it. |
| `yearEvidence.source` | string | ✓ | e.g. `title`, `title+description`, `description`, `category`, `operator`. |
| `yearEvidence.note` | string | ✓ | Human-readable justification. Quote the evidence. |
| `yearEvidence.approvedBy` | `"operator"` | ✓ | Only legal value. Nothing ships un-approved. |
| `yearEvidence.approvedOn` | `YYYY-MM-DD` | ✓ | Approval date. |

**The answer is in the file, in plaintext, by design.** This is a casual game; Wordle-level secrecy is
fine and is explicitly what the brief asks for. Do not add obfuscation.

### 3.2 Catalog — `public/catalog.json`

Broader than the answer set, exactly like Wordle's allowed-guess list. A guess must be a catalog entry.
**The catalog is load-bearing for evaluation, not just for the typeahead**: `makes[].country` decides
the MAKE yellow band (RULE A) and `models[].years` decides the MODEL yellow band (RULE B) — §4.2.

**Literal example (truncated):**

```json
{
  "schema": 1,
  "generatedAt": "2026-09-02",
  "source": "seed",
  "makes": [
    { "id": "suzuki",  "name": "Suzuki",  "country": "JP", "aliases": [] },
    { "id": "honda",   "name": "Honda",   "country": "JP", "aliases": [] },
    { "id": "triumph", "name": "Triumph", "country": "GB", "aliases": [] },
    { "id": "harley-davidson", "name": "Harley-Davidson", "country": "US", "aliases": ["harley", "hd"] }
  ],
  "models": [
    { "id": "suzuki-gsxr750", "makeId": "suzuki", "name": "GSX-R750",
      "aliases": ["gsxr", "gixxer 750"], "years": [1985, null] },
    { "id": "honda-cb750", "makeId": "honda", "name": "CB750",
      "aliases": ["nighthawk 750"], "years": [1969, 2003] },
    { "id": "triumph-bonneville-t120", "makeId": "triumph", "name": "Bonneville T120",
      "aliases": ["t120"], "years": [1959, 1974] },
    { "id": "harley-davidson-sportster", "makeId": "harley-davidson", "name": "Sportster",
      "aliases": ["xl", "iron 883"], "years": null }
  ]
}
```

`[1985, null]` = still on sale. `null` = production range unknown, which **never** yields a yellow
MODEL tile (§4.2 RULE B).

| Path | Type | Req | Meaning / constraints |
|---|---|:--:|---|
| `schema` | `1` | ✓ | |
| `generatedAt` | `YYYY-MM-DD` | ✓ | |
| `source` | `"seed" \| "wikimedia-commons" \| "wikidata" \| "commons+wikidata"` | ✓ | Provenance. |
| `makes[].id` | id | ✓ | `normalizeId(name)`. Unique. |
| `makes[].name` | string | ✓ | Canonical display, e.g. `"Harley-Davidson"`. |
| `makes[].country` | string | ✓ | **Required. LOAD-BEARING (RULE A).** ISO 3166-1 **alpha-2, uppercase**, the country the make is *from* (not where a given bike was assembled): `JP IT GB US DE AT IN CN TW ES SE CZ` and friends. Hand-authored in the seed (§6.10); `npm run catalog` preserves it. `schema/constants.ts` carries `COUNTRY_NAMES` (code → display name, e.g. `JP → "Japan"`) for the help text — the code itself is never shown to a player. |
| `makes[].aliases` | string[] | ✓ | Extra search-only strings. May be `[]`. Never rendered. |
| `models[].id` | id | ✓ | `normalizeId(make + " " + name)`. Unique. Doubles as the **dedup key**. |
| `models[].makeId` | id | ✓ | FK into `makes`. |
| `models[].name` | string | ✓ | Model only, **make not repeated**. |
| `models[].aliases` | string[] | ✓ | May be `[]`. |
| `models[].years` | `[int, int\|null] \| null` | ✓ | **LOAD-BEARING (RULE B) — no longer advisory.** `[from, to]` is the production range, inclusive at both ends. `to = null` means **still on sale**, evaluated as `to = currentYear + 1`. The whole field `null` means **unknown** → the model tile can never be yellow, only green or red. Constraint: `1885 ≤ from ≤ to ≤ currentYear + 1` (contract test §7.2 #12). Hand-authored in the seed because recon proved Wikidata carries no production dates (C1); **approximate to ±1 year is acceptable for a hint — when unsure, write `null`.** |

**`normalizeId(s)`** — **the literal function body.** `tools/lib/normalize.ts` (W2) and
`src/lib/match.ts` (W3) must contain **this code**, character for character; §7.2 #10 proves they
have not drifted. Prose descriptions of this algorithm were ambiguous and are deliberately gone.

```ts
const RUN = /[a-z]+|[0-9]+/g;

/** A run is "short" if it is a digit-run, or a letter-run of at most 3 characters. */
const isShortRun = (r: string): boolean => /^[0-9]/.test(r) || r.length <= 3;

export function normalizeId(s: string): string {
  const base = s
    .toLowerCase()
    .normalize('NFD').replace(/\p{M}/gu, '')      // strip diacritics: ČZ → cz
    .replace(/[^a-z0-9]+/g, '-')                  // every other character run → one hyphen
    .replace(/^-+|-+$/g, '');
  if (base === '') return '';

  // Segments are the hyphen-separated pieces of `base`; runs are the maximal [a-z]+ / [0-9]+
  // stretches inside a segment. A hyphen is DELETED iff both runs it sits between are short.
  // Every decision is computed against the ORIGINAL segment list in one left-to-right pass;
  // a join never re-evaluates the longer run it just created.
  const segments = base.split('-');
  const firstRun = (seg: string) => (seg.match(RUN) ?? [seg])[0];
  const lastRun  = (seg: string) => (seg.match(RUN) ?? [seg]).at(-1)!;

  let out = segments[0];
  for (let i = 1; i < segments.length; i++) {
    const join = isShortRun(lastRun(segments[i - 1])) && isShortRun(firstRun(segments[i]));
    out += (join ? '' : '-') + segments[i];
  }
  return out;
}
```

**Frozen test vectors — `normalize.test.ts` (W2) and `match.test.ts` (W3) both assert all of these:**

| Input | Output |
|---|---|
| `GSX-R 750` | `gsxr750` |
| `GSX-R750` | `gsxr750` |
| `gsxr750` | `gsxr750` |
| `Suzuki GSX-R750` | `suzuki-gsxr750` |
| `Honda CB750` | `honda-cb750` |
| `Honda FT 500` | `honda-ft500` |
| `Harley-Davidson` | `harley-davidson` |
| `Harley Davidson` | `harley-davidson` |
| `Ninja ZX-6R` | `ninja-zx6r` |
| `Kawasaki Ninja ZX-6R` | `kawasaki-ninja-zx6r` |
| `Ducati 916` | `ducati-916` |
| `ČZ` | `cz` |

(Walk one: `Honda CB750` → base `honda-cb750` → segments `honda` \| `cb750`; `honda` is a 5-letter run,
not short, so the hyphen stays. `GSX-R 750` → base `gsx-r-750` → `gsx`(3, short) + `r`(short) join,
then `r`(short) + `750`(digit, short) join → `gsxr750`.)

Ids are **opaque**: nothing may parse a make or a year back out of one. Some makes normalize
unprettily (`BMW R75/5` → `bmwr755`); that is fine and is not a bug to "fix".

Display label is always composed as `` `${make.name} ${model.name}` `` — never stored.

**Regeneration preserves hand-authored data.** `npm run catalog` **must merge, not clobber**: for every
`makes[].id` and `models[].id` already present in the committed `public/catalog.json`, the existing
`country` and `years` values win over anything the walk produced (which is nothing — recon proved
Wikidata carries neither). A newly discovered make with no `country` is written with
`"country": "??"` **and reported**, and the contract test §7.2 #11 fails until the operator fixes it —
a missing country is loud, never silent.

**Size budget:** ≤ 150 KB gzipped. The seed is 300–500 models (§6.10); a full generated catalog is
~3,000–5,000 models and still comfortable. `check-budget.ts` enforces it. If the generated catalog
ever exceeds it, drop `aliases` for the long tail first — never `country` or `years`, which are
evaluation inputs.

### 3.3 Archive manifest — `public/puzzles/manifest.json`

```json
{
  "schema": 1,
  "launchDate": "2026-09-02",
  "latest": { "date": "2026-09-04", "number": 3 },
  "puzzles": [
    { "date": "2026-09-02", "number": 1, "id": "mtd-0001" },
    { "date": "2026-09-03", "number": 2, "id": "mtd-0002" },
    { "date": "2026-09-04", "number": 3, "id": "mtd-0003" }
  ]
}
```

| Path | Type | Req | Meaning |
|---|---|:--:|---|
| `schema` | `1` | ✓ | |
| `launchDate` | `YYYY-MM-DD` | ✓ | Must equal `LAUNCH_DATE`. |
| `latest` | `{date, number}` | ✓ | Highest scheduled puzzle. |
| `puzzles[]` | entry[] | ✓ | Ascending by `number`. **Contains no answers and no image paths** — the archive list must not spoil. This is exactly why `id` is `mtd-NNNN` and carries no make/model/year (§3.1). Client filters to `date < today` for practice mode. |

### 3.4 Fetcher review file — `data/review/<batch>.json`

Written by `npm run fetch`, **edited by the operator**, consumed by `npm run schedule`.
`data/` is git-ignored except `data/review/.gitkeep`.

```json
{
  "schema": 1,
  "batch": "2026-09-02-batch01",
  "generatedAt": "2026-09-02",
  "userAgent": "motodle/0.1 (https://playmotodle.com; homelab hobby project)",
  "candidates": [
    {
      "candidateId": "M12193306",
      "decision": "pending",
      "makeId": "suzuki",
      "modelId": "suzuki-gsxr750",
      "sourceCategory": "Category:Suzuki GSX-R 750",
      "fileTitle": "File:2004 Suzuki GSXR-750 Left SIde.jpg",
      "descriptionUrl": "https://commons.wikimedia.org/wiki/File:2004_Suzuki_GSXR-750_Left_SIde.jpg",
      "thumbUrl": "https://upload.wikimedia.org/wikipedia/commons/e/ed/2004_Suzuki_GSXR-750_Left_SIde.jpg",
      "originalUrl": "https://upload.wikimedia.org/wikipedia/commons/e/ed/2004_Suzuki_GSXR-750_Left_SIde.jpg",
      "width": 800,
      "height": 600,
      "mime": "image/jpeg",
      "license": { "id": "PD", "name": "Public domain",
                   "url": "https://commons.wikimedia.org/wiki/Template:PD-user",
                   "jurisdiction": null,
                   "sdcP275": ["Q98592850"], "attributionRequired": false },
      "author": "Pawlex",
      "creditNote": null,
      "restrictions": [],
      "yearCandidates": [
        { "year": 2004, "source": "title", "pattern": "leading", "confidence": "high" },
        { "year": 2004, "source": "description", "pattern": "leading", "confidence": "high" }
      ],
      "yearProposed": 2004,
      "yearConfidence": "high",
      "warnings": ["source-width-below-min"],
      "operator": {
        "year": null,
        "focus": null,
        "sourceCrop": null,
        "cropFractions": null,
        "modelIdOverride": null,
        "note": null
      }
    }
  ]
}
```

| Path | Type | Req | Meaning |
|---|---|:--:|---|
| `candidateId` | string | ✓ | Commons M-id (`"M" + pageid`). Stable, unique. |
| `decision` | `pending\|approve\|reject` | ✓ | **Written by the fetcher as `pending`, or `reject` when auto-rejected.** `schedule` consumes `approve` only. |
| `sourceCategory` | string | ✓ | The Commons category the file was found in. Recorded because category membership is *not* a safe label (recon R5). |
| `thumbUrl` | url | ✓ | **The `imageinfo.thumburl` the API returned, verbatim, with `utm_*` stripped.** **Never construct a width** — arbitrary widths return HTTP 400 and `iiurlwidth=800` silently snaps to 960 (recon §6). The example above is the *unscaled original*, which is exactly what the API returns for this 800 px source (`utm_content=thumbnail_unscaled`, stripped). A `/thumb/…/800px-…` URL in this field is a bug. |
| `license.sdcP275` | string[] | ✓ | **Structured Data `P275` Q-ids, read via `wbgetentities`.** Multi-valued. This is authoritative; `extmetadata` collapses dual licensing (recon R10). |
| `restrictions` | string[] | ✓ | From `extmetadata.Restrictions`. `"personality"` present ⇒ auto-`reject` (identifiable people). |
| `yearCandidates[]` | obj[] | ✓ | Every 4-digit token found, with where and how it was found. Never collapsed. |
| `yearProposed` | int\|null | ✓ | Best candidate, or null. |
| `yearConfidence` | `high\|medium\|low\|none` | ✓ | §6.4. `low`/`none` ⇒ fetcher writes `decision: "reject"`. |
| `warnings` | string[] | ✓ | e.g. `source-width-below-min`, `near-duplicate-of-M…`, `uploader-series`, `year-token-ambiguous`, `unknown-p275` (§6.5). |
| `operator.*` | nullable | ✓ | **The override block. The only fields a human edits** (plus `decision`). Non-null values win over everything the fetcher proposed. `operator.year` is how a `low`-confidence candidate is rescued: setting it promotes `yearEvidence.confidence` to `"operator"`. |

**`source-width-below-min` — one rule, stated once (it was two contradictory rules before):** the
fetcher **warns and leaves `decision: "pending"`** — it never auto-rejects on width. `schedule` then
**refuses an `approve`** on a below-minimum source **unless** `operator.cropFractions` is non-null and
yields a level-1 rect ≥ `MIN_LEVEL1_PX`. All three fixtures are below the minimum and all three carry
an explicit override, which is precisely the path this rule describes (C4).

### 3.5 localStorage schema (versioned)

Namespace `motodle:` — nothing unprefixed, unlike Cardle.

**The version lives in exactly one place** — `motodle:schema`, mirrored inside each record as
`schemaVersion`. It is **not** in the key path: a `motodle:v2:stats` key would make the v1 payload
invisible to the migration that exists to read it (the hook in this section would be dead code).

| Key | Purpose | Survives day rollover |
|---|---|:--:|
| `motodle:schema` | `"1"` — the schema version of everything below. Read **first**. | ✓ |
| `motodle:today` | today's in-progress or finished game | ✗ (replaced) |
| `motodle:stats` | lifetime stats + streak | ✓ |
| `motodle:prefs` | theme, colourblind, seenHelp | ✓ |
| `motodle:practice:<YYYY-MM-DD>` | one archive game, isolated | ✓ |

**`motodle:today`:**

```json
{
  "schemaVersion": 1,
  "date": "2026-09-02",
  "number": 1,
  "puzzleId": "mtd-0001",
  "status": "in_progress",
  "guesses": [
    { "modelId": "honda-cb750", "make": "Honda", "model": "CB750", "year": 1998,
      "result": { "make": "yellow", "model": "red", "year": "yellow" } }
  ],
  "locks": { "makeId": null, "modelId": null, "year": null },
  "viewLevel": 2,
  "endedAtGuess": null,
  "score": null
}
```

| Field | Type | Meaning |
|---|---|---|
| `schemaVersion` | `1` | Mirrors `motodle:schema`. |
| `date` / `number` / `puzzleId` | | Identity. On load, if `date !== todayKey()` the record is **discarded** (never migrated into today). |
| `status` | `in_progress \| won \| lost` | `lost` covers both a 5th-guess loss and a give-up. |
| `guesses[]` | ≤ 5 | Append-only. `make`/`model` are denormalized display strings so the board renders without the catalog. **A give-up appends nothing** (§4.4). |
| `guesses[].result.*` | `green\|yellow\|red` | **All three tiles can be any of the three colours** (RULES A and B, §4.2). The example above: Honda and Suzuki are both `JP`, so the make tile is **yellow**; the CB750's range `[1969, 2003]` does not contain the answer's 2004, so the model tile is **red**. |
| `locks.makeId` | id\|null | Set when MAKE goes green. |
| `locks.modelId` | id\|null | Set when MODEL goes green. Implies `locks.makeId`. |
| `locks.year` | int\|null | **The player's green guess, not the answer.** |
| `viewLevel` | 1..5 | Which crop the player is currently scrubbed to. `≤ unlockedLevel`. |
| `endedAtGuess` | 1..5 \| null | The guess number the game ended on. Drives the multiplier. |
| `score` | 0..15 \| null | Final score, written once at game end. |

**`motodle:stats`:**

```json
{
  "schemaVersion": 1,
  "played": 12,
  "wins": 9,
  "currentStreak": 3,
  "maxStreak": 5,
  "lastWinDate": "2026-09-14",
  "lastCompletedDate": "2026-09-14",
  "scoreDistribution": { "0": 1, "1": 1, "2": 1, "3": 0, "6": 2, "9": 3, "12": 3, "15": 1 }
}
```

`scoreDistribution` keys are exactly the **8 achievable scores** `{0,1,2,3,6,9,12,15}` (§4.3) — always
all 8 present, zeros included. `played` counts **completed** games only; an abandoned day is never
counted as a loss (it simply fails to extend the streak). Both date fields are **puzzle dates, never
wall-clock dates**, and their write rules are frozen in §4.3. (`guessDistribution` was removed: the
StatsModal renders only the 8 score buckets, so nothing consumed it and no agent was told to write it.
A frozen contract carries no unowned fields.)

**`motodle:prefs`:** `{ "schemaVersion": 1, "theme": "system"|"light"|"dark", "colorblind": false, "seenHelp": true }`

**`motodle:practice:<date>`:** identical shape to `motodle:today`, plus `"practice": true`.
**Never touches `motodle:stats`.** Persisted so a practice game can be resumed. **Pruned to the 30
most recently touched records** (evict oldest `date` first) on every practice write, so archive play
cannot grow storage without bound or trip `QuotaExceededError`.

**Migration hook** — `src/lib/storage.ts`:

```ts
export const STORAGE_VERSION = 1;
/** MIGRATIONS[v] migrates a v payload to v+1. Keys never carry a version, so a v1 payload
 *  is still sitting at `motodle:stats` when the v2 code reads it. */
type Migration = (raw: unknown) => unknown;
const MIGRATIONS: Record<number, Migration> = { /* 1: (raw) => …  add on bump */ };

export function loadVersioned<T>(key: string, fallback: T): T {
  // read motodle:schema; if stored < STORAGE_VERSION apply MIGRATIONS[v] for v = stored .. STORAGE_VERSION-1
  // in ascending order, then rewrite the record; after a full successful pass over every key,
  // rewrite motodle:schema to String(STORAGE_VERSION).
  // any throw / parse error / unknown-newer version ⇒ return fallback and DO NOT delete the raw value
}
```

A stored version **newer** than the code returns the fallback and leaves the data untouched (an older
deployed bundle must never destroy a newer client's stats). Every read is wrapped in `try/catch` —
private mode and blocked site data must degrade to an in-memory session, not a crash.

**Storage backend seam (the sync hook, §9.1):**

```ts
export interface StorageBackend {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  subscribe(fn: (key: string) => void): () => void;   // cross-tab today, cross-device later
}
export class LocalStorageBackend implements StorageBackend { /* + a `storage` event listener */ }
export class MemoryBackend implements StorageBackend { /* used by tests and by private mode */ }
```

Everything in `src/` reads storage **only** through the injected backend. That single seam is the
entire login/sync hook.

### 3.6 Fixture source — `fixtures/fixtures.json`

Input to the offline `npm run generate`. Same credit/yearEvidence blocks as §3.1 plus:

| Field | Type | Req | Meaning |
|---|---|:--:|---|
| `id` | string | ✓ | **The single source of truth for this puzzle's id** — `mtd-0001`, `mtd-0002`, `mtd-0003`. `generate` **copies** it into `public/puzzles/<date>.json`; it never mints one for a fixture, and it never renumbers. Must satisfy `id === "mtd-" + String(number).padStart(4,'0')` where `number = puzzleNumber(date)` — a contract test asserts it (§7.2 #4). |
| `file` | rel path | ✓ | into `fixtures/images/` |
| `date` | `YYYY-MM-DD` | ✓ | scheduled date |
| `answer` | Answer | ✓ | as §3.1, including `acceptModelIds` |
| `focus`, `sourceCrop`, `cropFractions` | | ✓ | as §3.1 (`sourceCrop` may be `null`) |
| `credit`, `yearEvidence` | | ✓ | as §3.1, copied through verbatim — including `credit.modified` |

### 3.7 TypeScript type names in `schema/types.ts`

Exact exported names. Every agent imports these; nobody redefines them.

```
Schema1                LicenseId              TileResult = 'green'|'yellow'|'red'
Puzzle                 LicenseRef             GuessRecord
PuzzleAnswer           CreditBlock            GameStatus = 'in_progress'|'won'|'lost'
PuzzleImage            YearEvidence           TodayState
CropLevel              YearConfidence         StatsState
CropRect               Catalog                PrefsState
FocusPoint             CatalogMake            PracticeState
SourceCrop             CatalogModel           StorageBackend
Manifest               CatalogIndex           StorageVersion
ManifestEntry          MatchResult            FixtureSource
ReviewFile             MatchTier              BudgetReport
ReviewCandidate        OperatorOverride       ShareSink
ReviewDecision         CountryCode            GuessInput
                                              TileStates
```

**The one shared evaluator.** Every tile colour in the app, in the tests and in the e2e specs comes
from this function and nowhere else. Its signature is part of the frozen contract:

```ts
export type CountryCode = string;                 // ISO 3166-1 alpha-2, uppercase, e.g. 'JP'
export type TileResult  = 'green' | 'yellow' | 'red';

export interface GuessInput  { makeId: string; modelId: string; year: number }
export interface TileStates  { make: TileResult; model: TileResult; year: TileResult }

/** Pure. No DOM, no storage, no clock. Lives in `src/lib/game.ts` (W3); imported by the
 *  game store, by `game.test.ts`, and by the §7.2 contract suite. Never re-implemented. */
export function evaluateGuess(
  guess: GuessInput,
  answer: PuzzleAnswer,
  catalog: CatalogIndex,
): TileStates;
```

`CropRect = { w: number; h: number }` — the extracted source rect recorded on every `CropLevel`
(§3.1). `ShareSink` is the injected delivery adapter (§4.4); `src/lib/share.ts` exports only the pure
`buildShareText(...)`.

---

## 4. Game logic spec

All logic in `src/lib/`, pure, no DOM, fully unit-tested.

### 4.1 Puzzle number arithmetic (DST-proof)

```ts
export const LAUNCH_DATE = '2026-09-02';        // schema/constants.ts
export const PUZZLE_NUMBER_OFFSET = 1;          // 2026-09-02 ⇒ #1  (operator decision D1, §1.3)

/** Local calendar date → 'YYYY-MM-DD'. Never uses toISOString (that is UTC). */
export function todayKey(d = new Date()): string {
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  return `${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

/** Days between two local calendar dates. Uses Date.UTC on the LOCAL y/m/d components,
 *  which removes DST entirely — no 23h or 25h day can shift the count. */
function dayIndex(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function puzzleNumber(key: string): number {
  return dayIndex(key) - dayIndex(LAUNCH_DATE) + PUZZLE_NUMBER_OFFSET;
}
```

Worked: `puzzleNumber('2026-09-02') = 1`, `('2026-09-03') = 2`, `('2026-11-02') = 62`
(spans the US DST end on 2026-11-01 — still exactly 61 days later, because the arithmetic never
touches a wall clock). `('2026-09-01') = 0` ⇒ before launch ⇒ the client shows "no puzzle" without
fetching.

### 4.2 Per-category evaluation — the single pure function

**All three tiles are produced by one function, `evaluateGuess()` (§3.7 signature).** W3 writes it in
`src/lib/game.ts`; `game.test.ts`, the §7.2 contract suite and the UI all import *that* function. No
component, no store and no test may compute a tile colour by itself — that duplication is exactly how
two workstreams end up disagreeing about a colour.

```ts
export function evaluateGuess(guess, answer, catalog): TileStates {
  const gMake  = catalog.makes.get(guess.makeId);      // guessed make   (must exist)
  const aMake  = catalog.makes.get(answer.makeId);     // answer's make  (must exist)
  const gModel = catalog.models.get(guess.modelId);    // guessed model  (must exist)

  // ---- RULE A: MAKE -------------------------------------------------------
  const make: TileResult =
      guess.makeId === answer.makeId              ? 'green'
    : gMake.country === aMake.country             ? 'yellow'
    :                                               'red';

  // ---- RULE B: MODEL ------------------------------------------------------
  // NOTE: the range is tested against the ANSWER's year, never the year the player typed.
  const model: TileResult =
      answer.acceptModelIds.includes(guess.modelId) ? 'green'
    : onSaleIn(gModel.years, answer.year)           ? 'yellow'
    :                                                 'red';

  // ---- YEAR (unchanged) ---------------------------------------------------
  const d = Math.abs(guess.year - answer.year);
  const year: TileResult = d <= 2 ? 'green' : d <= 10 ? 'yellow' : 'red';

  return { make, model, year };
}

/** years = [from, to] | null.  to === null  ⇒ still on sale ⇒ treated as currentYear + 1.
 *  years === null (unknown) ⇒ never yellow. */
function onSaleIn(years: [number, number | null] | null, answerYear: number): boolean {
  if (years === null) return false;
  const [from, to] = years;
  return answerYear >= from && answerYear <= (to ?? new Date().getFullYear() + 1);
}
```

Comparison is on **ids**, never on display strings — this fixes Cardle's case-sensitive `===` on raw
labels. An id missing from the catalog is a **programming error, not a red tile**: the combobox cannot
submit a guess that is not a catalog entry (§5.3), so `evaluateGuess` throws on an unknown id and a
unit test pins that.

**Invariants the evaluator asserts:**
- A **green MODEL implies a green MAKE** — a model belongs to exactly one make (unchanged).
- A **yellow MODEL implies nothing** about the make tile: the guessed model's make may be the
  answer's make (make green), a compatriot (yellow) or neither (red). All three combinations are
  reachable and all three are tested.
- **Yellow never locks and never scores** on any tile — only green does (§4.3).

**RULE A — MAKE, worked. Answer = Suzuki (`JP`):**

| Guessed make | Country | Tile | Why |
|---|---|---|---|
| Suzuki | JP | 🟩 green | same make |
| Honda | JP | 🟨 yellow | different make, same country |
| Kawasaki | JP | 🟨 yellow | different make, same country |
| Ducati | IT | 🟥 red | different country |
| Triumph | GB | 🟥 red | different country |
| Harley-Davidson | US | 🟥 red | different country |

The country is a property of the **make**, not of a factory: Triumph is `GB` even for a
Thailand-built bike, KTM is `AT`, Royal Enfield is `IN`, CFMoto is `CN`, Kymco is `TW`, Derbi is `ES`,
Husqvarna is `SE` (historically) and Jawa/ČZ are `CZ`. `makes[].country` is required for every make
(§3.2) so this branch can never read `undefined`.

**RULE B — MODEL, worked. Answer = Suzuki GSX-R750, `answer.year = 2004`,
`acceptModelIds = ["suzuki-gsxr750"]`:**

| Guessed model | `years` | Tile | Why |
|---|---|---|---|
| Suzuki GSX-R750 | `[1985, null]` | 🟩 green | in `acceptModelIds` — the range is not even consulted |
| Honda CBR600F | `[1987, 2007]` | 🟨 yellow | 1987 ≤ **2004** ≤ 2007 |
| Yamaha R1 | `[1998, null]` | 🟨 yellow | `to = null` ⇒ still on sale ⇒ `≤ currentYear + 1` |
| Ducati 916 | `[1994, 2004]` | 🟨 yellow | **answer year equals `to` — inclusive, still yellow** |
| Kawasaki ZX-10R | `[2004, null]` | 🟨 yellow | **answer year equals `from` — inclusive, still yellow** |
| Honda CB750 | `[1969, 2003]` | 🟥 red | 2003 < 2004 — **one year outside the late end** |
| Kawasaki H2R | `[2005, 2020]` | 🟥 red | 2005 > 2004 — **one year outside the early end** |
| Harley-Davidson Sportster | `null` | 🟥 red | **range unknown ⇒ never yellow** |
| Triumph Bonneville T120 | `[1959, 1974]` | 🟥 red | far outside |

**The comparison is always against `answer.year`.** A player who guesses "Honda CB750, 1972" against a
2004 answer gets a **red** model tile (the CB750 was not on sale in 2004) and a **red** year tile
(|Δ| = 32) — the model tile is *not* told that 1972 is inside the CB750's own range. Yellow means
*"this bike existed in the answer's year"*, which is a hint about the answer, not about the guess.

**Year band boundaries — worked, answer = 2004:**

| Guess | \|Δ\| | Tile | Why |
|---|---|---|---|
| 2004 | 0 | 🟩 green | ≤ 2 |
| 2006 | 2 | 🟩 green | **exactly 2 is green** |
| 2002 | 2 | 🟩 green | symmetric |
| 2007 | 3 | 🟨 yellow | **exactly 3 is the first yellow** |
| 2001 | 3 | 🟨 yellow | symmetric |
| 2014 | 10 | 🟨 yellow | **exactly 10 is still yellow** |
| 1994 | 10 | 🟨 yellow | symmetric |
| 2015 | 11 | 🟥 red | **exactly 11 is the first red** |
| 1993 | 11 | 🟥 red | symmetric |
| 1885 | 119 | 🟥 red | |

### 4.3 Locking, scoring, endings

**Locking.** Green **locks** the category for every later guess. **Yellow locks nothing on any tile** —
a same-country make (RULE A) and an on-sale-that-year model (RULE B) are hints, not partial credit;
they never pre-fill, never filter and never score.

| Lock | Effect on the form |
|---|---|
| MAKE green, MODEL not green | Combobox stays editable but is **filtered to that make's models only**; the make is shown as a non-removable chip. |
| MODEL green (⇒ MAKE green) | Combobox is disabled and shows **the player's own matched entry** — the label of the catalog entry they chose, never `answer.model`. When the guess matched through `acceptModelIds` (player typed *Ducati Monster 900*, answer is *Ducati Monster*), showing the canonical answer would leak it. Same rule as the year lock. Only the year is editable. |
| YEAR green | Year input disabled, **pre-filled with the player's own green guess** — never the answer, because that would leak the exact year through the ±2 band. |

A locked category is **re-scored as green on every subsequent guess** (it is not re-entered and cannot
regress). This is what makes Cardle's double-count bug (C8) structurally impossible.

**Duplicate guesses are allowed.** Submitting the same make/model/year twice is legal and costs the
player a guess, exactly as Wordle permits repeats. There is no "you already guessed that" rejection —
it would need its own error surface and would be the only place in the form that refuses a valid
catalog entry.

**Scoring.**

```
points     = number of categories GREEN at game end        (0..3)
multiplier = won ? 6 - endedAtGuess : 1                    (win: 5,4,3,2,1 for guesses 1..5)
score      = points * multiplier                           (0..15)
```

A loss after guess 5 and a give-up both use **multiplier 1**.

**Achievable scores — exactly 8 values, and this is the stats distribution:**

| Outcome | points | mult | score |
|---|:--:|:--:|:--:|
| Win on guess 1 | 3 | 5 | **15** |
| Win on guess 2 | 3 | 4 | **12** |
| Win on guess 3 | 3 | 3 | **9** |
| Win on guess 4 | 3 | 2 | **6** |
| Win on guess 5 | 3 | 1 | **3** |
| Loss / give-up, 2 green | 2 | 1 | **2** |
| Loss / give-up, 1 green | 1 | 1 | **1** |
| Loss / give-up, 0 green | 0 | 1 | **0** |

`{0,1,2,3,6,9,12,15}`. A loss can never score 3+ from a partial board (max 2 green — 3 green ends the
game as a win). `scoreDistribution` therefore has exactly these 8 fixed buckets.

**Endings.**

| Trigger | `status` | `endedAtGuess` | Streak effect |
|---|---|---|---|
| All three green after guess *n* | `won` | *n* | `lastWinDate === yesterday ? +1 : reset to 1`; `maxStreak = max(…)` |
| Guess 5 submitted, not all green | `lost` | 5 | `currentStreak = 0` |
| Give-up pressed during guess *n* | `lost` | *n* (multiplier still 1) | `currentStreak = 0` |
| Day abandoned (never completed) | — | — | **Not counted.** `played` unchanged, streak simply fails to extend. |

Give-up requires a confirmation step ("Give up? This counts as a loss.") — it is irreversible.
**A give-up appends no guess row** (§4.4): `endedAtGuess = guesses.length + 1`.

**Streak and stats arithmetic — frozen, because "yesterday" is ambiguous exactly where it matters.**
Everything below is keyed to `puzzle.date`, **never to the wall clock**. A player who finishes
yesterday's puzzle at 00:30 today extends yesterday's streak, not today's.

```ts
// stats.ts — the ONLY writer of motodle:stats. Called once, at game end, for a non-practice game.
export function recordCompletion(stats: StatsState, puzzle: Puzzle, r: Result): StatsState {
  if (stats.lastCompletedDate === puzzle.date) return stats;   // IDEMPOTENT — see below
  const next = { ...stats };
  next.played += 1;
  next.scoreDistribution[r.score] += 1;
  next.lastCompletedDate = puzzle.date;                        // always the PUZZLE's date
  if (r.won) {
    next.wins += 1;
    const consecutive = stats.lastWinDate !== null
      && dayIndex(puzzle.date) - dayIndex(stats.lastWinDate) === 1;
    next.currentStreak = consecutive ? stats.currentStreak + 1 : 1;
    next.maxStreak = Math.max(stats.maxStreak, next.currentStreak);
    next.lastWinDate = puzzle.date;                            // always the PUZZLE's date
  } else {
    next.currentStreak = 0;                                    // lastWinDate is NOT cleared
  }
  return next;
}
```

- `lastWinDate` ← `puzzle.date` on a win; **left untouched** on a loss (only `currentStreak` resets).
- `lastCompletedDate` ← `puzzle.date` on every completion, win or loss. It has exactly one consumer:
  the idempotency guard on the first line.
- **"Yesterday" is `dayIndex(puzzle.date) − dayIndex(lastWinDate) === 1`** (§4.1's DST-proof
  `dayIndex`), never a `Date` subtraction and never `todayKey()`.
- **The whole update is a no-op when `lastCompletedDate === puzzle.date`.** Two tabs finishing the same
  day, or a completion replayed through a cross-tab `subscribe()` event, must not double-count
  `played`, the distribution or the streak. This is the same class of defect as Cardle's C8, one layer
  up.
- Practice never reaches this function at all — the practice store is built with a `NullStatsSink`
  (§4.6).

### 4.4 Share text

```
Motodle #<number> <score>/15
<blank line>
<row per guess: 3 tiles, no separators>
<blank line>
<SITE_URL>
```

Tiles: `🟩` green, `🟨` yellow, `🟥` red. Colourblind mode: `🟧` green, `🟦` yellow, **`⬜` red** —
Wordle's high-contrast set. (`⬛` was rejected: it is invisible against the dark background of most
chat clients, which is where a shared grid is actually read.)

**Yellow now appears on all three tiles** (RULES A and B, §4.2). Nothing else in this section changes:
the glyphs already existed, and **scoring counts only green** (§4.3), so a row like `🟨🟨🟨` is worth
zero points.

**Exact string rules — `share.test.ts` asserts these byte for byte:**
- The grid has **exactly `guesses.length` rows**. A give-up appends no row (§4.3).
- **A zero-row grid collapses**: header, one blank line, URL. Never two consecutive blank lines.
- **No trailing newline.** The string ends with the last character of the URL.
- `SITE_URL` is imported from `src/config.ts` (§10.6), never hard-coded in `share.ts` or in the test —
  changing the domain must stay a one-line config edit.

**Win on guess 2** (answer 2004 Suzuki GSX-R750 `JP`; guess 1 = Triumph Bonneville T120 `GB`,
`years [1959,1974]`, year 1998 → red / red / yellow; guess 2 = Suzuki GSX-R750 2003 → all green):

```
Motodle #1 12/15

🟥🟥🟨
🟩🟩🟩

https://playmotodle.com
```

**Loss** (5 guesses; make locked green from guess 2 on, model never found — every wrong model is a
Suzuki that was off sale in 2004, e.g. GT750 `[1971,1977]` — year yellow throughout → points 1,
multiplier 1, score 1):

```
Motodle #4 1/15

🟥🟥🟨
🟩🟥🟨
🟩🟥🟨
🟩🟥🟨
🟩🟥🟨

https://playmotodle.com
```

**Give-up during guess 3** — two guesses were submitted, so the grid has **2 rows**, not 3 (make
green from guess 2, model red, year red → points 1, score 1):

```
Motodle #7 1/15

🟥🟥🟥
🟩🟥🟥

https://playmotodle.com
```

**Give-up during guess 1** — nothing submitted, so the grid is empty and collapses to a single blank
line:

```
Motodle #9 0/15

https://playmotodle.com
```

A give-up is **deliberately indistinguishable from a loss** in the share text — no scarlet letter.

**Practice share** prefixes the header: `Motodle #2 (practice) 9/15`, and appends no streak.

**`buildShareText()` is pure and lives in `src/lib/share.ts`** — string in, string out, no DOM. That
is the whole of what `share.test.ts` byte-tests, and it is what keeps W3's "no DOM API in `src/lib/`"
DoD honest.

**Delivery is a separate injected `ShareSink`** (`src/state/share.ts`, W4), the same seam pattern as
`StorageBackend`. Order (recon C6): `navigator.share({text})` when present →
`navigator.clipboard.writeText` → `document.execCommand('copy')` on a temporary readonly `<textarea>`
→ visible selectable `<pre>` with "select and copy". **The share string is built synchronously inside
the click handler and `writeText` is called before any `await`** — Safari consumes the user activation
otherwise. `AbortError` from `navigator.share` (user dismissed the sheet) is silently ignored, not
reported. The e2e clipboard spec stubs the sink's `navigator.share` branch away (§7.4 step 7).

### 4.5 Rollover while the page is open

- A watcher re-evaluates `todayKey()` on `visibilitychange`, on `focus`, and on a **60 s** interval.
- On change: set `staleDay = true`. Render a **persistent, non-dismissable banner**: *"A new Motodle
  is ready — Reload"*. Do **not** auto-navigate; a player mid-guess must not lose their board.
- **The two days' state never mixes.** The in-memory game keeps its own `date`; all writes go to
  `motodle:today` keyed by *that* date. On reload, if the stored `date !== todayKey()`, the record
  is discarded outright (it was either finished — stats already recorded at completion — or abandoned,
  which counts as nothing).
- The stats-modal countdown targets the **next local midnight**, ticks at 1 Hz, and is cleared on
  unmount.

### 4.6 Practice / archive isolation

- Entered via `?d=YYYY-MM-DD`. `ArchiveList` shows manifest entries with `date < todayKey()` only —
  a future or current date in the query string redirects to today.
- State lives in `motodle:practice:<date>`, a separate key.
- `stats.ts` is **never called** in practice mode — enforced by construction: the practice store is
  built with a `NullStatsSink`, not by an `if` at each call site. A unit test asserts
  `motodle:stats` is byte-identical before and after a full practice playthrough.
- The UI is unmistakably labelled: a persistent "Practice · Motodle #N" bar and a "Back to today"
  button. Share text carries `(practice)`.

### 4.7 Crop geometry — the single named constant

`schema/constants.ts`:

```ts
/** Level 1..5, a GEOMETRIC sequence (revision 9, §4.7a): fᵢ = 0.11 · r^(i-1) with
 *  r = (0.95 / 0.11)^(1/4) = 1.71428, rounded to 2 dp. Exact sequence:
 *  0.11000, 0.18857, 0.32326, 0.55417, 0.95000. Every per-puzzle override re-derives r
 *  from its own f1 the same way — see §4.7a and contract test §7.2 #15. */
export const DEFAULT_CROP_FRACTIONS = [0.11, 0.19, 0.32, 0.55, 0.95] as const;  // level 1..5
export const CROP_ASPECT = 4 / 3;
export const CROP_TARGET_WIDTH = 900;   // max output width; never upscales
export const MIN_LEVEL1_PX = 240;       // hard validation floor (§4.7a decision (b))
/** DERIVED, never hand-set: a source narrower than this cannot satisfy MIN_LEVEL1_PX
 *  at the default fractions, so the fetcher must not approve it without an override. */
export const MIN_SOURCE_WIDTH =
  Math.ceil(MIN_LEVEL1_PX / DEFAULT_CROP_FRACTIONS[0]);   // = 2182
export const DEFAULT_FOCUS = { x: 0.5, y: 0.5 } as const;

/** Every budget referenced anywhere in this plan lives HERE — one place, imported by
 *  tools/crop.ts and tools/check-budget.ts. Prose never carries a second copy. */
export const CROP_BUDGET_BYTES   = 360_000;   // sum of the 5 level WebPs
export const FULL_BUDGET_BYTES   = 250_000;   // the lazy full reveal (outside the day budget)
export const DAY_BUDGET_BYTES    = 400_000;   // puzzle JSON + its 5 levels, raw (brief)
export const JS_GZ_BUDGET_BYTES  = 60 * 1024; // app JS, gzipped (brief)
export const CSS_GZ_BUDGET_BYTES = 20 * 1024; // app CSS, gzipped
export const CATALOG_GZ_BUDGET_BYTES = 150 * 1024;  // public/catalog.json, gzipped (brief)

export const FULL_TARGET_WIDTH = 1400;
export const WEBP_QUALITY_START = 80;
export const WEBP_QUALITY_MIN = 56;
export const WEBP_QUALITY_STEP = 4;

/** ISO 3166-1 alpha-2 → display name, for the help text only (RULE A, §4.2). */
export const COUNTRY_NAMES: Record<string, string> = {
  JP: 'Japan', IT: 'Italy', GB: 'United Kingdom', US: 'United States', DE: 'Germany',
  AT: 'Austria', IN: 'India', CN: 'China', TW: 'Taiwan', ES: 'Spain', SE: 'Sweden',
  CZ: 'Czechia', /* … one entry per country used by any make in the catalog … */
};
```

**`MIN_SOURCE_WIDTH` is checked against the usable 4:3 width, not the raw width.** The gate is
`min(W, round(H × CROP_ASPECT)) ≥ MIN_SOURCE_WIDTH`, where `W`/`H` are the **source-cropped**
dimensions. A 3000×1000 panorama passes a naive `W ≥ 2182` test but has `bw0 = 1333` and a level-1
rect of 147 px — under the floor. The same expression backs `--min-width` in `tools/fetch.ts`, so the
fetcher and the crop tool cannot disagree.

`focus` semantics: fractions of the **source-cropped** image (after `sourceCrop`), `{0,0}` = top-left.
The crop rect is centred on the focus point and then **clamped into the image**, so an edge focus
yields an edge-aligned rect rather than an out-of-bounds one.

Algorithm (validated by the toolchain probe's clamp cases, including 0.95/0.95, 0.02/0.02 and an
oversize fraction — all four produced in-bounds integer rects that `sharp.extract()` accepted):

```ts
// W,H = source-cropped dimensions
const [bw0, bh0] = (W / H >= CROP_ASPECT)
  ? [Math.round(H * CROP_ASPECT), H]      // largest 4:3 rect that fits
  : [W, Math.round(W / CROP_ASPECT)];

for (const f of cropFractions) {          // geometric: f[i]/f[i-1] is constant, §4.7a
  let bw = Math.min(Math.round(f * bw0), W);
  let bh = Math.min(Math.round(bw / CROP_ASPECT), H);
  bw = Math.min(bw, Math.round(bh * CROP_ASPECT));          // re-fit aspect after clamping
  const left = clamp(Math.round(fx * W - bw / 2), 0, W - bw);
  const top  = clamp(Math.round(fy * H - bh / 2), 0, H - bh);
  sharp(src).extract({ left, top, width: bw, height: bh })
            .resize({ width: Math.min(CROP_TARGET_WIDTH, bw), withoutEnlargement: true })
            .webp({ quality: q });
  // record BOTH: rect = { w: bw, h: bh } (the extract) and w/h = the encoded output size.
}
```

**Every level records two sizes** (§3.1): `rect` — the extracted source rect — and `w`/`h`, the encoded
output after `min(CROP_TARGET_WIDTH, rect.w)`. They differ whenever a rect exceeds 900 px, and that is
why the monotonicity invariant belongs to `rect`, not to `w`.

**Two invariants the tool asserts and a unit test covers:**
1. Level-1 rect width ≥ `MIN_LEVEL1_PX`, else error: *"source too small — supply `cropFractions` or a
   larger source"*. (This is exactly why **all three** fixtures ship an override — every one of them
   is below `MIN_SOURCE_WIDTH`, C4 — and the override must itself be geometric, §4.7a.)
2. **`rect.w` is strictly increasing** across levels 1→5. A tie means the fractions collapsed against a
   clamp and the reveal would stall — hard error. **Output `w` is only required to be non-decreasing**:
   once two rects both exceed `CROP_TARGET_WIDTH` they encode to the same 900 px width, which is
   correct behaviour and which fixture 3 actually exhibits (§6.9). The §7.2 #8 contract test asserts
   exactly this pair of rules.

**Level 1 is never upscaled.** `resize({ withoutEnlargement: true })` is load-bearing, not
incidental: the level-1 file is painted into a ≤ 360 CSS px box, so on a DPR-2 phone it is already
being upscaled ~3× by the browser, and `levels[].w` is contracted (§3.1) as the honest count of real
output pixels. A bounded pipeline upscale was considered for revision 9 and rejected — §4.7a (c).

**Quality search:** start `q = WEBP_QUALITY_START (80)`, step −`WEBP_QUALITY_STEP (4)` down to
`WEBP_QUALITY_MIN (56)`, pick the first quality where `sum(level bytes) ≤ CROP_BUDGET_BYTES`. If none
fits, error.

**The full reveal** is encoded separately, and:
- `width = min(FULL_TARGET_WIDTH, sourceCroppedW)`, where **`sourceCroppedW` is the width *after*
  `sourceCrop`** — never the original. The full reveal must never show what `sourceCrop` removed; that
  is the entire point of the 916's placard crop, and a full reveal built from the original would put
  the answer back on screen at the moment the answer is revealed.
- It runs **the same descending-quality search** (80 → 56, step 4) against `FULL_BUDGET_BYTES`, and
  errors only if nothing fits. (Without a search, one detailed photo silently blows the budget.)
- It keeps the source-cropped aspect ratio — **not** 4:3 (§3.1) — so `ResultModal` letterboxes it.
- It is **not** counted against the 400 KB day budget (it is fetched lazily at game end).

---

### 4.7a Zoom schedule (revision 9) — the geometric ladder

**User feedback, 2026-09-03:** *"The images should be much more cropped at first. Maybe zoom out
logarithmically — worth a try."* The complaint is correct and it is worse than the default constant
suggests: what the live site actually serves is the **three fixture overrides**, and fixture 1's
level 1 (`f = 0.40` of an 800 px source) already spells **SUZUKI** across the frame. Level 1 was
giving the make away for free, and consecutive levels differed by as little as 22 % (fixture 1's
1.30 / 1.27 / 1.24 / 1.22) — the reveal barely moved.

#### The rule

> **`cropFractions` is a geometric sequence.** Pick the level-1 fraction `f1` and the level-5
> fraction `f5`; every schedule is `fᵢ = f1 · r^(i−1)` with `r = (f5 / f1)^(1/4)`, rounded to two
> decimals. **Consecutive ratios must stay within ±3 % of `r`.** This holds for
> `DEFAULT_CROP_FRACTIONS` *and* for every per-puzzle override — an override re-derives `r` from its
> own `f1`, it does not invent a shape.

A constant ratio is what "zoom out logarithmically" means: each guess buys the same *multiple* of
field of view, so the reveal feels even instead of front-loaded. The old default's ratios
(1.67 / 1.60 / 1.55 / 1.53) were already near-geometric; the fixtures' hand-typed overrides
(1.30 / 1.27 / 1.24 / 1.22 on fixture 1) were not, and that is the drift the rule closes.

#### The chosen constant

```ts
/** Level 1..5, a geometric sequence: fᵢ = 0.11 · r^(i-1), r = (0.95/0.11)^(1/4) = 1.71428,
 *  rounded to 2 dp. Exact sequence 0.11000, 0.18857, 0.32326, 0.55417, 0.95000. §4.7a. */
export const DEFAULT_CROP_FRACTIONS = [0.11, 0.19, 0.32, 0.55, 0.95] as const;
export const MIN_LEVEL1_PX = 240;   // was 280 — see decision (b)
export const MIN_SOURCE_WIDTH = Math.ceil(MIN_LEVEL1_PX / DEFAULT_CROP_FRACTIONS[0]); // = 2182
```

Realised ratios 1.7273 / 1.6842 / 1.7188 / 1.7273 — deviations from `r` of +0.76 %, −1.75 %,
+0.26 %, +0.76 %, all inside the ±3 % band. `f5` is unchanged at 0.95, so **level 5 is the same
full view as today**; only the approach to it changes. Level 1 now shows **46 % less area** than
before ((0.11/0.15)² = 0.538) and each step opens up **1.71×** instead of ~1.58×.

#### The four decisions, and the evidence

Three candidate schedules plus today's were rendered on all three fixtures with the real
`computeExtractRects()` / resize / quality-search pipeline out of `tools/crop.ts`, and the contact
sheets were looked at. Two extra probes separated the two things that get confused here — **field of
view** (set by `f1`) and **resolution** (set by `MIN_LEVEL1_PX`).

**(a) Fractions — `[0.11, 0.19, 0.32, 0.55, 0.95]`, `r = 1.714`.** The level-1 field-of-view ladder
was rendered at `f1` ∈ {0.07, 0.09, 0.11, 0.13, 0.15, 0.19} on the 916 at two focus points (one on
structure — fork/frame/exhaust header — and one on the shipped focus, which lands on flat bodywork):

| `f1` | tried | verdict from the sheets |
|---|---|---|
| 0.07 | brief's example, `r ≈ 1.92` | **Rejected.** Levels 1 *and* 2 are featureless colour fields at *both* focus points — a pipe and an orange smear, no scale cue, no object. Two of five guesses carry zero information. |
| 0.09 | `r ≈ 1.80` | **Rejected.** Level 1 is still a texture patch (flat red panel + a shadow line) at both focus points. Level 2 recovers, but level 1 is a wasted guess. |
| **0.11** | `r = 1.714` | **Chosen.** The tightest fraction at which the structured-focus crop still contains a whole recognisable object (exhaust header + trellis frame + shock spring) and the flat-focus crop still contains a body seam and a fastener. |
| 0.13–0.15 | `r ≈ 1.65 / 1.59` | Legible, but only 25 %/0 % tighter than today — does not answer the feedback. |

**(b) `MIN_LEVEL1_PX` — 240** (down from 280). One fixed field of view was encoded at 180 / 220 /
240 / 280 / 360 / 480 px and each painted at **720 device px** — the real worst case, since the
level-1 image is displayed at ≤ 360 CSS px and a DPR-2 phone paints that into 720 device px. On the
high-contrast crop (fork, disc, caliper) 240 and 280 are indistinguishable and 180 smears. On the
low-contrast crop (bodywork + Agip decal) the decal's lettering is crisp at 280 and 240, marginal at
220, and mush at 180. **240 sits above the break with margin;** 220 sits on the slope and was
rejected — the fixtures are bright, sharp studio-ish photos, and the floor has to survive darker and
softer Commons sources than these.

**(c) Level-1 upscale — NO.** `resize({ withoutEnlargement: true })` stays exactly as it is, and
`tools/crop.ts` needs **no geometry change at all**. Reasons: the level-1 file is painted into a
≤ 360 CSS px box, so at DPR 2 a 240 px encode is *already* being upscaled 3.0× by the browser —
re-doing that upscale in libvips adds bytes and exactly zero information; and `levels[].w` is
contracted (§3.1) as "intrinsic **output** pixels … which never upscales", i.e. it is the app's
honest statement of how much real detail the file carries. An upscaled level 1 would make that field
lie, for no pixel gained.

**(d) `MIN_SOURCE_WIDTH` — 2182** (`ceil(240 / 0.11)`, up from 1867). The alternatives, for the
record:

| `f1` | floor | `MIN_SOURCE_WIDTH` | note |
|---|---|---|---|
| 0.07 | 280 / 240 | 4000 / 3429 | brief's example — excludes half the usable band |
| 0.09 | 280 / 240 | 3112 / 2667 | |
| 0.11 | 280 | 2546 | |
| **0.11** | **240** | **2182** | **chosen** |
| 0.11 | 220 | 2000 | floor too soft (b) |
| 0.12 | 240 | 2000 | the fallback if 2182 ever proves too tight in practice |
| 0.15 | 280 | 1867 | today |

**Share of Commons motorcycle photos admitted — an estimate, and the assumption is stated because
there is no width histogram anywhere in the §6 recon.** The recon records exactly three source
widths (800, 960, 2048) and nothing else, so this uses the brief's own stated band, **2000–6000 px**:

- uniform over [2000, 6000]: the excluded slice [2000, 2182) is 4.6 % ⇒ **≈ 95 % admitted**
- log-uniform over [2000, 6000] (the more realistic model — camera output clusters at the high end):
  `ln(2182/2000) / ln(3) = 7.9 %` excluded ⇒ **≈ 92 % admitted**

Today's 1867 admits 100 % of that band, so the change costs **5–8 points**. The gate is checked
against the **usable 4:3 width** `min(W, round(H × CROP_ASPECT))` (§4.7), so ordinary 3:2 and 4:3
landscape photos are unaffected; only tall or panoramic sources lose ground, and those were already
the ones the gate exists for.

**Fetcher-gate consequence — nothing is silently binned.** §3.4's single `source-width-below-min`
rule is unchanged and does the work: `tools/fetch.ts` **warns and leaves `decision: "pending"`** — it
never auto-rejects on width — and `tools/schedule.ts` refuses the *approve* unless
`operator.cropFractions` is non-null and clears `MIN_LEVEL1_PX`. Raising the floor therefore moves
that 5–8 % from "auto-approvable" to "operator must supply a geometric override", which is exactly
the path all three fixtures already take. The only visible change is that `--min-width`'s default
prints **2182**.

**One consequence worth naming: the focus point is now load-bearing.** At `f1 = 0.11` a focus point
parked in the middle of a fairing panel yields a level 1 that is a colour field, and the 916's
shipped `{0.56, 0.55}` does exactly that. **§6.3's review loop should place `focus` on a structured
region — wheel, engine, frame, headlight, tail — not on the geometric centre of bodywork.** This is
operator guidance, not a code change; `focus` semantics are untouched.

#### Per-fixture re-derivation

All three fixtures are below `MIN_SOURCE_WIDTH` (they were below the old one too, C4), so all three
keep an explicit override. Each is re-derived on the same rule: **`f5` is unchanged**, `f1` is the
smallest two-decimal fraction whose level-1 rect still clears the new 240 px floor, and the three
middle terms are the geometric interpolation. Every row below was produced by the real pipeline, not
by hand.

| # | Source (after `sourceCrop`) | `bw0` | `cropFractions` | `r` | `levels[].rect.w` | `levels[].w` | Σ level bytes |
|---|---|---|---|---|---|---|---|
| 1 GSX-R750 | 800×600 | 800 | `[0.30, 0.41, 0.55, 0.74, 1.00]` | 1.351 | 240, 328, 440, 592, 800 | 240, 328, 440, 592, 800 | 98,276 |
| 2 ZX-6R | 960×720 | 960 | `[0.25, 0.35, 0.49, 0.69, 0.96]` | 1.400 | 240, 336, 470, 662, 922 | 240, 336, 470, 662, **900** | 273,554 |
| 3 Ducati 916 | 1454×1106 | 1454 | `[0.17, 0.26, 0.40, 0.62, 0.96]` | 1.542 | 247, 378, 582, **901**, 1396 | 247, 378, 582, **900, 900** | 183,342 |

Byte sums are at `q = 80` — **the quality search never had to step down** for any fixture, before or
after. `image.full` is untouched in all three (it does not depend on `cropFractions`): 800×600 /
38,862 B, 960×720 / 159,868 B, 1400×1065 / 146,700 B.

**Fixture 3 still exhibits the `levels[].w` tie** that §3.1, §4.7 invariant 2 and §7.2 #8 all cite:
its level-4 rect lands at **901 px**, one pixel over `CROP_TARGET_WIDTH`, so levels 4 and 5 both
encode to 900. `0.62 × 1454 = 901.48`, a deterministic `Math.round`, not a build-dependent value —
but it is thin, so if a future `sourceCrop` tweak ever pushes it under 900 the fix is `f4 = 0.63`
(rect 916, ratio deviation +2.2 %, still inside the ±3 % band), **not** deleting the tie from the
contract.

**Fixture 1's 800 px source is the one thing this revision cannot fix.** Even at the floor, `f1` can
be no tighter than `240/800 = 0.30`, and at the shipped focus `{0.52, 0.55}` that crop *still* has
**SUZUKI** in it. Moving `focus` to **`{0.30, 0.68}`** puts level 1 on the exhaust can, rear wheel,
disc and rearsets instead, defers the wordmark to level 4, and drops the level sum a further 11 KB
(109,098 → 98,276 B). The cost is honest and small: levels 3–4 now reach the left edge of the frame,
so the cardboard boxes the old focus was chosen to avoid become visible there. **Recommended, and
the table above assumes it** — a wordmark on level 1 is a worse defect than a box on level 3. If the
operator would rather not move it, keep `{0.52, 0.55}` and the only change is Σ = 109,098 B.

#### Payload effect

Every fixture gets **smaller**; no budget in `schema/constants.ts` changes.

| # | Day payload (JSON + 5 levels) | vs `DAY_BUDGET_BYTES` 400,000 | was | was |
|---|---|---|---|---|
| 1 | ≈ 100.6 KB | **25.2 %** | 131.2 KB | 32.8 % |
| 2 | ≈ 275.9 KB | **69.0 %** | 331.6 KB | 82.9 % |
| 3 | ≈ 185.9 KB | **46.5 %** | 226.2 KB | 56.5 % |

Fixture 2 was the tight one at 82.9 % of the day budget; it now sits at 69 %. Committed WebP weight
in the repo drops by ≈ 115 KB. `CROP_BUDGET_BYTES`, `FULL_BUDGET_BYTES` and `DAY_BUDGET_BYTES` are
unchanged, and so are the JS/CSS/catalog budgets — this revision touches no budget, it just uses
less of one.

#### Exact edits for the implementer

1. **`schema/constants.ts`** — `DEFAULT_CROP_FRACTIONS = [0.11, 0.19, 0.32, 0.55, 0.95]`;
   `MIN_LEVEL1_PX = 240`; fix the `// = 1867` comment on `MIN_SOURCE_WIDTH` to `// = 2182`
   (the expression itself is already derived and must not be hand-set). Nothing else in the file.
2. **`tools/crop.ts`** — **no geometry change.** Decision (c) means `withoutEnlargement: true`
   stays and `computeExtractRects()` / `assertInvariants()` are byte-identical. The only edits are
   documentation: the header comment's CLI line and `main()`'s `usage:` string both quote
   `[--fractions 0.15,0.25,0.40,0.62,0.95]` — update both to `0.11,0.19,0.32,0.55,0.95`.
3. **`fixtures/fixtures.json`** — the three `cropFractions` arrays per the table above, and (if the
   recommendation is taken) fixture 1's `focus` → `{ "x": 0.30, "y": 0.68 }`. `sourceCrop`, credit,
   `yearEvidence` and every id are untouched.
4. **Regenerate and commit** — `npm run generate`, then commit `public/puzzles/*.json`,
   `public/puzzles/img/**` and `docs/ATTRIBUTION.md`. CI step 8's idempotency gate (§12.4) requires
   the committed output to be byte-identical to a fresh run, so this is not optional.
   `ATTRIBUTION.md` carries no crop numbers and should come back unchanged — if it moves, something
   else did too.
5. **`tools/crop.test.ts`** — two literal rect tables change:
   - fixture-1 `describe`: fractions `[0.3, 0.41, 0.55, 0.74, 1.0]`, focus `{0.30, 0.68}` (or
     `{0.52, 0.55}` if the focus move is declined — the rects are the same either way),
     expected rects `240×180, 328×246, 440×330, 592×444, 800×600`.
   - fixture-3 `describe`: fractions `[0.17, 0.26, 0.4, 0.62, 0.96]`, expected rects
     `247×185, 378×284, 582×437, 901×676, 1396×1047`.
   - The `baseRect` tests, the focus-clamping tests and both `assertInvariants` failure tests are
     **unchanged and still pass**: `[0.1, …]` on 800 px gives 80 px, still under 240; `[0.4, …]` on
     800 px gives 320 px, still over.
6. **`tools/fetch.test.ts`** — the "no source-width warning" case uses **2000×1500**, whose usable
   width 2000 is now *below* 2182, so it would start warning. Raise it to **2400×1800**
   (usable 2400 ≥ 2182) and update the arithmetic in its comment. The 3000×1000 panorama case still
   warns (usable 1333) — comment number only. The 800-px case still warns — comment number only.
7. **`tools/schedule.test.ts`** — comment only: `MIN_SOURCE_WIDTH (1867)` → `(2182)`.
   `WORKING_CROP_FRACTIONS` (level-1 rect 320 px) and the `tooTight` fixture (80 px) both keep their
   meaning under the 240 floor; no assertion changes.
8. **`tools/fetch.ts`** — the two `--min-width 1867` usage strings → `2182`.
9. **`schema/puzzle-contracts.test.ts` — new contract test, §7.2 #15:** for every puzzle,
   `cropFractions` is geometric — each `f[i]/f[i-1]` within **±3 %** of `(f[4]/f[0])^(1/4)`. This is
   the only thing that stops the next hand-typed override from silently reverting this revision.
   Verified to pass for all three new overrides (max deviation 1.2 %, 0.6 %, 0.8 %) and for the new
   default (1.75 %).
10. **E2E: nothing to change.** `playthrough.spec.ts` asserts the scrub by accessible name
    (`Crop level N of 5`) and `aria-current`, never a pixel size; `mobile-layout.spec.ts` measures
    `.scrub__seg` touch targets and the submit button's `bottom`, never the image. `ImageStage`
    sizes the frame from `--stage-max-h` in CSS, so a different intrinsic `levels[].w/h` moves no
    layout. Grepped: no test or spec anywhere asserts a level dimension or byte count except
    `tools/crop.test.ts`.
11. **Unit-test stubs** (`src/components/ImageStage.test.ts`, `src/components/ResultModal.test.ts`,
    `src/lib/puzzle.test.ts`, `src/lib/stats.test.ts`) each hard-code
    `cropFractions: [0.15, 0.25, 0.4, 0.62, 0.95]` as filler. Nothing asserts on it and all four
    still pass; update them to the new default for consistency, optional.
12. **`tsx tools/check-budget.ts`** must pass unchanged — see the payload table; every day payload
    goes *down*.

**Evidence on disk** (throwaway, not committed) —
`/tmp/claude-1000/-home-chris-workspace/852d5747-63d4-4155-bc73-5cf062e93be6/scratchpad/zoom-design/`:
`render.ts` (4 schedules × 3 fixtures + 3 floor-derived overrides each, 21 contact sheets),
`probe2.ts` (the fixed-FOV resolution ladder and the level-1 field-of-view ladder), `final.ts` (the
chosen numbers), `out/CHOSEN-*.png`, `out/sheet-*.png`, `out/final-report.txt`.

---

## 5. Frontend spec

### 5.1 Screens and states

| Screen / state | Trigger | Contents |
|---|---|---|
| **Loading** | boot | Skeleton at the image's reserved aspect box. No spinner flash under 200 ms. |
| **Game** | puzzle fetched | Header · ImageStage · Scoreboard · GuessForm · footer |
| **No puzzle today** | puzzle JSON 404, or `puzzleNumber < 1` | Friendly message + "Play the archive" + next-midnight countdown. **A 404 is a normal state, not an error.** |
| **Load failed** | network error / bad JSON / schema mismatch | "Couldn't load today's Motodle" + Retry. Distinct from 404. |
| **Catalog failed** | `catalog.json` 404 / network error / bad JSON | "Couldn't load the bike list" + Retry. **The guess form is disabled** — without the catalog there is no typeahead and `evaluateGuess` has no `country`/`years` to read (§4.2). The image and scoreboard still render. |
| **Result** | `status !== 'in_progress'` | ResultModal, auto-opened ~400 ms after the final tile animation |
| **Practice** | `?d=` past date | Same, wrapped in the practice bar |
| **Archive list** | archive button | ArchiveList |
| **First visit** | `prefs.seenHelp !== true` | HelpModal auto-opens once; sets the flag on close |
| **Stale day** | rollover watcher | Persistent reload banner over the game |

### 5.2 Component list

`App.svelte` · `ImageStage.svelte` · `GuessForm.svelte` · `YearInput.svelte` ·
`Scoreboard.svelte` · `Modal.svelte` · `HelpModal.svelte` · `StatsModal.svelte` · `ResultModal.svelte` ·
`ArchiveList.svelte` · `Toast.svelte`. No UI kit, no component library, no icon package (inline SVG).

### 5.3 Make/Model dropdowns — `GuessForm.svelte`

**Two cascading native `<select>`s — a MAKE select, then a MODEL select — followed by the year input
and the submit / give-up row.** There is no combobox, no typeahead and no fuzzy matching anywhere in
the app. Native selects were chosen deliberately: on a phone they open the OS picker (a full-height,
thumb-sized, familiar control instead of a hand-rolled popup over an on-screen keyboard); on the
desktop they are keyboard type-ahead capable for free; and they are accessible by default, which is
where every one of Cardle's field defects (C6, §1.2) actually lived.

**Supersedes, for the avoidance of doubt (Revision 2, §11.8).** These older passages are **dead text**;
where any of them disagrees with this section, **this section wins**: §1.2's "One ARIA combobox" and
"tiered fuzzy matcher" rows; the `GuessCombobox.svelte` and "typeahead matcher" entries in the §2 repo
layout; §4.3's lock table where it says *Combobox* (the **rules** there are unchanged and still binding
— only the control is now a `<select>`, §5.3.3); §5.1's "there is no typeahead" clause (the form is
still disabled when the catalog fails, for the same reason: no options and no `country`/`years`);
§5.8's "`dvh` is used only for the combobox popup" clause (nothing uses `dvh` now); the matcher cases
in §7.1's `match.test.ts` row; and W4's combobox/ARIA-listbox bullet in §8. §7.2 #10 is **not**
superseded — see §5.3.7.

#### 5.3.1 DOM contract — frozen, so the UI and e2e workstreams can work independently

```
<select id="mtd-make" name="make">   label text "Make";  first option value="" text "Choose a make…"; other options value = catalog make id, text = make display name.
<select id="mtd-model" name="model"> label text "Model"; first option value="" text "Choose a model…" (or "Choose a make first" while no make); other options value = catalog model id, text = model display name (make NOT repeated).
Year input keeps id "mtd-year". Submit button and give-up button keep their current accessible names.
Locked selects carry the disabled attribute and the existing locked chip/aria-label pattern.
```

- Each select has a **visible `<label>`** wired with `for` / `id` — never a placeholder-as-label.
- The year input keeps `id="mtd-year"` and `§5.4` is unchanged.
- The submit button and the give-up button keep their current accessible names
  (`Guess {n} of 5`, `Give up`, then `Confirm` / `Cancel` in the confirmation step).
- Locked selects carry the `disabled` attribute plus the existing locked chip / `aria-label` pattern
  (§5.3.3).
- Nothing else in the form's DOM changes.

#### 5.3.2 The cascade

- The **MAKE select lists every make in the catalog**, ordered alphabetically by display name using
  `a.name.localeCompare(b.name, 'en')` — the locale is pinned so a machine's locale can never reorder
  the list under the two-timezone test run (§10.2).
- The **MODEL select lists only the chosen make's models — all of them, regardless of year**, families
  and their depth-2 variants alike (both are catalog entries by decision D4, §1.3), ordered
  alphabetically by display name with the same comparator. No year filtering, ever: filtering by year
  would leak `answer.year`.
- Option text is the model name **only** (`models[].name` is already stored without the make, §3.2).
- **Until a make is chosen the MODEL select is `disabled`** and shows the single placeholder option
  `"Choose a make first"`.
- **Changing the make resets the model selection** to the placeholder. This happens in the make
  select's own `onchange` handler (`selectedMakeId = value; selectedModelId = '';`), **not** in an
  `$effect` keyed on the make — an effect would also fire on the lock-prefill pass below and fight it.
- Both lists come from the catalog index the store already holds; the guess form has **no** index of
  its own to build or invalidate.

`src/lib/catalog.ts` gains one helper and tightens one:

```ts
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'en');

/** Every make, alphabetical by display name (§5.3.2). */
export function listMakes(index: CatalogIndex): CatalogMake[] {
  return [...index.makes.values()].sort(byName);
}

/** Every model of `makeId` — ALL years, families and variants — alphabetical (§5.3.2). */
export function modelsForMake(index: CatalogIndex, makeId: string): CatalogModel[] {
  return [...index.models.values()].filter((m) => m.makeId === makeId).sort(byName);
}
```

Both orderings are asserted in `catalog.test.ts`; neither component re-sorts.

#### 5.3.3 Locking (unchanged rules, §4.3 — only the affordance changes)

| Lock | MAKE select | MODEL select | Year |
|---|---|---|---|
| none | enabled, placeholder first | disabled until a make is chosen | editable |
| MAKE green, MODEL not green | **`disabled`**, value = the locked make id, its option text still visible; the existing `.make-chip` renders `Locked` beside the field; `aria-label="Make — locked to {make.name}"` | enabled, listing **that make's models** (unchanged from the unlocked cascade) | editable |
| MODEL green (⇒ MAKE green) | as above | **`disabled`**, value = the locked model id; chip `Locked`; `aria-label="Model — locked to {model.name}"` | **only** editable field |
| YEAR green | — | — | disabled + pre-filled with the player's own green guess (§5.4) |

- A locked select is `disabled` **and still shows its full option list** — the value is what matters,
  and a one-option select would read oddly to a screen reader that announces the option count.
- **No leak.** `locks.modelId` is the id **the player themself chose**, so rendering
  `getModel(catalog, locks.modelId).name` shows their own guess, never `answer.model` — this is the
  same guarantee §4.3 states for the combobox era (it mattered there because an `acceptModelIds`
  match, e.g. player picks *Ducati Monster 900*, answer is *Ducati Monster*, must not be canonicalized
  on screen). The dropdowns get it structurally: nothing ever renders `answer.*`.
- Yellow locks nothing (§4.2/§4.3). No selection is ever cleared by a guess.
- After a submitted guess the selects **keep the player's choices** — never silently cleared, the
  Cardle defect §5.3 has always named. `YearInput` behaves the same.

#### 5.3.4 Validation

The submit button is **never silently dead**. It renders `aria-disabled="true"` (and stays clickable —
`disabled` is set only when the whole form is disabled by game-over or a catalog failure, §5.1) and
submitting an incomplete form sets the inline message pattern already used by the year field:

| Missing | Inline message, rendered in a `<p class="field-error">` whose id is `mtd-make-error` / `mtd-model-error` | On the select |
|---|---|---|
| no make chosen | *"Choose a make"* | `aria-invalid="true"`, `aria-describedby="mtd-make-error"` |
| make chosen, no model | *"Choose a model"* | `aria-invalid="true"`, `aria-describedby="mtd-model-error"` |
| year empty / out of range | *"Enter a year between 1885 and {maxYear}"* (unchanged, §5.4) | on `#mtd-year` |

**Placement changed by revision 8 (§5.11.3):** the messages keep these exact texts and these exact
ids, but they now render on their field's *label line* rather than below the control, so an error
costs zero layout. `GuessForm` owns all three (`YearInput` no longer renders its own).

**Every** offending control is marked on the same submit attempt — `attemptedInvalid` is one flag and
each field derives its own invalid state from it — so a player who fixes one field is not ambushed by
the next. The flag clears on the next valid submit. The `<form>` keeps `novalidate` for the reason
already recorded in the component: native HTML5 constraint validation would swallow the submit before
our own handler runs.

#### 5.3.5 Keyboard, touch, sizing

- **No custom key handling, with one narrow, documented exception.** The browser owns arrow keys,
  `Home`/`End`, letter type-ahead and the popup; there is nothing to trap, nothing to `preventDefault()`
  for those, no `aria-activedescendant`, no virtual focus. HTML implicit submission is *not* triggered
  from a `<select>` in Chromium, so `Enter` with a select focused is wired explicitly — an `onkeydown`
  on `#mtd-make` and `#mtd-model` that calls `preventDefault()` and `form.requestSubmit()` — to reach
  the same validation path as the button: an incomplete form shows the §5.3.4 message, never nothing.
  Both the component and the component's own comment call out that this is the one exception to the
  "no custom key handling" rule above.
- Both selects: `font-size: 16px` minimum (the only correct fix for iOS focus auto-zoom, §1.2),
  `min-height: 44px`, `touch-action: manipulation`, full-width within the content column.
- On a phone the OS picker is used verbatim — no `dvh`/`svh` popup sizing, no visual-viewport flip
  logic, no outside-dismissal listener. Those three §5.3 hazards are gone with the combobox.
- The form must still be reachable without scrolling at 360×640 (§5.8). **Superseded by §5.11**: the
  layout is now one two-column grid at every width (Make | Model, then Year | Guess), the
  height-keyed *layout* branch is deleted, and the submit button clears the fold by 64.5 px instead
  of 27.1 px (§5.11.5). E2E item 12 (§7.4) is still the machine check.
- `prefers-reduced-motion` and the theming rules are untouched.

#### 5.3.6 Svelte state shape — exactly what lives in `GuessForm.svelte`

```ts
// props: { today, catalog, disabled, onsubmit, ongiveup }   — `entries` is GONE
let selectedMakeId  = $state('');            // '' = placeholder
let selectedModelId = $state('');            // '' = placeholder
let yearValue       = $state<number | null>(null);   // unchanged
let attemptedInvalid  = $state(false);       // unchanged
let confirmingGiveUp  = $state(false);       // unchanged

const gameOver     = $derived(today.status !== 'in_progress');
const formDisabled = $derived(disabled || gameOver);

const makeLocked   = $derived(today.locks.makeId !== null);
const modelLocked  = $derived(today.locks.modelId !== null);

const effectiveMakeId  = $derived(today.locks.makeId  ?? selectedMakeId);
const effectiveModelId = $derived(today.locks.modelId ?? selectedModelId);

const makeOptions  = $derived(listMakes(catalog));
const modelOptions = $derived(effectiveMakeId ? modelsForMake(catalog, effectiveMakeId) : []);

// Resumed / locked game pre-fill. `$state(prop)` captures only the INITIAL value (§10.7 gotcha #8),
// so the prefill is an $effect — it runs on mount too, which is what makes a resumed practice or
// reloaded in-progress game come back with its locked make/model already selected.
$effect(() => { if (today.locks.makeId  !== null) selectedMakeId  = today.locks.makeId; });
$effect(() => { if (today.locks.modelId !== null) selectedModelId = today.locks.modelId; });
// (YearInput keeps its own equivalent effect for locks.year, §5.4.)

const guessInput = $derived.by((): SubmitGuessInput | null => {
  if (yearValue === null || !Number.isInteger(yearValue) || yearValue < 1885 || yearValue > MAX_YEAR) return null;
  if (!effectiveMakeId || !effectiveModelId) return null;
  const model = catalog.models.get(effectiveModelId);
  if (!model || model.makeId !== effectiveMakeId) return null;   // stale pair, e.g. mid-make-change
  return {
    makeId: effectiveMakeId,
    modelId: effectiveModelId,
    make: getMake(catalog, effectiveMakeId).name,
    model: model.name,
    year: yearValue,
  };
});

const makeInvalid  = $derived(attemptedInvalid && !effectiveMakeId);
const modelInvalid = $derived(attemptedInvalid && !!effectiveMakeId && !effectiveModelId);
const yearInvalid  = $derived(attemptedInvalid && today.locks.year === null
                              && (yearValue === null || yearValue < 1885 || yearValue > MAX_YEAR));
const submitDisabled = $derived(formDisabled || guessInput === null);
```

`handleSubmit`, `confirmGiveUp` and the give-up confirmation markup are unchanged. `SubmitGuessInput`
(§3.7, `src/lib/game.ts`) is unchanged — the display strings now come from the catalog rather than
from a match label, which is strictly less code and no leak (§5.3.3).

#### 5.3.7 Files deleted, and the one thing that must NOT be deleted

**Delete:**

| Path | Why |
|---|---|
| `src/components/GuessCombobox.svelte` | replaced by the two selects |
| `src/components/GuessCombobox.test.ts` | its component is gone (§7.3) |
| the matcher half of `src/lib/match.ts` | `fold`, `tokenize`, `buildMatchIndex`, `rankMatches`, `matchCatalog`, the tier/score heuristic, `MatchEntry`, `MatchOptions` — nothing imports them once the combobox is gone |
| the matcher `describe` blocks in `src/lib/match.test.ts` | they test deleted code |
| `GameStore.matchEntries` + the `buildMatchIndex` import in `src/state/game.svelte.ts`, and the `entries` prop threaded through `App.svelte` → `GuessForm` | the form reads the catalog index directly |

**KEEP — `normalizeId` stays in `src/lib/match.ts`, at exactly that path.** The §7.2 #10
cross-implementation contract test loads `src/lib/match.ts` by path and compares its `normalizeId`
against `tools/lib/normalize.ts` on every frozen vector and every catalog name; moving or removing it
breaks a frozen contract test. `src/lib/match.test.ts` therefore keeps the §3.2 frozen vector table
and loses everything else. The file's header comment shrinks to "id normalization shared with
`tools/lib/normalize.ts` (§3.2)".

`schema/types.ts` keeps `MatchResult` and `MatchTier` declared — the §3.7 name list is frozen and is
not being re-opened for this revision — but nothing imports them any more. Do not delete them and do
not add new names.

### 5.4 `YearInput.svelte`

`<input type="number" inputmode="numeric" min="1885" max={currentYear+1} step="1">` plus `−`/`+`
stepper buttons (≥44 px, `aria-label="Earlier year"` / `"Later year"`, auto-repeat on hold).
Out-of-range or empty blocks submit with an inline message. Never validated by string length
(Cardle's `"abcd"` bug). Font-size ≥ 16 px. **Revision 8 (§5.11.3)**: the component keeps `invalid`
(and therefore `aria-invalid` + `aria-describedby="{id}-error"`) but drops `invalidMessage` and no
longer renders the message element — `GuessForm` renders all three messages, on the Year label line.
The native `input[type=number]` spinner is suppressed (§5.11.4); the `−`/`+` steppers are the only
steppers.

### 5.5 Image reveal and scrub — `ImageStage.svelte`

- `unlockedLevel = min(5, guessCount + 1)`; **level N is shown during guess N**.
- The stage is a fixed 4:3 box at `width: 100%` with `width`/`height` attributes from the JSON, so
  there is **zero layout shift** as levels swap.
- **Scrub back only.** A 5-segment control under the image: segments `> unlockedLevel` are `disabled`
  and `aria-disabled`. `←`/`→` move between unlocked levels. Selecting a level sets `viewLevel`
  (persisted). Advancing a guess snaps `viewLevel` to the new `unlockedLevel`.
- **Once `status !== 'in_progress'`, all five levels unlock** for scrubbing. The game is over and the
  full reveal is already on screen, so leaving levels 4–5 locked after a win on guess 2 protects
  nothing and just looks broken.
- **Preloading:** level *N+1* is prefetched (`new Image()`) as soon as level *N* renders, so the reveal
  is instant. Levels are `<img loading="eager">` once unlocked (they are already tiny); the **full
  reveal is `loading="lazy"` and its URL is not even constructed until game end**.
- Transition: 200 ms cross-fade. Under `prefers-reduced-motion: reduce` the swap is **instant and the
  game logic does not wait** — the reduced-motion path skips the delay, not just the animation.
- Tap-to-enlarge opens the current level full-bleed in a `Modal`. Pinch zoom works natively (never
  suppressed).

### 5.6 Modals

`Modal.svelte` is a focus-trapped `role="dialog" aria-modal="true"` **fixed to the viewport** (not
absolutely positioned inside a 450 px column, as Cardle does). Esc closes, focus returns to the
opener, background scroll locked via `overscroll-behavior: contain`.

- **HelpModal** — the §5.12 tagline as its intro, then the rules, the three tile colors with worked
  examples (heading: **`Tile colors`**, US spelling, §5.13), the multiplier table, and "a new
  Motodle every day at midnight, your time". Auto-opens on first visit. It must explain **all three
  yellow bands in a player's words**, using `COUNTRY_NAMES` (§4.7) so a country code is never shown:

  Laid out as a 3×3 grid (rows Make / Model / Year; columns Right / Close / Wrong, each headed by
  a real tile swatch so colourblind mode carries through), one short cell per rule — prose with
  inline emoji squares read as a jumble (user feedback 2026-09-02):

  | | ✓ Right | ~ Close | ✗ Wrong |
  |---|---|---|---|
  | **Make** | right make | same country | other country |
  | **Model** | that's the bike | on sale the year the answer was built | different era |
  | **Year** | within 2 years | within 10 years | further off |

  > Only a green tile scores a point and locks that field in. Yellow is just a hint. Example: you
  > guess Honda and the answer is a Kawasaki, so the make tile turns yellow because both are from
  > **Japan**.

  The model paragraph must say **"the year the answer was built"**, not "the year you guessed" — that
  is the one thing players will get wrong about RULE B (§4.2).
- **StatsModal** — `Played · Win % · Current Streak · Max Streak`, then the **8-bucket score
  distribution** (`15 12 9 6 3 2 1 0`, bars proportional with a minimum stub, today's bucket
  highlighted), then `Next Motodle` + HH:MM:SS countdown and a Share button.
- **ResultModal** — win/lose headline, the answer (`2004 Suzuki GSX-R750`), the **full reveal image**
  (**letterboxed** — its aspect is the source-cropped aspect, not 4:3, §3.1), the attribution block
  (author · licence link · Commons link · **`credit.modified` rendered beside the licence link** ·
  `creditNote` when present — **always shown regardless of `attributionRequired`**), score breakdown
  (`points × multiplier`), and Share. Auto-opens ~400 ms after the game ends; re-openable.

### 5.7 Theming

`:root` carries the complete **light** palette as tokens; `@media (prefers-color-scheme: dark)`
redefines only the tokens; `[data-theme="dark"]` / `[data-theme="light"]` on `<html>` wins over the
media query in **both** directions. `color-scheme: light dark` on `:root`. Colourblind mode swaps the
tile palette (green→orange, yellow→blue, red→near-black) **and** adds a glyph (`✓ ~ ✗`) inside each
tile — colour is never the only signal. Cardle sets a glyph but leaves the fills unchanged; we change
both. The toggle's own label and tooltip read **`Toggle colorblind mode`** (US spelling, §5.13).
`app.css` also defines the app's single focus ring, `outline: 2px solid var(--color-accent)` at
`outline-offset: 2px`, flipped to `--color-fg` on the accent-filled primary button — one rule that
covers light, dark and colorblind because the accent is itself a theme token (§5.11.4).
**In the share text the colourblind red is `⬜`, not `⬛`** (§4.4) — on-screen the tile stays
near-black against the app's own background, but a shared grid is read in someone else's dark-themed
chat client, where `⬛` disappears.

### 5.8 Mobile layout rules

- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` —
  **no `user-scalable=no`, no `maximum-scale`.** Pinch zoom is preserved. (WCAG 1.4.4.)
- Shell height: `height: 100vh; height: 100svh;` — `svh` is stable and never jumps with the URL bar.
  `dvh` is used only for the combobox popup's max-height.
- Image is `width: 100%` of the content column (`max-width: 30rem`), so it is sized by **viewport
  width**, not height (Cardle's `width: 32vh` shrinks badly in landscape).
- Safe areas: `padding: max(0.75rem, env(safe-area-inset-*))`.
- All interactive targets ≥ 44×44 CSS px, grown with padding rather than glyph size.
- Layout order top→bottom: header · image · scoreboard · form. The form must be reachable **without
  scrolling** at 360×640. **What is machine-verified and what is not:** the e2e run asserts the
  360×640 **no-keyboard** case (§7.4 item 12) — headless Chromium has no on-screen keyboard and does
  not resize `visualViewport`, so it *cannot* test the keyboard-open case. The keyboard-open case is
  an **operator check on a real phone or in device emulation**, §7.5 step 10.
- `@media (prefers-reduced-motion: reduce)` neutralizes all animation *and* the logical delays.
- One font stack, system fonts only. **No `@import` of a webfont** (Cardle's render-blocking Barlow
  import); no third-party requests of any kind.

### 5.9 Payload budget enforcement

`tools/check-budget.ts`, wired as `"build": "vite build && tsx tools/check-budget.ts"`, so a
budget violation **fails the build**. It gzips each artifact in memory (`zlib.gzipSync`, level 9) and
checks:

Every limit below is **imported from `schema/constants.ts`** (§4.7), never re-typed:

| Budget | Constant | Limit | Source |
|---|---|---|---|
| App JS, gzipped (sum of `dist/assets/*.js`) | `JS_GZ_BUDGET_BYTES` | **60 KB** | brief |
| App CSS, gzipped | `CSS_GZ_BUDGET_BYTES` | 20 KB | plan |
| `public/catalog.json`, gzipped | `CATALOG_GZ_BUDGET_BYTES` | **150 KB** | brief |
| Per day: `puzzles/<date>.json` + its 5 level WebPs, **raw bytes** | `DAY_BUDGET_BYTES` | **400 KB** | brief |
| Full reveal image, raw | `FULL_BUDGET_BYTES` | 250 KB | plan (excluded from the 400 KB — lazy) |

No limit in that table changed in revision 9; the geometric ladder (§4.7a) only *uses less* of the
day budget — the three fixtures land at 25.2 %, 69.0 % and 46.5 % of `DAY_BUDGET_BYTES`, against
32.8 %, 82.9 % and 56.5 % before.

Output is a table plus a non-zero exit on any breach. The probe measured a Svelte 5 runes app at
**10.66 KB gzipped**, so the 60 KB budget has ~5× headroom — provided `catalog.json` and the puzzle
JSON are `fetch`ed, never imported.

### 5.10 Photo licences and credits

Every puzzle photo comes from Wikimedia Commons under CC BY / CC BY-SA / CC0 / public domain, and
§3.1 already makes the whole credit block a **required** field of every puzzle file (`author`,
`license{id,name,url,jurisdiction}`, `descriptionUrl`, `fileTitle`, `modified`, `creditNote`,
`attributionRequired`). Today that block is rendered **only** by `ResultModal`, i.e. only after the
game ends. Operator decision, 2026-09-02: **the licence must be visible while the photo is on
screen**, and the whole back-catalogue of credits must be reachable from a permanent link.

The one hard constraint the design has to respect is the **spoiler surface**. A Commons file title
is typically `File:2004 Suzuki GSXR-750 Left SIde.jpg` and the author name is sometimes the make
("Suzuki Motor Corp"). So during play the *only* credit field that may reach the DOM is
`credit.license.name` (plus its deed URL, which is a licence-template URL and never names the bike).
`author`, `fileTitle` and `descriptionUrl` are game-end material.

Four pieces, in the order a player meets them.

#### 5.10.1 In play — the licence line on the image stage

**Where it lives: inside `ImageStage.svelte`, sharing a flex row with the 5-segment scrub control.**
Not a new row of its own — see the measurement in §5.10.2 — and not an overlay chip on the photo
either: an overlay would have to be a *sibling* of the enlarge `<button>` (a link may not be nested
inside a button), stacked over it, so its 44 px hit area would steal taps from the enlarge control
and cover ~40 % of a 187×140 px crop at 360×640. The scrub row is already 44 px tall because its
segments are touch targets, and at 360 px it has ~92 px of horizontal slack once the segments are
allowed to shrink to their 44 px minimum. The licence line goes in that slack, and costs **zero**
vertical pixels.

Markup, replacing the bare `.scrub` sibling in `ImageStage.svelte`:

```svelte
<div class="image-stage__meta">
  <a
    id="mtd-photo-licence"
    class="image-stage__licence"
    href={credit.license.url}
    target="_blank"
    rel="noopener noreferrer"
    aria-label={`Photo license: ${credit.license.name} (opens the license deed)`}
  >Photo: {credit.license.name}</a>

  <!-- the existing role="group" aria-label="Crop level" scrub, unchanged -->
  <div class="scrub" role="group" aria-label="Crop level" onkeydown={handleKeydown}> … </div>
</div>
```

```css
.image-stage__meta { display: flex; align-items: center; gap: var(--space-2); }
.image-stage__licence {
  flex: 1 1 auto; min-width: 0;            /* min-width:0 is load-bearing: it lets the text wrap
                                              instead of forcing horizontal page overflow */
  display: flex; align-items: center; min-height: var(--touch-target);   /* §5.8's 44px rule */
  font-size: 0.7rem; line-height: 1.25; overflow-wrap: anywhere;
  color: var(--color-muted);
}
.scrub { flex: 0 1 auto; grid-template-columns: repeat(5, minmax(var(--touch-target), 1fr)); }
```

Rules, all of them testable:

- **Exact text: `Photo: ` + `credit.license.name`, verbatim** — `Photo: CC BY-SA 4.0`,
  `Photo: CC BY-SA 2.0 de`, `Photo: Public domain`. Never constructed from `license.id` (§3.1's
  jurisdiction rule), never abbreviated.
- **The whole string is one link to `credit.license.url`**, including for `PD`/`CC0`, whose `url` is
  the Commons licence-template page and is required non-null by §3.1. `target="_blank"` +
  `rel="noopener noreferrer"`, like every other outbound link in the app.
- **Nothing else from `credit` may appear anywhere in the stage subtree** — not as text, not in
  `title`, `alt`, `aria-label` or `data-*`. Specifically: no `author`, no `fileTitle`, no
  `descriptionUrl`, no `creditNote`. A tooltip leak is still a leak.
- `ImageStage` gains one prop, `credit: PuzzleCredit`, passed from `App.svelte` as
  `credit={game.puzzle.credit}`. No store change; the puzzle is already loaded.
- The line is present in **every** in-play state, practice included, and stays after the game ends
  (the ResultModal's full credit is additive, not a replacement).
- Colour is `--color-muted` at `0.7rem`; it must never compete with the scrub for attention. It is
  **not** part of the colourblind palette — it carries no game state.

#### 5.10.2 Why the fold rule survives — measured, not argued

§5.8's frozen rule is enforced by `e2e/mobile-layout.spec.ts`: at 360×640, unfocused, `scrollY === 0`,
`submit.getBoundingClientRect().bottom <= window.innerHeight`, and no horizontal overflow. The
current layout at 360×640 (measured against `vite preview` on the real build, 2026-09-02):

| Box | top | bottom | height |
|---|---:|---:|---:|
| header | 12 | 56 | 44 |
| image frame (`--stage-max-h` = `clamp(120px, 100svh − 500px, 36svh)` → **140 px**) | 64 | 204 | 140 |
| scrub row | 212 | 256 | 44 |
| scoreboard | 264 | 429.9 | 165.9 |
| form | 437.9 | 612.9 | 175 |
| **submit button** | 568.9 | **612.9** | 44 |
| viewport | — | **640** | — |

*(Revision 8 re-measured this table against the new form layout: the submit button now sits at
575.5 and the slack is 64.5 px — see §5.11.5. The paragraph below records why the licence row was
free under the **previous** layout, which is still the reason it exists.)*

**Slack above the fold: 27.1 px.** That is the entire budget, and it is why a new full-height row is
forbidden: a 0.7 rem line plus a `--space-2` gap is ~25 px, which would consume 92 % of it. The
alternative — adding the row and paying for it by bumping the `100svh − 500px` term to `− 525px` —
was rejected: at 640 svh the clamp then hits its own 120 px floor, so the stage gives back only 20 px
against 25 px spent, and every viewport shorter than ~645 svh pays the full 25 px with nothing back.

The shared-row design was **prototyped against the running build and re-measured** at four viewports
(inject the markup + CSS above into the live page, then read the boxes back):

| Viewport | submit bottom, before | submit bottom, after | `scrollWidth` vs `clientWidth` | licence box | scrub | segment |
|---|---:|---:|---|---|---|---|
| 360×640 | 612.9 | **612.9** | 360 = 360 | 92 × 44 | 236 × 44 | 44 × 44 |
| 375×667 | 639.9 | **639.9** | 375 = 375 | 107 × 44 | 236 × 44 | 44 × 44 |
| 412×915 | 763.9 | **763.9** | 412 = 412 | 144 × 44 | 236 × 44 | 44 × 44 |
| 768×1024 | 1015 | **1015** | 768 = 768 | 236 × 44 | 236 × 44 | 44 × 44 |

Zero movement at every width, no horizontal overflow, and the scrub segments land exactly on the
44 px touch-target minimum at 360 px (5 × 44 + 4 × `--space-1` = 236 px), which is the width at which
the design stops shrinking — below 360 px the licence line wraps to two or three lines *inside* the
44 px row and still costs nothing. The longest licence label in §6.5's allowlist,
`Photo: CC BY-SA 2.0 de` (22 chars), wraps to two lines in the 92 px box at 360 px; three lines at
0.7 rem/1.25 is 42 px, still under the row's 44 px. **If a future licence label ever exceeds three
lines at 360 px the row grows and the fold spec fails — which is the correct failure**: the e2e spec
is the guard, not this paragraph.

The footer (§5.10.5) is free for the same structural reason, verified the same way: `.app-column` is
a flex column with `flex: 1 1 auto` and the footer carries `margin-top: auto`, so at 360×640 the
content already overflows the column and the footer simply follows it below the fold. Swapping the
one-line footer for the two-part line moved the submit button by **0.0 px** at all four viewports
(measured: 612.9 / 639.9 / 763.9 / 1015 with the taller footer in place).

#### 5.10.3 At game end — `ResultModal`, unchanged plus one link

The existing attribution block (§5.6, §7.3) is **not** regressed: author · licence link ·
`credit.modified` · `Source on Commons` · `creditNote` when present, shown regardless of
`attributionRequired`. One addition only: a `Photo credits` button on the same row as `Share`
(`id="mtd-credits-link-result"`, `class="link-button"`) that closes the result modal and opens the
credits view (§5.10.4). Both modals are `Modal.svelte`-based and `Modal` traps focus, so they must
not be open at once: the handler is `onclose(); oncredits();`.

#### 5.10.4 The credits view — `CreditsModal.svelte`

A new component (12th in §5.2's list) plus one new pure module, `src/lib/credits.ts`. It is a
`Modal.svelte` dialog, `titleId="credits-title"`, opened from the footer link and from the result
modal.

**Copy.** Title `Photo credits`. Intro, verbatim:

> Photos come from Wikimedia Commons under Creative Commons or public-domain licenses and are
> cropped, resized and re-encoded.

Then one row per eligible past puzzle, **newest first** (descending `number`):

```
Motodle #3 · 2026-09-04 · 1995 Ducati 916 — photo by <author> · <licence name (deed link)> ·
Source on Commons (link) · cropped, resized, re-encoded to WebP
```

`creditNote`, when non-null, renders verbatim as an italic line under its row (same treatment as
`ResultModal`) — it is an author's prose request and the credits view is exactly where it belongs.

**The spoiler rule is one pure function, used once.** `src/lib/credits.ts`:

```ts
export interface CreditRow { number: number; date: string; id: string;
  year: number; make: string; model: string; credit: PuzzleCredit; }

/** Dates whose credits may be shown, newest first: strictly before today, plus today itself only
 *  when today's real game has ended (won | lost | gave_up). Never a future date. */
export function eligibleCreditDates(
  manifest: Manifest, todayDateKey: string, todayFinished: boolean,
): string[];

/** The next slice to fetch. Batch size is CREDITS_PAGE_SIZE = 20 (§5.10.4). */
export function nextCreditBatch(eligible: string[], loadedCount: number): string[];
```

- `date < todayDateKey` → always eligible. `date === todayDateKey` → eligible iff `todayFinished`.
  `date > todayDateKey` → **never**, under any circumstance.
- `todayFinished` is read from the **real** today state, never from the practice state: the store
  computes it as `loadTodayState(backend, todayDateKey, fresh).status !== 'in_progress'`. Winning a
  *practice* round for an old date must not unlock today's row, and playing in practice mode must
  not hide today's row once today's own game is finished. §4.6 practice/archive isolation is
  otherwise untouched — `ArchiveList` keeps its own `date < today` filter and its own spoiler-free
  manifest rendering.
- Because a row carries the answer, this function is the **only** place the filter exists. No
  component re-derives it (same rule as tile colours, §5.2/§4.2).

**Data flow.** `manifest.json` (§3.3) is answer-free and gives dates/numbers/ids; the answer and the
credit live in the per-day puzzle JSON, so each eligible day needs one fetch. In `game.svelte.ts`:

| Field / method | Behaviour |
|---|---|
| `creditsOpen` | dialog visibility; `openCredits()` / `closeCredits()` |
| `openCredits()` | sets `creditsOpen = true`; loads the manifest first if `this.manifest === null` (same lazy pattern as `openArchive()`); then fetches the first batch |
| `credits: CreditRow[]` | rows built so far, newest first |
| `creditsStatus` | `'loading' \| 'ready' \| 'failed'` |
| `creditsLoadingMore` | true while a `Show more` batch is in flight |
| `creditsHasMore` | `loadedCount < eligible.length` |
| `loadMoreCredits()` | fetches `nextCreditBatch(...)` and appends |
| private `puzzleCache: Map<string, Puzzle>` | so re-opening the dialog re-fetches nothing, and today's already-loaded puzzle is reused rather than re-fetched |

**Batching, explicitly.** `CREDITS_PAGE_SIZE = 20`. A batch is fetched with one `Promise.all` over at
most 20 `loadPuzzle(date)` calls (`src/lib/puzzle.ts`, reused verbatim — it already validates the
shape and maps 404 → `no-puzzle`); the next batch is only started by a **`Show more`** click. A year
of puzzles therefore costs 20 requests on open, not 365. `Show more` reads
`Show more (N remaining)` and is `disabled` with the label `Loading…` while its batch is in flight.

**Missing days are skipped silently.** A `no-puzzle` (404) or `load-failed` result for a listed date
contributes no row and produces no message — a manifest entry whose file was pulled is not a player-
facing error. It still counts toward `loadedCount`, so `Show more` cannot loop on it.

**States.**

| State | Condition | Rendered |
|---|---|---|
| Loading | `creditsStatus === 'loading'` | `Loading…` |
| Empty | `ready`, `credits.length === 0` | `No photo credits yet — they appear here once a puzzle is finished.` (the launch-day case, and the only state a first-time player can reach) |
| List | `ready`, rows present | intro + rows + `Show more` when `creditsHasMore` |
| Failed | `failed` — the manifest failed to load, **or** the first batch produced zero rows with at least one `load-failed` (i.e. a network problem, not a pulled day) | `Couldn't load the photo credits.` + `Retry` (`onretry` → re-runs `openCredits()`'s load path) |

**Component shape** (presentational, like `ArchiveList`; the store owns fetching and filtering):

```ts
interface Props {
  open: boolean;
  rows: CreditRow[];
  status: 'loading' | 'ready' | 'failed';
  hasMore: boolean;
  loadingMore: boolean;
  onmore: () => void;
  onretry: () => void;
  onclose: () => void;
}
```

**DOM hooks (frozen for e2e, same status as §5.3.1's contract):**

| Hook | On |
|---|---|
| `#mtd-credits-link` | the footer button that opens the view |
| `#mtd-credits-link-result` | the same affordance inside `ResultModal` |
| `#mtd-credits` | the `<ul>` of credit rows |
| `data-mtd-credit-row` + `data-date="YYYY-MM-DD"` | each `<li>` |
| `#mtd-credits-more` | the `Show more` button |
| `#mtd-credits-empty` | the empty-state paragraph |
| `#mtd-photo-licence` | the in-play licence link (§5.10.1) |
| `credits-title` | the dialog's `aria-labelledby` target |

#### 5.10.5 The footer

`App.svelte`'s footer becomes one short line, below the form (and, at 360×640, below the fold — which
§5.8 permits: only the submit button must be above it):

```svelte
<footer class="app-footer">
  Photos: <a href="https://commons.wikimedia.org/" target="_blank" rel="noopener noreferrer"
    >Wikimedia Commons</a>, Creative Commons licenses ·
  <button type="button" id="mtd-credits-link" class="link-button" onclick={() => game.openCredits()}
    >Photo credits</button>
</footer>
```

The footer sits outside `<main>` in `App.svelte`, so it renders on **every** screen — game, loading,
"no puzzle today" and "load failed" alike — and the credits view therefore stays reachable on a day
with no puzzle (which is exactly the day someone browses the back catalogue).

It is a `<button>`, not an `<a href="#">` — it opens an in-page dialog, and `Modal` returns focus to
its opener. `.link-button` is a new shared class in `app.css` (transparent background, no border,
`color: var(--color-muted)`, `text-decoration: underline`, `font: inherit`, `cursor: pointer`); the
44 px touch-target rule is relaxed here exactly as it already is for the existing footer link, which
is inline text in a 32.8 px-tall footer — this is a footnote link, not a game control, and growing it
to 44 px would make the footer taller than the practice bar.

#### 5.10.6 What this does **not** change

- **CSP stays byte-identical.** The credits view fetches only same-origin `/puzzles/*.json`
  (`connect-src 'self'` — already allowed, it is the same fetch the game itself makes), renders no
  images, and adds only `<a>` navigations, which the policy in §13.2.6 does not restrict (there is no
  `navigate-to` directive, and `form-action 'none'` governs forms, not links). **No allowance is
  needed; nothing in `infra/variables.tf` or `schema/constants.ts` is touched.**
- **Payload budgets (§5.9) are unaffected in kind**: one small component + one small pure module,
  ~2 KB gzipped against a 60 KB JS budget with ~49 KB headroom. Credit data is fetched from files
  that already exist and are already counted per-day; nothing is added to the 400 KB day budget.
- Game rules, scoring, share text, the storage schema and §5.3.1's `#mtd-make` / `#mtd-model` /
  `#mtd-year` DOM contract are untouched. `docs/ATTRIBUTION.md` remains the generated, in-repo record
  (§6.3); it is **not** shipped in `dist/`, which is precisely why the credits view has to build
  itself from the manifest at runtime rather than link to it.

### 5.11 Guess form layout (revision 8)

User feedback, 2026-09-03: *"Fix the input/button stack, it's kinda ugly."* This section replaces the
**visual layout** of `GuessForm.svelte` + `YearInput.svelte` and nothing else.

**Frozen and untouched by this section:** every rule in §4, the §5.3.1 DOM contract (`#mtd-make`,
`#mtd-model`, `#mtd-year`, option values = catalog ids, the visible label texts `Make` / `Model` /
`Year`, and the accessible names `Guess {n} of 5` / `Give up` / `Confirm` / `Cancel`), the §5.3.2
cascade, the §5.3.3 locking rules, the §5.3.4 message **texts** and their `mtd-*-error` ids, the
§5.3.6 state shape, the storage schema, the payload budgets, the CSP, and **§5.8's fold rule** —
which this layout does not merely survive but improves by 37.4 px (§5.11.5).

**Supersedes.** These passages are now dead text; where they disagree, this section wins:
§5.3.5's third bullet where it says *"the existing `@media (max-height: 900px)` rule keeps the year
field and the action row on one line"* (there is no height-keyed **layout** rule any more, only a
height-keyed **gap** rule); §5.3.4's implicit placement of the messages *below* their control;
§5.4's *"inline message"* ownership (the message is now rendered by `GuessForm`, §5.11.3); and the
"before/after" numbers in §5.10.2's second table, which measured the previous layout.

#### 5.11.1 What was ugly, and why — measured against the running build

Screenshots at 360×640 / 390×844 / 768×1024 / 1280×800, light and dark, plus the locked and
error states (`vite preview` on the real build, clock pinned 2026-09-03T12:00:00).

| # | Defect | Evidence |
|---|---|---|
| U1 | **Two different layouts keyed on nothing meaningful.** `@media (max-height: 1000px)` decides the whole structure, so a 768×1024 tablet gets a full-width *vertical stack* (Make, Model, Year, buttons — the "stack" the feedback names) while a 1280×800 desktop gets a cramped single row. Height, not width, picked the layout. | form height 281.1 px at 768×1024 vs **119 px** at 1280×800, same column width (480 px) |
| U2 | **The bottom row silently wraps at 360 px.** `.guess-form__bottom` is `flex-wrap`, and year (124) + submit (125.9) + give-up (90.8) + gaps > 336, so the year field lands **alone** on its own line with 212 px of dead space beside it and the buttons drop below. Nobody designed that row; the wrap did. | `.guess-form__bottom` height 100 px = two 44 px lines |
| U3 | **An orphaned control.** In exactly that state the visible `Year` label is `position: absolute`-hidden by the `max-height: 1000px` rule, so the loneliest field on the page is also the only one with no label. | `.guess-form__field--year label` clip rule |
| U4 | **Mismatched button widths.** Submit is 125.9 px, give-up 90.8 px, both auto-width, side by side, at equal visual weight — two peers, one of which ends the game. | measured at every viewport |
| U5 | **The primary button reads as broken.** Soft-disabled (`aria-disabled`, still clickable by design, §5.3.4) is drawn as `opacity: 0.5` over the accent fill: a washed-out lilac whose white label falls well under 3:1 against it. | `.button.is-disabled { opacity: 0.5 }` |
| U6 | **Errors shove the layout.** Each `field-error` is an unreserved block below its control, so submitting an empty form moves the year row down ~20 px and the submit button down ~40 px — the layout jumps under the thumb that just tapped it. | error state vs clean state |
| U7 | **A second, native stepper.** `input[type=number]` renders the WebKit spin buttons *next to* our own 44 px `−`/`+`, at every width where the field is wider than ~60 px. | 768×1024 and 1280×800 screenshots |
| U8 | **The `Locked` chip eats the field.** It sits *inside* the control row, taking 60.5 px of a 164 px column, so a locked make shows less of its own value than an unlocked one. | locked-make measurement: select 99.5 px + chip 60.5 px |
| U9 | **The give-up confirmation detonates the form.** `.give-up-confirm` is an inline `<span>` of text + 2 buttons inside the wrapping action row: the prompt wraps to two lines, the submit button is stranded alone on the line above, and everything below moves. | give-up screenshot at 390×844 |
| U10 | **No focus ring of our own.** Nothing in `app.css` or any component defines `:focus-visible`, so every control falls back to a different UA default and the `<select>`'s is nearly invisible on the dark surface. | `grep -rn "focus-visible\|outline" src/` → one hit, `Modal.svelte`'s `outline: none` |
| U11 | **Inconsistent spacing rhythm.** `.guess-form` gap 12 → 8 under the media query, `.guess-form__bottom` gap stays 12, `.select-row` gap 8 → 4, label gap 4. Four different vertical gaps inside one 175 px form. | component CSS |

#### 5.11.2 Target layout — one grid, every width

The content column is capped at `--content-max-width: 30rem`, so the form is never wider than 480 px
and never narrower than ~296 px (320 px viewport minus the safe-area padding). **One two-column grid
covers that entire range**, which is why the `@media (max-height: 1000px)` *layout* branch is deleted
rather than adjusted (U1). Make sits above Year, Model sits above Guess: two columns, four rows, one
alignment.

```
 320–480 px (every phone AND the desktop column — identical structure)

  Make          Choose a make    Model        Choose a model        <- label line: label at the
 ┌───────────────────────────┐  ┌───────────────────────────┐          start, error OR the Locked
 │ #mtd-make            44px │  │ #mtd-model           44px │          chip at the end
 └───────────────────────────┘  └───────────────────────────┘
  Year               Enter a year between 1885 and 2027              <- spans both columns
 ┌────┐ ┌──────────────┐ ┌────┐  ┌───────────────────────────┐
 │ −  │ │  #mtd-year   │ │ +  │  │      Guess 1 of 5         │
 └────┘ └──────────────┘ └────┘  └───────────────────────────┘
 ─────────────────────────────────────────────────────────────       <- hairline separator
                        Give up                                      <- quiet, centered, 44px

 Locked make (§5.3.3)                     Give-up confirmation
  Make               ⟨LOCKED⟩              ────────────────────────────
 ┌───────────────────────────┐              Give up? This counts as a loss.
 │ Kawasaki      (disabled)  │                 ┌────────┐  ┌─────────┐
 └───────────────────────────┘                 │ Cancel │  │ Confirm │
  the chip moved to the label line,            └────────┘  └─────────┘
  so the select keeps the full column          nothing above the hairline moves
```

Grid areas, verbatim:

```
"make-label  model-label"
"make        model"
"year-label  year-label"
"year        submit"
```

Row 3 spans both columns because that is the only row whose message is long: *"Enter a year between
1885 and 2027"* is ~200 px at 0.75 rem and does not fit a 144 px column, whereas *"Choose a make"*
(~78 px) and *"Choose a model"* (~87 px) fit theirs at 320 px with room to spare.

#### 5.11.3 Markup — the only DOM changes this revision makes

```svelte
<form class="guess-form" onsubmit={handleSubmit} novalidate>
  <div class="guess-form__grid">
    <div class="guess-form__label-row" data-area="make-label">
      <label for="mtd-make">Make</label>
      {#if makeInvalid}<p id="mtd-make-error" class="field-error">Choose a make</p>{/if}
      {#if makeLocked}<span class="lock-chip">Locked</span>{/if}
    </div>
    <div class="guess-form__label-row" data-area="model-label">
      <label for="mtd-model">Model</label>
      {#if modelInvalid}<p id="mtd-model-error" class="field-error">Choose a model</p>{/if}
      {#if modelLocked}<span class="lock-chip">Locked</span>{/if}
    </div>

    <div class="guess-form__cell" data-area="make" data-locked={makeLocked}>
      <select id="mtd-make" name="make" class="select" …unchanged attributes… />
    </div>
    <div class="guess-form__cell" data-area="model" data-locked={modelLocked}>
      <select id="mtd-model" name="model" class="select" …unchanged attributes… />
    </div>

    <div class="guess-form__label-row" data-area="year-label">
      <label for="mtd-year">Year</label>
      {#if yearInvalid}
        <p id="mtd-year-error" class="field-error">Enter a year between 1885 and {MAX_YEAR}</p>
      {/if}
    </div>
    <div class="guess-form__cell" data-area="year" data-locked={today.locks.year !== null}>
      <YearInput id="mtd-year" … invalid={yearInvalid} />   <!-- no invalidMessage prop any more -->
    </div>
    <div class="guess-form__cell" data-area="submit">
      <button type="submit" class="button button--primary" …unchanged…>Guess {n} of 5</button>
    </div>
  </div>

  <div class="guess-form__secondary">
    {#if !gameOver}
      {#if confirmingGiveUp}
        <p class="guess-form__confirm-text">Give up? This counts as a loss.</p>
        <button type="button" class="button" onclick={() => (confirmingGiveUp = false)}>Cancel</button>
        <button type="button" class="button button--danger is-confirm" onclick={confirmGiveUp}>Confirm</button>
      {:else}
        <button type="button" class="button button--danger" disabled={disabled}
                onclick={() => (confirmingGiveUp = true)}>Give up</button>
      {/if}
    {/if}
  </div>
</form>
```

Rules on that markup:

- **`.select-row`, `.guess-form__names`, `.guess-form__bottom`, `.guess-form__actions`,
  `.guess-form__field`, `.guess-form__field--year` and `.give-up-confirm` are all deleted.** They are
  presentational wrappers; nothing outside the component references any of them (verified:
  `grep -rn "guess-form\|lock-chip\|field-error\|year-input" e2e/ src/ --include='*.ts'` returns
  exactly two hits, both the `.lock-chip` locators in `playthrough.spec.ts`).
- **`.lock-chip` and its `Locked` text content survive verbatim** — `e2e/playthrough.spec.ts` asserts
  `page.locator('.lock-chip')` `toHaveText('Locked')` and a count of 2, and `GuessForm.test.ts`
  asserts `getAllByText('Locked')`. The chip **moves** from the control row to the label line; it is
  not renamed, re-worded or removed. The `text-transform: uppercase` in §5.11.4 is presentational
  only — `textContent` stays `Locked`, which is what both of those assertions read.
- **The three error `<p>` ids are unchanged** (`mtd-make-error`, `mtd-model-error`,
  `mtd-year-error`), so every `aria-describedby` in §5.3.4 and every test that reads it is unaffected.
  Only their **position in the flow** changes — onto the label line of their own field.
- **A field is never invalid and locked at once** (a locked field is `disabled` and pre-filled from
  the player's own green guess, §5.3.3), so the error and the chip can share the end of the label
  line without a collision case.
- `data-area` / `data-locked` are **style hooks only**. They are not part of the §5.3.1 contract and
  no test may key on them.
- **`YearInput` stops rendering its own message.** It drops the `invalidMessage` prop, keeps
  `invalid`, and keeps `aria-describedby={invalid ? `${id}-error` : undefined}` — `GuessForm` now
  owns all three messages, in one place, in one style. It already computes `MAX_YEAR`.

#### 5.11.4 Exact CSS

`GuessForm.svelte`'s `<style>` block, in full:

```css
/* One layout at every width (§5.11.2). The height-keyed LAYOUT branch is gone; the only
   height-keyed rule left is the gap tightening at the bottom of this block. */
.guess-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.guess-form__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-areas:
    'make-label  model-label'
    'make        model'
    'year-label  year-label'
    'year        submit';
  column-gap: var(--space-2);
  row-gap: var(--space-1);          /* label -> its own control: 4px, they are one unit */
  align-items: center;
}

[data-area='make-label']  { grid-area: make-label; }
[data-area='model-label'] { grid-area: model-label; }
[data-area='make']        { grid-area: make; }
[data-area='model']       { grid-area: model; }
[data-area='year']        { grid-area: year; }
[data-area='submit']      { grid-area: submit; }
/* The one place the rhythm opens up: 4px row-gap + 8px = 12px between the two control blocks,
   so "label sticks to its control, blocks breathe" is a single rule, not four ad-hoc gaps (U11). */
[data-area='year-label']  { grid-area: year-label; margin-top: var(--space-2); }

/* The label line exists in EVERY state — that is what makes an error cost zero layout (U6).
   Label at the start; the field's error OR its Locked chip at the end of the same line. */
.guess-form__label-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 0;
  min-height: 1.05rem;
  line-height: 1.05rem;
}

.guess-form__label-row label {
  font-size: 0.75rem;
  color: var(--color-muted);
  white-space: nowrap;
}

.field-error {
  margin: 0;
  min-width: 0;
  font-size: 0.75rem;
  line-height: 1.05rem;
  color: var(--color-danger);
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;   /* a longer future message truncates; it never wraps and never shifts */
}

.lock-chip {
  display: inline-flex;
  align-items: center;
  height: 1.05rem;
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-muted);
  font-size: 0.65rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;  /* presentational only — textContent stays "Locked" (§5.11.3) */
  white-space: nowrap;
}

.guess-form__cell { min-width: 0; }

/* Every control in the form: same height, same radius, same border, same 16px floor.
   That single rule is most of what "make it look designed" means here. */
.select,
.year-input__field,
.year-input__step,
.guess-form__cell .button {
  height: var(--touch-target);
  min-height: var(--touch-target);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  font-size: 1rem;               /* 16px floor — iOS focus auto-zoom (§5.3.5) */
}

.select {
  width: 100%;
  min-width: 0;
  padding: 0 var(--space-3);
  background: var(--color-bg-elevated);
  color: inherit;
  text-overflow: ellipsis;
  touch-action: manipulation;
}

/* − [ field ] + as a grid, not a flex row: the steppers are EXACTLY 44px and the field takes what
   is left, instead of the field collapsing and the steppers stretching. */
.year-input {
  display: grid;
  grid-template-columns: var(--touch-target) minmax(0, 1fr) var(--touch-target);
  gap: var(--space-1);
}

.year-input__step {
  width: 100%;
  background: var(--color-bg-elevated);
  font-size: 1.25rem;
  line-height: 1;
  touch-action: manipulation;
}

.year-input__field {
  width: 100%;
  padding: 0 var(--space-1);
  text-align: center;
  background: var(--color-bg-elevated);
  /* Kill the native spinner (U7): it is a second, 12px-wide stepper sitting beside our own two. */
  appearance: textfield;
  -moz-appearance: textfield;
}
.year-input__field::-webkit-outer-spin-button,
.year-input__field::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }

.guess-form__cell .button { width: 100%; }   /* fixes U4 — the button fills its column */

/* Two different "not editable" states, deliberately drawn differently (§5.3.3):
   LOCKED   = the player got it right; the value is theirs and settled -> full-strength text.
   DISABLED = the control is dead (game over, catalog failed, "choose a make first") -> muted.
   Neither uses opacity: opacity fades text and border together and drops the label under 4.5:1. */
.select:disabled,
.year-input__field:disabled,
.year-input__step:disabled {
  opacity: 1;
  background: var(--color-surface);
  color: var(--color-muted);
  cursor: not-allowed;
}

[data-locked='true'] .select:disabled,
[data-locked='true'] .year-input__field:disabled {
  color: var(--color-fg);
  font-weight: 600;
}

/* Soft-disabled submit (§5.3.4: aria-disabled, still clickable so it can explain itself). NOT a
   half-transparent accent fill (U5) — it takes the neutral control skin and snaps to the accent
   fill the moment the guess is complete, which is itself the affordance. */
.button--primary.is-disabled,
.button--primary:disabled {
  opacity: 1;
  background: var(--color-surface);
  color: var(--color-muted);
  border-color: var(--color-border);
}
.button--primary:disabled { cursor: not-allowed; }

/* Give up is secondary and destructive: below a hairline, centered, quiet, never on the primary
   button's line and never at a competing weight (U4). */
.guess-form__secondary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  border-top: 1px solid var(--color-border);
  padding-top: var(--space-1);
}

.guess-form__secondary .button--danger {
  background: transparent;
  border-color: transparent;
  color: var(--color-muted);
  padding: 0 var(--space-3);
  font-size: 0.9rem;
}
.guess-form__secondary .button--danger:hover { color: var(--color-danger); }

/* The confirmation replaces the row's contents in place (U9): prompt on its own full-width line,
   Cancel then Confirm under it. Only this row grows; the grid above the hairline does not move. */
.guess-form__confirm-text {
  flex: 1 1 100%;
  margin: 0;
  text-align: center;
  font-size: 0.8rem;
  color: var(--color-muted);
}
.guess-form__secondary .button--danger.is-confirm {
  color: var(--color-danger);
  border-color: var(--color-border);
}

/* The ONLY height-keyed rule that survives, and it changes gaps, not structure. 700px, not
   1000px: 360x640 and 320x568 need the 8px, and nothing taller does (§5.11.5). */
@media (max-height: 700px) {
  .guess-form { gap: var(--space-2); }
  [data-area='year-label'] { margin-top: var(--space-1); }
}
```

Two rules move to `app.css`, because they are app-wide, not form-local:

```css
/* One focus ring for every interactive element (U10 — there was none, so each control fell back
   to a different UA default and the <select>'s was near-invisible on the dark surface).
   --color-accent is theme-aware, so light, dark and colorblind are all covered by one rule. */
:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
/* An accent ring on an accent fill is invisible — flip it to the foreground there. */
.button--primary:focus-visible { outline-color: var(--color-fg); }

/* Replaces `.button:disabled, .button.is-disabled { opacity: 0.5 }`, which was U5's root cause and
   applied to every button in the app, not just this form. */
.button:disabled,
.button.is-disabled {
  background: var(--color-surface);
  color: var(--color-muted);
  border-color: var(--color-border);
}
```

`Modal.svelte`'s existing `outline: none` stays: it is on the dialog container, which is focused
programmatically, not by keyboard traversal.

**Theming.** Every value above is a token from `tokens.css`; the block adds no literal color. Light,
dark and colorblind therefore all follow automatically — and the form deliberately uses **no** tile
token (`--tile-green-bg` and friends), so the colorblind palette swap cannot reach it. The one
temptation, tinting the `Locked` chip with `--tile-green-bg` to echo the green tile, is rejected:
`#3b7d22` as text on the dark surface `#1c1c1f` is ~2.6:1.

#### 5.11.5 The fold argument — measured, not argued

§5.8's frozen rule, enforced by `e2e/mobile-layout.spec.ts`: at 360×640, unfocused, `scrollY === 0`,
`submit.getBoundingClientRect().bottom <= window.innerHeight`, and no horizontal overflow. Both
layouts measured the same way as §5.10.2 — `vite preview` on the real build, clock pinned
2026-09-03T12:00:00, the new CSS + markup injected into the live page, `window.scrollTo(0, 0)` before
every read.

**360×640, box by box (new layout):**

| Box | top | bottom | height |
|---|---:|---:|---:|
| header | 12 | 56 | 44 |
| image frame (`--stage-max-h` **unchanged**) | 64 | 204 | 140 |
| licence + scrub row | 212 | 256 | 44 |
| scoreboard | 264 | 429.9 | 165.9 |
| form | 437.9 | 632.5 | 194.6 |
| Make / Model selects | 458.7 | 502.7 | 44 |
| year group **and** submit (one row) | 531.5 | 575.5 | 44 |
| **submit button** | 531.5 | **575.5** | 44 |
| give-up row | 588.5 | 632.5 | 44 |
| viewport | — | **640** | — |

**Submit bottom: 612.9 → 575.5. Slack above the fold: 27.1 px → 64.5 px.** The form is 19.6 px
*taller* (175 → 194.6) and its submit button is still 37.4 px *higher*, because the wrapped
orphan row (U2) cost a whole 44 px line plus a 12 px gap and the new layout puts the year and the
submit on the row that used to hold the year alone.

**All six viewports, and the states that used to move things:**

| Viewport | submit bottom, before | submit bottom, after | give-up bottom, after | `scrollW` vs `clientW` | verdict |
|---|---:|---:|---:|---|---|
| 320×568 | 592.9 (**> 568, already failing**) | **555.5** | 612.5 | 320 = 320 | now passes |
| 360×640 (the frozen case) | 612.9 | **575.5** | 632.5 | 360 = 360 | passes, +37.4 px |
| 390×844 | 747.4 | **714.0** | 775.0 | 390 = 390 | passes |
| 412×915 | 763.9 | **730.5** | 791.5 | 412 = 412 | passes |
| 768×1024 | 1015.0 | **875.5** | 936.5 | 768 = 768 | passes, +139.5 px (U1's stack) |
| 1280×800 | 660.9 | **727.5** | 788.5 | 1280 = 1280 | passes, 66.6 px lower — the desktop form was the *cramped* one; it gains the visible `Year` label and a real give-up row |

**Zero layout shift, measured (U6, U9).** At 360×640 the form's geometry is byte-identical in all
three states — clean, after a failed submit with two messages showing, and with the make locked:

| State at 360×640 | form height | submit bottom |
|---|---:|---:|
| clean | 194.6 | 575.5 |
| invalid (`Choose a make` + `Enter a year between 1885 and 2027` both showing) | **194.6** | **575.5** |
| make locked (`LOCKED` chip on the label line) | **194.6** | **575.5** |
| give-up confirmation open | 246.1 (grows *downward only*) | **575.5** |

**The photo does not get smaller.** `--stage-max-h` is untouched: 140 px at 360×640, 274.5 at
390×844, 291 at 412×915, 360 at 768×1024, 288 at 1280×800 — identical before and after, at every
viewport measured.

**Touch targets and font sizes hold.** Both selects, the year field, both steppers, the submit and
the give-up button all measure 44 px tall; the steppers are exactly 44 px wide by grid template; all
five text controls are at `font-size: 1rem` = 16 px. The narrowest case is 320 px, where each column
is 144 px: the year field still measures 48 px (four digits at 16 px ≈ 36 px) and the submit's
`Guess 1 of 5` needs 125.9 px including padding.

#### 5.11.6 Considered and deliberately not done

- **Spending the recovered slack on the photo.** `--stage-max-h: clamp(120px, 100svh - 500px, 36svh)`
  could become `100svh - 470px`, which at 360×640 grows the stage from 140 → 170 px (+21 %) and still
  leaves 34.5 px of fold slack. It affects only short-and-narrow viewports (at 390×844 and wider the
  stage is already width-bound, so the number does not move). **Not taken in this revision**: the
  feedback's constraint is "the photo must not get smaller", the recovered slack is the design's
  safety margin against a longer licence label or a larger default font, and it would push the
  give-up row 30 px below the fold at 360×640. Recorded here with the numbers so it is a one-line
  decision later, not a re-measurement.
- **A custom-styled `<select>`.** §5.3 is explicit: native selects open the OS picker. Untouched.
- **Dropping the `Locked` chip in favour of colouring the field alone.** Color would then be the only
  signal, which §5.7 forbids.
- **A US-English rename of `.image-stage__licence` / `#mtd-photo-licence`.** Identifiers, not copy;
  `#mtd-photo-licence` is in the §5.10.1 contract and asserted by e2e (§5.13).

#### 5.11.7 Tests — what changes, and what must not

| File | Change |
|---|---|
| `e2e/mobile-layout.spec.ts` | Existing assertions are **unchanged and still pass** (measured: 575.5 ≤ 640, `scrollW` 360 = `clientW` 360, `#mtd-photo-licence` visible, five 44×44 scrub segments). **Add one assertion**: read the submit button's `bottom` before and after a failed submit (click submit with nothing chosen) and assert the two are **equal** — that is the U6 guarantee, and it is robust in a way a "give-up is also above the fold" assertion (7.5 px of margin) would not be. |
| `src/components/YearInput.test.ts` | The `renders the inline invalid message…` case loses `expect(screen.getByText('Enter a year'))` and the `invalidMessage` prop; it keeps `aria-invalid="true"` and `aria-describedby="y-error"`, and is renamed to say the message itself belongs to the parent. |
| `src/components/GuessForm.test.ts` | **No change.** Every assertion is on ids, roles, accessible names, `aria-*`, option values/text, `getAllByText('Locked')` and the give-up copy — all preserved. It is the regression net for the DOM contract during this refactor. |
| `e2e/playthrough.spec.ts` | **No change.** `.lock-chip` still exists, still reads `Locked`, still appears twice once the model locks. |

---

### 5.12 Tagline and description copy (revision 8)

One sentence, used everywhere the game describes itself. **Verbatim, including the full stops:**

> Guess the motorbike in 5 tries. A new motorbike is available each day.

Every occurrence of the old sentence and its close variants, found by
`grep -rn "zooms out\|A new puzzle every day\|make, model and year" . --exclude-dir=node_modules --exclude-dir=dist`:

| # | Where | Old | New |
|---|---|---|---|
| T1 | `index.html:7`, `<meta name="description" content="…">` | `Motodle — guess the motorbike's make, model and year from a photo that zooms out with every guess. A new puzzle every day.` | the sentence above, as the **entire** attribute value — no `Motodle — ` prefix |
| T2 | `src/components/HelpModal.svelte`, the intro `<p>` under `<h2>How to play</h2>` | `Guess the motorbike's <strong>make</strong>, <strong>model</strong> and <strong>year</strong> in 5 tries. Every wrong guess zooms the photo out a little.` | the sentence above, as plain text — no `<strong>` markup |
| T3 | `README.md:8–9`, first sentence of the description paragraph | `A daily motorbike-guessing game, in the shape of Wordle/Cardle: guess the make, model and year of a motorbike from a progressively-revealed photo.` | `A daily motorbike-guessing game, in the shape of Wordle/Cardle. Guess the motorbike in 5 tries. A new motorbike is available each day.` — the `Fully static — Vite + TypeScript + Svelte 5…` sentence that follows is unchanged |
| T4 | `docs/PLAN.md §10.5` | the head snippet does not list the description meta at all | add the `<meta name="description">` line carrying the new sentence, so §10.5 stays the single source of truth for `index.html`'s head |

- **There are no OG / Twitter-card tags** in `index.html` (verified: `grep -n "og:\|twitter:" index.html` is empty). If any are ever added they carry this same sentence verbatim, and §10.5 is where that is recorded.
- **`public/404.html` is not a place this sentence belongs** — its copy (`Nothing here`, `That page doesn't exist…`, `Play today's Motodle`) is about the 404, not the game, and is unchanged by T1–T4.
- **T2 deliberately drops two facts** from the help modal: that the three fields are make/model/year, and that a wrong guess zooms the photo out. The first is fully covered by the rules table immediately below it (its row headers *are* Make / Model / Year) and by the form's own labels; the second is self-evident on the second guess. **The "How to play" rules table, the scoring table and the midnight line are unchanged** — this is an intro swap, not a rewrite.
- The `HelpModal` test file asserts none of the old intro text, so nothing breaks; §5.13 adds one assertion that pins the new sentence.

### 5.13 US English across the app (revision 8)

**Rule.** Every user-facing string in the shipped app uses US spelling: *color / colors / colorblind*
(not *colour…*), *license* (not *licence*), *gray*, *center*, *organize*, *favorite*, and so on.

**Scope, precisely:**

- **In scope**: anything a person can read or hear — rendered text, `aria-label`, `title`, `alt`,
  `placeholder`, option text, modal headings, the footer, `index.html`'s `<title>`/`<meta>`, and
  `public/404.html`.
- **Out of scope, and deliberately left alone**: code identifiers (variables, functions, CSS class
  names, `data-*` attributes, test ids) — including `#mtd-photo-licence`, `.image-stage__licence`,
  `credits.ts`'s types, and every DOM id in §5.3.1's contract; source comments; `README.md` and
  `docs/PLAN.md` prose, **except** where they quote app copy that changed (those quotes are updated:
  §5.6's HelpModal bullet, §5.10.1's `aria-label` snippet, §5.10.4's intro block quote, §5.10.5's
  footer snippet, §10.5's head snippet).
- **Data, not copy**: license names that come from Wikimedia — `CC BY-SA 2.0 de`, `Public domain`,
  `PD-user` — are values in `puzzle.credit.license.name`. They are **never** rewritten, and the
  `Photo: ` + `license.name` rule of §5.10.1 stays verbatim.

**Every user-facing string that changes** (`grep -rniE "colour|licence|centre|grey|organis|favourite|catalogue|behaviour" src/ index.html public/404.html`, then filtered to rendered strings):

| # | File:line | Kind | Old | New |
|---|---|---|---|---|
| E1 | `src/App.svelte:97` | `aria-label` | `Toggle colourblind mode` | `Toggle colorblind mode` |
| E2 | `src/App.svelte:98` | `title` (tooltip) | `Toggle colourblind mode` | `Toggle colorblind mode` |
| E3 | `src/App.svelte:160` | footer text | `, Creative Commons licences ·` | `, Creative Commons licenses ·` |
| E4 | `src/components/CreditsModal.svelte:30–31` | modal body text | `Photos come from Wikimedia Commons under Creative Commons or public-domain licences and are cropped, resized and re-encoded.` | `…or public-domain licenses and are cropped, resized and re-encoded.` |
| E5 | `src/components/HelpModal.svelte:24` | `<h3>` heading | `Tile colours` | `Tile colors` |
| E6 | `src/components/ImageStage.svelte:74` | `aria-label` | `` `Photo licence: ${credit.license.name} (opens the licence deed)` `` | `` `Photo license: ${credit.license.name} (opens the license deed)` `` |

Nothing else in `src/`, `index.html` or `public/404.html` renders a UK spelling. The remaining 50+
grep hits are comments, test names, CSS class names and the `#mtd-photo-licence` id — all out of
scope by the rule above. `src/lib/share.ts` contains **no words at all** (header line, emoji grid,
`SITE_URL`), so the share text is unaffected; the emoji grid is untouched in every case.

**Tests and e2e that assert these strings, and must move with them:**

| # | File:line | Assertion | New value |
|---|---|---|---|
| A1 | `src/App.test.ts:89` | `getByRole('button', { name: 'Toggle colourblind mode' })` | `'Toggle colorblind mode'` |
| A2 | `e2e/colorblind.spec.ts:29` | same locator | `'Toggle colorblind mode'` |
| A3 | `e2e/colorblind.spec.ts:45` | same locator | `'Toggle colorblind mode'` |
| A4 | `src/components/CreditsModal.test.ts:51` | the intro sentence, verbatim | the E4 sentence |
| A5 | `src/components/ImageStage.test.ts:123` | `getByRole('link', { name: /Photo licence/ })` | `/Photo license/` |
| A6 | `src/components/ImageStage.test.ts:141` | same | `/Photo license/` |
| A7 | `src/components/ImageStage.test.ts:163` | same | `/Photo license/` |
| A8 | `src/components/HelpModal.test.ts` | *(new)* nothing pins the intro | add one case asserting the §5.12 sentence renders verbatim |

`e2e/mobile-layout.spec.ts:47` and `e2e/playthrough.spec.ts:56` locate `#mtd-photo-licence` **by id**
and assert `Photo: Public domain` — an id and a data value. Both are unchanged. Test *names* that
contain `colourblind` (`App.test.ts:74`, `Scoreboard.test.ts:57`, `share.test.ts:81`,
`colorblind.spec.ts:11`) are descriptions, not app copy; updating them is optional tidying and is not
required by this revision.

---

### 5.14 Impeccable pass — design brief (revision 10)

Operator ask, 2026-09-03: *"add impeccable style to the project."* This section is the **design
brief** the implementing agent builds from. It is written by the Impeccable `init` + `document` pass
(skill v4.1.3, `/home/chris/workspace/motodle/.claude/skills/impeccable`) and it changes **look, not
law**: every rule in §3, §4, §5.3.1, §5.8's fold rule, §5.9's budgets, §5.10's spoiler rule, §5.12's
tagline and §5.13's US English is untouched and binding. Where this section and any frozen contract
disagree, **the frozen contract wins and the design is wrong**.

Two new files at the repo root carry the durable context: **`PRODUCT.md`** (product truth — users,
purpose, positioning, constraints, principles) and **`DESIGN.md`** (a scan-mode record of the visual
system *as built on 2026-09-03*, i.e. the baseline this brief replaces). `DESIGN.md` must be
regenerated (`/impeccable document`) once this pass lands.

**Visitor mode: Operate**, with one **Experience moment** at the reveal. Scanability, stable
structure, native affordances and the fold outrank expression on the game screen; the result modal is
where the product is allowed to be a moment rather than a form.

#### 5.14.0 How this brief was produced

- `node .claude/skills/impeccable/scripts/context.mjs` → `NO_PRODUCT_MD` + `EXISTING_VISUAL_SYSTEM`
  (an incumbent world exists; this is a **refinement/extension**, not a redesign — the identity is
  preserved and elevated, never replaced).
- Impeccable's `init` interview could not be run: this session had **no structured question tool and
  no decision-page channel**. Every product fact was therefore inferred from the operator's brief and
  the repository, and the inferred ones are marked **[assumed]** in `PRODUCT.md` for correction.
- `document` (scan mode) → `DESIGN.md`. The `.impeccable/design.json` sidecar that `document`
  normally writes alongside it was **not** written: `.impeccable/` was outside this pass's writable
  file set. Anyone re-running `/impeccable document` after the implementation will produce both.
- Baseline evidence: `npm run build` + `vite preview` on 127.0.0.1:4173, then **90 screenshots** —
  15 screens/states × {360×640, 1280×800} × {light, dark, colorblind} — plus measured layout metrics.
  Screenshot directory:
  `/tmp/claude-1000/-home-chris-workspace/852d5747-63d4-4155-bc73-5cf062e93be6/scratchpad/shots/`
  (`metrics-360x640.json` and `frame-heights.json` sit beside them).

#### 5.14.1 Baseline — what the evidence actually shows

**Detector, static pass** — `node .claude/skills/impeccable/scripts/detect.mjs src index.html public/404.html`.
Before `DESIGN.md` existed: **zero findings** (`--json` returned `[]`), and that is the bar this pass
must not drop below. *After* `DESIGN.md` landed, the same command reports **12 advisory
design-system-drift findings** (exit code still 0 — advisories never fail): eleven literal
`font-size` values that are off the documented ramp — `0.65rem` (the `LOCKED` chip), `0.8rem` ×3,
`0.9rem` ×4, `1.1rem`, `1.4rem` — and, on `public/404.html`, one color and one radius outside the
system entirely. Those are not new defects; they are the one-off sizes §5.14.3's role scale exists to
absorb, and they should read as zero again once the ramp is adopted and `DESIGN.md` regenerated.

The rendered (URL) pass, which is the one that measures computed font sizes, contrast and spacing
rhythm in a real browser, **could not run**: it needs `puppeteer`, which is not installed and cannot
be fetched offline. Treat the static pass as a floor, not a verdict — several findings below (C9 in
particular: the 10.4 px chip sits under the detector's own 11 px functional-text floor) are exactly
what a URL pass would have raised.

**Measured (real build, `vite preview`, light theme):**

| Measurement | Value |
|---|---|
| App CSS gzipped | **3.92 KB** of a 20 KB budget → ~16 KB of headroom |
| App JS gzipped | **29.54 KB** of 60 KB → ~30 KB of headroom |
| Fold slack at 360×640 (submit bottom 575.5 vs innerHeight 640) | **64.5 px unused** |
| Photo frame (w×h) at 360×640 / 390×844 / 768×1024 / 1280×800 / 1920×1080 | 186.7×**140** / 366×**274.5** / 480×**360** / 384×**288** / 480×**360** |

The frame heights above are the **floor** for this pass (§5.14.7 raises four of the five; none may
regress). Note the plan's earlier note of *291 px at 768×1024* does not reproduce on the current
build — the measured value is 360 px, because the frame is width-limited by the 30 rem column there.

**Critique of the render (the part no detector catches):**

| # | Finding | Evidence |
|---|---|---|
| C1 | **The header speaks in emoji.** `?`, `📊`, `📅`, `◈`, `◑` are Unicode characters rendered by the platform emoji font: inconsistent color, weight and optical size, and the last two are indistinguishable from each other at 44 px. Impeccable's craft floor bans glyph-as-icon outright. | `01`–`15` screenshots, every viewport |
| C2 | **Nothing on the page is Motodle.** Remove the photo and the tiles and the screen is an unbranded form: stock system sans at one weight, stock zinc grays, a stock framework blue (`#2563eb`), stock 6/10/16 radii. The identity is carried entirely by content. | all |
| C3 | **The accent collides with a game state.** App accent `#2563eb` vs colorblind "close" `#1d4ed8` = **1.3:1**. In colorblind mode the primary button, the active crop segment and a "close" tile are the same blue. | `06-play-l3__*__cb` |
| C4 | **The colorblind "wrong" tile disappears in dark mode.** `#17171a` on the dark ground `#121214` = **1.04:1**; only the white label and the `✗` glyph are visible, the plate is not. (The share text already knows this — §4.4 sends `⬜`, not `⬛`.) | tokens.css, dark + `data-colorblind` |
| C5 | **Flat rhythm.** One 16 px gap (8 px under 1000 px height) separates *every* section, and the same hairline box wraps everything, so header, photo, board and form all read at the same weight. The squint test finds no primary element. | `02`, `06` at both viewports |
| C6 | **Desktop is a phone in the middle of a 1280 px screen.** A 480 px column, a 384×288 photo, and ~800 px of empty white on either side. The hero of the product is smaller on a laptop than on a tablet. | `*__1280x800__*` |
| C7 | **The reveal reads like a receipt.** The emotional peak — the full photograph, the answer, the score — is a stack of left-aligned paragraphs; the score `3 × 4 = 12 / 15` is body text, the attribution is a muted wall, and the modal's own `×` sits above the headline. | `08-win-result`, `13-loss-result` |
| C8 | **Destructive copy truncates.** At 360×640 the give-up confirmation renders `Give up? This count…` — the sentence that explains the consequence is ellipsized by the `max-height: 700px` rule. | `04-giveup-confirm__360x640__*` |
| C9 | **Micro-type below the legibility floor.** The `LOCKED` chip is 0.65 rem = **10.4 px** (detector floor for functional text is 11 px); the license line is 0.7 rem = 11.2 px, i.e. one hair above it. | GuessForm.svelte, ImageStage.svelte |
| C10 | **No tonal separation in light mode.** `--color-bg` and `--color-bg-elevated` are both `#ffffff`; a 1.41:1 hairline is the only thing separating a modal, a card or a control from the page. | tokens.css |
| C11 | **Zero-count stat bars are loud.** Eight accent-blue stubs labelled `0` compete with the one bar that has data; `Current streak` wraps to two lines at 360 px. | `10-stats__360x640__*` |
| C12 | **`public/404.html` is a different product.** Green button (`#3b7d22` — the *tile* green), `#fafafa` ground, no wordmark, no header, none of the app's tokens. | `15-404__*` |
| C13 | **The no-puzzle screen is missing its countdown.** §5.1 specifies "friendly message + Play the archive + **next-midnight countdown**"; the countdown is not rendered. Two-thirds of the screen is empty. | `14-no-puzzle__*` |
| C14 | **Browser surfaces ship undesigned.** No `::selection`, no caret color, no scrollbar treatment, no `text-underline-offset`, and `tabular-nums` is set exactly once (the stats countdown) while every other number in the app — years, scores, level numbers, dates — renders proportional. | app.css |

C13 adds behavior, so it is **optional and operator-gated**: implement it only if the operator wants
it; it is otherwise recorded here as a spec/implementation gap, not a design task.

#### 5.14.2 The direction

**Motodle is a pit board.** The world the audience already knows by heart is not "a word game with
photos" — it is the paddock's own information design: the timing board, the scrutineer's card, the
instrument binnacle, the service-manual plate. That world is built from exactly the elements this
game already has: a **photograph** as the object under examination, a **five-row board** of stamped
plates that read at a glance in three states, **numbers** that mean something (year, score, lap,
countdown) and therefore want an instrument voice, and a **crop ladder** that is a lap counter. So
the pass spends its budget on four things: a ground and ink that feel like **asphalt, bone and
petrol** rather than framework zinc; a **single rare accent** (deep petrol blue) that means *action*
and nothing else, leaving green / amber / red to mean *state* and nothing else; **tabular, mono-set
numerals** everywhere a number is data; and **drawn icons and a stamped wordmark** replacing the
emoji header. The photograph gets bigger at every viewport and the reveal becomes a moment instead of
a receipt. Nothing about the shape of the game changes: this is the same five guesses, in a case that
finally looks like it was made for them.

**The named rules this direction ships with** (put them in the regenerated `DESIGN.md`):

- **The One Signal Rule.** Green, amber and red belong to the scoreboard. No decorative element, no
  button, no link, no chart may borrow a state color — the single sanctioned exception stays the
  stats modal's "today's bucket" bar, which *is* a game state.
- **The Rare Accent Rule.** Petrol is the color of *action*: the primary button's fill, links, and
  the focus ring. On the game screen there is exactly **one** accent-filled element at a time (the
  submit button). Current-position state (the active crop segment, a selected row) is drawn in
  **ink**, not accent.
- **The Instrument Rule.** Every number a player reads as data — year, score, multiplier, puzzle
  number, crop level, countdown, dates — is set in the numeric stack with `tabular-nums` and
  `slashed-zero` where available. Words are never set in it.
- **The Two-Signal Rule (unchanged, restated).** Color never speaks alone: colorblind mode swaps the
  fill *and* renders the glyph, and in colorblind mode the accent itself steps out of the blue band
  so that blue means exactly one thing.
- **The Photograph First Rule.** At every viewport the photo frame is at least as large as the
  2026-09-03 baseline in §5.14.1, and any vertical space this pass recovers goes to the photo before
  it goes to anything else.

#### 5.14.3 Type system

**Families — system stacks, and the honest reason.** This pass ships **no webfont**. Not because the
policy forbids it — `schema/constants.ts`'s `CONTENT_SECURITY_POLICY` *already* contains
`font-src 'self'`, so a self-hosted subset would need **no CSP edit and no `infra/variables.tf`
edit** — but because the session that wrote this brief had no network and there is no `.woff2`
anywhere on disk to subset (verified: the only font files in the tree are Playwright's own
`codicon.ttf`). A webfont is therefore a **later, optional** revision under the operator's own rules
(≤ 60 KB total font bytes, `font-display: swap`, preloaded, self-hosted, plus the `e2e/csp.spec.ts`
check); this brief is designed to look deliberate **without** one, and the implementer must not
attempt a font download.

```css
--font-sans: system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif,
             'Apple Color Emoji', 'Segoe UI Emoji';            /* unchanged */
--font-numeric: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas,
                'Liberation Mono', 'DejaVu Sans Mono', monospace;   /* NEW */
```

`--font-numeric` is a **data** face, never a costume: it is allowed on years, scores, multipliers,
puzzle numbers, crop-level digits, dates and the countdown, and nowhere else. Set
`font-variant-numeric: tabular-nums slashed-zero` on it.

**Scale** (16 px root; no value below **0.75 rem / 12 px** renders anywhere in the app — C9):

| Role | Size / weight / tracking / leading | Where |
|---|---|---|
| `wordmark` | 1.375 rem, 800, `letter-spacing: 0.06em`, `text-transform: uppercase`, line-height 1 | `h1` "Motodle" (CSS transform only — `textContent` stays `Motodle`, and `App.test.ts` asserts the accessible name) |
| `display` | 1.5 rem, 750–800, `-0.015em`, 1.15 | the result modal's verdict line only |
| `headline` | 1.25 rem, 700, `-0.01em`, 1.2 | modal `h2` (`How to play`, `Statistics`, `Photo credits`, `Archive`) |
| `section` | 0.8125 rem, 700, `0.08em`, uppercase, `--color-muted` | modal `h3` (`Tile colors`, `Scoring`, `Score distribution`) and the scoreboard column heads |
| `body` | 1 rem, 400, 0, **1.5** (up from 1.4) | modal prose, option text, buttons, the year field |
| `control` | 1 rem, 500 | select values, button labels |
| `label` | 0.75 rem, 600, `0.07em`, uppercase, muted | `Make` / `Model` / `Year` field labels, the `LOCKED` chip (chip drops uppercase-at-10 px and takes this role at 12 px) |
| `tile` | 0.875 rem, 600, `-0.005em`, 1.1 | scoreboard tile labels; the year tile additionally takes `--font-numeric` |
| `meta` | 0.75 rem, 400 | license line (**up from 0.7 rem**), footer, credit rows, captions |
| `data-sm` / `data-lg` | `--font-numeric`, 0.875 rem / 1.5 rem, `tabular-nums` | crop-level digits, credit dates / stat values, countdown, score |

**Measure and stress.** Modal prose is capped at `max-width: 62ch` inside the 30 rem dialog (it
already lands near 60 ch — make it explicit). Long content that must survive: a 30-character model
name in a tile (ellipsis, unchanged), `Current streak` in the stats grid (see C11 fix), and the
`Give up? This counts as a loss.` sentence (C8 — it must **wrap, not truncate**).

Do **not** introduce a second display family, a serif, or an italic voice; do not letter-space
lowercase text; do not set body copy in `--font-numeric`.

#### 5.14.4 Color system

Neutrals get a **cool asphalt tint** (a trace of blue-green in the grays) rather than the current
pure zinc, light mode gains a **real elevated surface** (C10), and the accent moves from framework
blue to **petrol** — a deep cyan-blue that is unmistakably not the tile blue of colorblind mode. All
values below are computed and checked; the ratios are in the right-hand columns.

**Light (`:root`)**

| Token | Value | Checks |
|---|---|---|
| `--color-bg` | `#f4f6f7` | page ground ("bone") |
| `--color-bg-elevated` | `#ffffff` | now genuinely above the ground (C10) |
| `--color-surface` | `#e7eaed` | empty tiles, tracks, disabled fields |
| `--color-fg` | `#15181d` | 16.4:1 on bg |
| `--color-muted` | `#585e68` | 6.0:1 on bg, 6.5:1 on elevated (was 5.3:1) |
| `--color-border` | `#ccd2d9` | hairline |
| `--color-accent` | `#0d6b8a` | 5.6:1 on bg, 6.0:1 on elevated |
| `--color-accent-fg` | `#ffffff` | 6.0:1 on the accent fill |
| `--color-danger` | `#a81f1f` | 6.7:1 on bg |
| `--color-overlay` | `rgb(10 14 18 / 55%)` | scrim, slightly cooler and deeper |

**Dark (`@media (prefers-color-scheme: dark) :root:not([data-theme='light'])` **and**
`:root[data-theme='dark']` — both blocks, byte-identical, exactly as today)**

| Token | Value | Checks |
|---|---|---|
| `--color-bg` | `#101318` | "night asphalt" |
| `--color-bg-elevated` | `#171b21` | |
| `--color-surface` | `#1f242c` | |
| `--color-fg` | `#eef1f5` | 16.4:1 |
| `--color-muted` | `#9ba4b0` | 7.4:1 |
| `--color-border` | `#333b46` | |
| `--color-accent` | `#5cc4e6` | 9.3:1 on bg |
| `--color-accent-fg` | `#08121a` | 9.4:1 on the accent fill |
| `--color-danger` | `#ff8f8f` | 8.5:1 |
| `--color-overlay` | `rgb(4 6 9 / 72%)` | |

**Tiles.** `--tile-green-bg` **must stay `#3b7d22`** and the colorblind "right" fill **must stay
`#c2410c`**: `e2e/colorblind.spec.ts` asserts both hex strings verbatim, in light *and* dark, and that
spec is not in this pass's writable set. Everything else moves:

| State | Light | Dark | Text | Ratios (fill vs its text / vs its ground) |
|---|---|---|---|---|
| right | `#3b7d22` *(frozen)* | `#3b7d22` *(frozen)* | `#ffffff` | 5.07 / 4.7 light, 3.7 dark |
| close | `#8a6100` (was `#946c0a`) | `#8a6100` | `#ffffff` | **5.54** (was 4.76) / 5.1 light, 3.4 dark |
| wrong | `#b3261e` (was `#b32222`) | `#c5372c` (was `#a13a3a`) | `#ffffff` | 6.54 light, 5.31 dark / 6.0 light, 3.5 dark |
| empty | `--color-surface` + hairline | same | `--color-muted` | — |

**Colorblind (`:root[data-colorblind='true']`, still the last block in the file)**

| Token | Light | Dark (`:root[data-colorblind='true'][data-theme='dark']` **and** the `prefers-color-scheme` twin) | Why |
|---|---|---|---|
| `--tile-green-bg` | `#c2410c` *(frozen)* | `#c2410c` *(frozen)* | e2e-asserted |
| `--tile-yellow-bg` | `#1d4ed8` | `#3b6fe8` | 4.5:1 with white text, 4.1:1 against the dark ground |
| `--tile-red-bg` / `--tile-red-fg` | `#17171a` / `#ffffff` | **`#e9ecef` / `#15181d`** | fixes C4: on the dark ground the near-black plate is 1.04:1, i.e. invisible. Inverting it to bone in dark mode is also exactly what the share grid already does (`⬜`, §4.4) |
| `--color-accent` / `--color-accent-fg` | `#15181d` / `#ffffff` | `#eef1f5` / `#101318` | fixes C3: in colorblind mode blue **is** the "close" tile, so the action color steps out of the blue band and becomes ink. Links, the focus ring and the primary fill all follow the token, so this is a two-line change |

Contrast to preserve, and to re-verify after any tweak: body/placeholder text ≥ 4.5:1, large text
≥ 3:1, controls/icons/focus ring ≥ 3:1 against their own ground, tile fill vs its label ≥ 4.5:1,
tile fill vs the page ground ≥ 3:1 wherever it can be met.

**Tinting rule:** neutrals carry the asphalt hue; secondary text on a colored surface is derived from
that surface's own hue or its foreground — never a generic gray. No gradients, no glass, no glow.

#### 5.14.5 Space, shape, elevation

**Space.** Keep the 4 px-base scale and add one step for section separation:

```css
--space-1: .25rem; --space-2: .5rem; --space-3: .75rem; --space-4: 1rem;
--space-5: 1.5rem; --space-6: 2rem;   /* unchanged */
```

Rhythm replaces uniformity (C5): **inside a group 4–8 px, between groups 16–24 px**, and more space
above a heading than below it. Concretely — the photo stage and its license/scrub row are one group
(8 px); the scoreboard's header row and its five rows are one group (4–8 px); the form's label→control
is 4 px and control-block→control-block is 12 px (as today); the *gaps between* stage, board and form
go to `--space-5` (24 px) on tall viewports and stay at `--space-2` under `max-height: 1000px`. The
give-up row keeps its hairline and gains `padding-top: var(--space-3)`.

**Shape.** Tighten the radius ladder one step toward "stamped plate":

```css
--radius-sm: 4px;   /* tiles, crop segments, distribution bars, archive rows */
--radius-md: 8px;   /* every 44px control: buttons, selects, year field, icon buttons */
--radius-lg: 14px;  /* modal dialog, photo frame */
--radius-pill: 999px;
```

One hairline weight (`1px --color-border`) stays the only separator. No colored left-borders, no
double borders, no 2 px rules.

**Elevation.** Still flat, still one shadow, but a real one with offset *and* soft blur, plus a
second token for the one element that should feel physically placed:

```css
--shadow-modal: 0 18px 48px -12px rgb(8 12 18 / 34%);   /* dark: 0 18px 48px -12px rgb(0 0 0 / 62%) */
--shadow-plate: 0 1px 0 rgb(8 12 18 / 6%);              /* the photo frame + filled tiles, light only */
```

Nothing else lifts. No hover elevation on the game screen.

#### 5.14.6 Motion

One authored moment, not scattered effects. Every rule below is CSS `@keyframes` /
`transition` — **never** a Svelte `transition:` directive, which calls the Web Animations API that
jsdom does not implement and which would crash the component tests (this is why `ImageStage`'s
cross-fade is already written as a keyframe animation).

| Moment | Spec |
|---|---|
| **The stamp** (signature) | A newly submitted guess row's three tiles animate in: `opacity 0→1`, `translateY(3px)→0`, `scale(.98)→1`, **150 ms**, `cubic-bezier(.2,.8,.2,1)`, staggered **60 ms** per column (make → model → year) via `animation-delay`. Only the newest row animates — mark it in `Scoreboard.svelte` with `class:is-new={i === guesses.length - 1}`; every earlier row is static. |
| **Crop change** | Keep the existing 200 ms cross-fade; add `scale(1.015)→1` on the same keyframe so the photo *settles* instead of blinking. |
| **The reveal** (Experience moment) | In `ResultModal`: scrim `opacity 0→1` 160 ms; the dialog `translateY(8px)→0` + `opacity` 220 ms; the full photo `opacity 0→1` + `scale(1.02)→1` 260 ms with a 60 ms delay; the verdict line and the score row follow at 120 ms / 180 ms delays, 180 ms each. One orchestrated entrance, nothing repeated elsewhere. |
| **Controls** | `background-color`, `border-color`, `color` transitions at **120 ms** `ease-out` on buttons, selects, crop segments and links. No transform on hover, no scale on tap beyond the tile stamp. |
| **Focus** | Instant. The focus ring never animates. |
| **Reduced motion** | `app.css`'s global `prefers-reduced-motion` block already collapses every duration to ~0 and it stays; the result modal's own **logical** 400 ms auto-open delay is also skipped under reduced motion, exactly as §5.5's reduced-motion path already does for the crop swap. Verify with `page.emulateMedia({ reducedMotion: 'reduce' })`. |

No parallax, no marquee, no pulsing dot, no bounce/elastic easing, no layout-affecting transitions.

#### 5.14.7 Component-by-component change list

Every item names the file and the exact CSS/markup intent. **Class names and DOM hooks that tests
depend on must survive verbatim:** `#mtd-make`, `#mtd-model`, `#mtd-year`, `#mtd-photo-licence`,
`#mtd-credits`, `#mtd-credits-empty`, `#mtd-credits-more`, `#mtd-credits-link`,
`#mtd-credits-link-result`, `[data-mtd-credit-row]`, `[data-date]`, `.scrub__seg`, `.tile`,
`[data-color]`, `.scoreboard__row`, `.distribution__label`, `.distribution__bar--highlight`,
`.result-image img`, and every `aria-label` / accessible name in §5.3.1 and §5.13.

**1. Tokens — `src/styles/tokens.css`.** Apply §5.14.4 and §5.14.5 wholesale. Add `--font-numeric`,
`--radius-pill`, `--shadow-plate`, and the two colorblind accent overrides (light + dark). Keep the
file's structure and its comments about cascade specificity; the colorblind block stays last, and the
new `[data-colorblind='true'][data-theme='dark']` block goes after it at `(0,3,0)`.

**2. Global — `src/styles/app.css`.** Body `line-height: 1.5`. Add the browser-surface layer (C14),
which is the cheapest possible signal that the page was designed:

```css
::selection { background: color-mix(in oklab, var(--color-accent) 22%, transparent); color: var(--color-fg); }
:root { accent-color: var(--color-accent); caret-color: var(--color-accent);
        scrollbar-color: var(--color-border) transparent; scrollbar-width: thin; }
a { color: var(--color-accent); text-underline-offset: 0.18em; text-decoration-thickness: 1px; }
```

(`color-mix` is supported by every browser this app targets; if the implementer prefers, use a static
rgba value per theme instead.) Keep the single global `:focus-visible` rule and its
`--color-fg` flip on `.button--primary`. Give `.button` a `font-weight: 500` and the 120 ms color
transition. Add the wide-viewport composition described in item 4 **here**, not in `App.svelte`:
Svelte scopes a component's styles to its own markup, so a rule that positions child *components*
(`.app-main > .image-stage`, `> .scoreboard`, `> .guess-form`) only works from the global sheet.

**3. Header + wordmark — `src/App.svelte`.**

- **Icons (C1).** Replace all five glyph labels with authored inline SVG: 20×20 viewBox,
  `stroke="currentColor"`, `stroke-width="1.75"`, `stroke-linecap="round"`, `stroke-linejoin="round"`,
  `fill="none"`, `aria-hidden="true"`, `focusable="false"`. One consistent family, drawn as:
  help = a question mark in a circle; statistics = three ascending bars; archive = a calendar/grid;
  theme = a circle with a half-filled disc; colorblind = a circle split into two contrasting halves
  with the `✓ ~ ✗` idea reduced to a single diagonal. **Every `aria-label` and `title` stays exactly
  as it is today** (`How to play`, `Statistics`, `Archive`, `Change theme`, the `themeTitle`
  expression, `Toggle colorblind mode`), and `aria-pressed` stays on the colorblind toggle. No icon
  package, no icon font — inline SVG only (§5.2).
- **Wordmark.** `h1` takes the `wordmark` type role (uppercase via CSS, `textContent` unchanged — the
  accessible name `Motodle` is asserted by `App.test.ts:49`). Prefix it with an `aria-hidden="true"`
  inline-SVG mark: three ascending ticks / a chevron cut from the same 1.75 px stroke family, 18 px,
  in `--color-accent`. It must not add text to the heading.
- **Header rule.** Give the header a `border-bottom: 1px solid var(--color-border)` and
  `padding-bottom: var(--space-2)` so the board below reads as a separate group (C5). Icon buttons:
  radius `--radius-md`, transparent background at rest, `--color-surface` on hover/focus, muted
  stroke that goes to `--color-fg` on hover; the colorblind toggle's `aria-pressed="true"` state gets
  an ink fill with `--color-bg` stroke so "on" is visible without color alone.
- At `max-width: 380px` keep the existing 2 px gap escape hatch; verify the five 44 px buttons plus
  the wordmark still fit under DejaVu Sans (the CI runner's fallback).

**4. Layout — `src/App.svelte` + `app.css`.**

- **Phone (unchanged topology).** Single column, `max-width: 30rem`, order header · practice bar ·
  stage · board · form · footer. Only the rhythm changes (§5.14.5).
- **The photo gets bigger (P1).** In `ImageStage.svelte`, change
  `--stage-max-h: clamp(120px, 100svh - 500px, 36svh)` to
  **`clamp(140px, 100svh - 470px, 40svh)`**. Predicted frames: 360×640 → 226×**170** (+30 px);
  390×844 → 450×**337** (+63 px); 768×1024 → 480×**360** (unchanged, width-limited); 1280×800 →
  426×**320** (+32 px); 1920×1080 → 480×**360** (unchanged, then superseded by the wide layout
  below). The 360×640 fold has 64.5 px of slack today, so a +30 px stage leaves ~34 px — **measure,
  do not assume**: `e2e/mobile-layout.spec.ts` is the gate, and if it fails, spend the difference by
  reducing the short-viewport section gap rather than shrinking the photo back.
- **Wide viewports (P2, recommended).** At `@media (min-width: 900px) and (min-height: 620px)`, widen
  the column to `min(72rem, 100%)` and lay `.app-main` out as a two-column grid from the global
  sheet, DOM order untouched:

  ```css
  .app-main { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(21rem, .9fr);
              grid-template-areas: 'stage board' 'stage form'; align-content: start;
              column-gap: var(--space-6); row-gap: var(--space-4); }
  .app-main > .image-stage { grid-area: stage; }
  .app-main > .scoreboard  { grid-area: board; }
  .app-main > .guess-form  { grid-area: form; }
  .app-main > .state-message { grid-column: 1 / -1; }
  ```

  with `--stage-max-h` released to `min(60svh, 34rem)` inside that media query, which puts the
  1280×800 frame near 512×**384** — well above the 288 px floor. The header and footer stay
  full-width. If any e2e spec (they run at Playwright's 1280×720 desktop default) proves unhappy,
  fall back to the single column plus the larger `--stage-max-h`; the photo floor is what matters,
  the two-column layout is the upside.
- **Skeleton.** The loading skeleton keeps the reserved 4:3 box; give it a subtle two-stop shimmer
  that respects reduced motion, or leave it flat — never a spinner.

**5. Image stage — `src/components/ImageStage.svelte`.**

- Frame: `--radius-lg`, `--shadow-plate` in light mode, a 1 px `--color-border` in dark, and
  `background: var(--color-surface)`. Add a hover/focus affordance for "tap to enlarge": a small
  ink-on-bone corner mark (inline SVG, `aria-hidden`) at 8 px inset, visible at rest at 55 % opacity —
  today nothing suggests the photo is interactive.
- Crop scrub: segments keep `min 44×44`, take `--radius-sm` and `--font-numeric`. **The current
  segment is ink, not accent** (`background: var(--color-fg); color: var(--color-bg);`), the unlocked
  ones are `--color-bg-elevated` with a hairline, and locked ones drop to `--color-surface` with
  `--color-muted` and no border. This frees the accent for the submit button (Rare Accent Rule) and
  reads as "you are here" rather than "click me".
- License line: 0.75 rem (up from 0.7), `--color-muted`, `text-underline-offset: .18em`, unchanged
  text and `aria-label`, unchanged position in the shared row. **Nothing from `credit` other than
  `license.name` / `license.url` may enter this subtree** (§5.10.1 — the component test asserts it).

**6. Scoreboard — `src/components/Scoreboard.svelte`.** This is the signature component; it should
read as a board of stamped plates.

- Column heads take the `section` type role (0.8125 rem, uppercase, tracked, muted) and sit above a
  1 px `--color-border` rule that spans the board.
- Tiles: `--radius-sm`, `--shadow-plate` in light, `border-color` matching the fill as today, tile
  type role, and the **year column set in `--font-numeric` with `tabular-nums`** so five years form a
  column that lines up. Empty tiles get a slightly inset look — `background: var(--color-surface)`,
  `border: 1px solid var(--color-border)` and no shadow — so filled rows advance visually.
- Keep `min-height: 2rem` (1.6 rem under `max-height: 1000px`), keep the `role="table"` structure,
  the visually-hidden per-cell sentences, the live region, and the colorblind glyph markup exactly.
- Add the stamp animation (§5.14.6) via a new `is-new` class on the latest row only.

**7. Guess form — `src/components/GuessForm.svelte` + `YearInput.svelte`.** The §5.11 grid is good
work; keep the structure and restyle it.

- Labels take the `label` role (0.75 rem, 600, uppercase, tracked, muted). **The `<label>` element's
  text content stays exactly `Make` / `Model` / `Year`** — uppercase is `text-transform` only,
  because those strings are the selects' accessible names (`App.test.ts:53–54`).
- `LOCKED` chip (C9): 0.75 rem, weight 600, `--radius-pill`, ink-on-surface at
  `background: var(--color-surface); color: var(--color-fg); border-color: var(--color-border)`, with
  a 10 px inline lock SVG (`aria-hidden`) before the word. It must sit on **its own field's** label
  line — today at 360 px the make chip visually collides with the neighbouring `Model` label; give
  the label row `justify-content: space-between` per column and let the chip shrink first.
- Selects: `--radius-md`, `--color-bg-elevated`, 1 px border, `font-weight: 500`. Locked selects keep
  full-strength ink at 600 (the value is the player's own) plus a 1 px `--color-fg` left edge? **No —
  no colored left borders** (craft floor). Signal "settled" with the chip and the ink weight only.
- Primary submit: the **one** accent-filled element on the screen. Accent fill, `--color-accent-fg`
  text, `--radius-md`, weight 600, 120 ms color transition. The soft-disabled state keeps today's
  semantics (`aria-disabled`, clickable so it can explain itself) drawn as an accent **outline** on
  the surface fill; the truly inert state stays the neutral muted skin. Do not use `opacity` for
  either.
- Give-up row: keep the hairline and the quiet treatment; **fix C8** by removing
  `white-space: nowrap` / ellipsis from `.guess-form__confirm-text` in the `max-height: 700px` block
  and letting the sentence wrap onto two lines (the row may grow; only the submit button's position
  is contractual, and it sits above the hairline). `Cancel` and `Confirm` keep their 96 px matched
  minimum; `Confirm` takes `--color-danger` text with a `--color-danger` hairline so it reads as the
  destructive one.
- `YearInput`: steppers take `--radius-md` and the same 1 px border; the field takes
  `--font-numeric`, `tabular-nums`, weight 600, `font-size: 1rem` (the 16 px floor is contractual).
  Keep the native-spinner suppression and the auto-repeat behavior verbatim.

**8. Modal shell — `src/components/Modal.svelte`.** `--radius-lg`, the new `--shadow-modal`, the new
overlay color, `padding: var(--space-5)`, and a `max-width: 32rem`. Move the close button so it no
longer overlaps the title's optical space: keep it at the top-right but give the dialog
`padding-top: var(--space-6)` so `h2` starts below it, and draw it as a bordered 44 px icon button
with an inline-SVG `×` (two strokes, same family as the header icons) instead of the `&times;`
character — its `aria-label="Close"` is unchanged. Keep the focus trap, Esc handling, backdrop
`pointerdown` close, opener refocus and `overscroll-behavior` exactly as they are.

**9. Help modal — `src/components/HelpModal.svelte`.** Copy is frozen (§5.12/§5.13/§5.6). Restyle
only: `h3`s take the `section` role; the rules table gets `border-collapse: separate`,
`border-spacing: 0`, a hairline under the header row only, and `padding: var(--space-2) var(--space-2)`;
the three column-head swatches become full 24×24 tiles drawn from the *same* CSS as a real scoreboard
tile (fill + glyph) so the legend and the board are visibly the same object; the multiplier table's
numbers take `--font-numeric` + `tabular-nums`. `Got it` is the accent-filled primary and should be
full-width on phones.

**10. Stats modal — `src/components/StatsModal.svelte`.** All four stat values take `data-lg`
(`--font-numeric`, 1.5 rem, tabular); the captions take the `label` role, and **`Current streak` must
not wrap awkwardly at 360 px** (C11) — either shorten the visible caption to `Streak` / `Best` with a
visually-hidden long form, or give the grid `grid-template-columns: repeat(2, 1fr)` under 380 px.
Distribution (C11): the track keeps `--color-surface`; a **zero-count** bar renders as a bare label
with no filled bar at all (just the `0` in muted ink at the track's left edge) instead of a colored
stub; non-zero bars fill with `--color-fg` at 12 % opacity plus an ink label — **not** the accent —
and today's bucket keeps `--tile-green-bg` with `--tile-green-fg` (this is the sanctioned state-color
exception). `.distribution__label` and `.distribution__bar--highlight` **must keep their class names**
(component test). Countdown keeps `tabular-nums`, takes `data-lg`, and gets a `Next Motodle` label in
the `label` role above it.

**11. Result modal — `src/components/ResultModal.svelte`. This is the Experience moment.**

- Compose it as: **verdict** (`display` role — `You got it!` / `Better luck tomorrow`, unchanged
  strings) → **answer** (`2002 Kawasaki Ninja ZX-6R`; the year in `--font-numeric`, the make/model in
  the sans at 1.125 rem/600) → **the photograph, edge to edge** (negative horizontal margin equal to
  the dialog padding, corners squared off against the dialog's own radius on the top edge if it
  reaches it, `--radius-sm` otherwise) → **score row** → **attribution caption** → **actions**.
- Score row: `points × multiplier = score / 15` where every numeral is `--font-numeric`; render it as
  three ink-on-surface plates in a row (`points`, `multiplier`, `total`) with `label`-role captions,
  not as a sentence. The existing `<p class="result-score">` text may become that row; keep the same
  numbers and the same `/ 15` denominator.
- Attribution: keep every field and every link exactly as specified in §5.10.3 (author · license link
  · `credit.modified` · `Source on Commons` · `creditNote`), set at 0.75 rem `meta`, above a hairline,
  with the links underlined at the new offset. It is a caption now, not a wall.
- Actions: `Share` is the accent-filled primary and is full-width on phones; `Photo credits` stays a
  `link-button` and keeps `id="mtd-credits-link-result"` and its close-then-open handler.
- The `.result-image img` selector and the letterboxing behavior (`aspect-ratio: 4 / 3`,
  `object-fit: contain`) are asserted by the component test — keep both.
- Apply the reveal motion from §5.14.6.

**12. Credits modal — `src/components/CreditsModal.svelte`.** Keep every DOM hook and every string.
Restyle each row as a two-line record: line 1 = `Motodle #N` in `--font-numeric` + the date in muted
`--font-numeric`, then the bike; line 2 = `photo by …` and the two links in `meta` role. Hairline
between rows (already there), `--space-3` internal rhythm, `creditNote` stays italic muted. The
`Show more (N remaining)` button is a neutral `.button`, full-width.

**13. Archive — `src/components/ArchiveList.svelte`.** Each row becomes a plate: `--radius-sm`,
`--color-bg-elevated`, hairline, 44 px min-height, `Motodle #N` in `--font-numeric` at the start and
the date muted `--font-numeric` at the end, hover to `--color-surface`, no underline. Empty state
copy unchanged.

**14. Toast — `src/components/Toast.svelte`.** Keep the role/live-region and position; take
`--radius-md`, the new `--shadow-modal`, and `--color-fg`/`--color-bg` inversion as today. Entrance:
`translateY(6px)→0` + opacity, 160 ms, reduced-motion-safe.

**15. Footer + state messages + banners — `src/App.svelte`.** Footer: `meta` role, muted,
`border-top: 1px solid var(--color-border)`, `padding-top: var(--space-3)`; `.link-button` keeps its
relaxed touch target (§5.10.5) and gains the new underline offset. State messages
(`no-puzzle` / `load-failed` / `catalog-failed`): `--radius-lg`, `--color-bg-elevated`, hairline,
`--space-5` padding, centered on wide viewports, with the message in `body` and the action as the
accent primary. Practice bar and the stale-day banner: `--radius-md`; the banner keeps the accent fill
(it is an action prompt, and it is never on screen at the same time as the submit button's own
accent... verify that claim on a real rollover, and if both can co-exist, draw the banner in ink with
an accent underline instead).

**16. `public/404.html` (C12).** Self-contained by design (no access to `tokens.css`), so inline the
same values: `#f4f6f7` ground / `#15181d` ink / `#0d6b8a` accent in light, `#101318` / `#eef1f5` /
`#5cc4e6` under `prefers-color-scheme: dark`, `--radius-md` button at 44 px with the accent fill, and
the **wordmark** above the message in the same uppercase-tracked treatment (plain text, no SVG needed).
Copy stays exactly as it is (§5.12 explicitly keeps 404 copy out of the tagline rule).

**17. `index.html`.** Update the two `theme-color` metas to the new grounds (`#f4f6f7` light,
`#101318` dark) and regenerate the inline-SVG favicon in the new palette (ink plate, accent or bone
letterform) — it currently uses the tile green, which the One Signal Rule reserves for "right".
**Whoever makes this edit must also update §10.5's head snippet**, which is the single source of truth
for `index.html`'s head.

#### 5.14.8 Explicitly NOT changed

- **Every game rule, score, lock, share string and storage key.** §4 in full, `src/lib/**`,
  `src/state/**`, `schema/**` — this pass touches presentation only. `src/lib/share.ts` in
  particular: the emoji grid, including `⬜` for colorblind red, is untouched.
- **The §5.3.1 DOM contract**: `#mtd-make`, `#mtd-model`, `#mtd-year`, option values = catalog ids,
  the visible label texts `Make` / `Model` / `Year`, native `<select>`s (no combobox, no typeahead,
  ever), and the accessible names `Guess {n} of 5`, `Give up`, `Confirm`, `Cancel`, `Close`,
  `How to play`, `Statistics`, `Archive`, `Change theme`, `Toggle colorblind mode`, `Enlarge image`,
  `Crop level N of 5`, `Earlier year`, `Later year`.
- **All credits/licence hooks**: `#mtd-photo-licence` and its `Photo: ` + `license.name` text,
  `#mtd-credits*`, `[data-mtd-credit-row]`, `[data-date]`, and the spoiler rule that keeps `author`,
  `fileTitle`, `descriptionUrl` and `creditNote` out of the image-stage subtree.
- **Copy.** The §5.12 tagline verbatim, the help rules table and its wording, the scoring table, the
  credits intro, the empty/failed-state sentences, the footer sentence, US English (§5.13). Any copy
  change is an operator decision, not a design one.
- **Theming contract.** Light on bare `:root`; dark in **both** the `prefers-color-scheme` block
  (guarded `:root:not([data-theme='light'])`) and `:root[data-theme='dark']`; colorblind last;
  `color-scheme: light dark`; the glyphs; `--tile-green-bg: #3b7d22` and the colorblind
  `#c2410c` (e2e-asserted verbatim).
- **The fold rule, touch targets and input sizing.** 44 px minimum for interactive controls, 16 px
  minimum for focusable text fields, `100svh` (never `dvh`), `env(safe-area-inset-*)` padding, pinch
  zoom never suppressed, `prefers-reduced-motion` honored for animation **and** logical delays.
- **Budgets and dependencies.** CSS ≤ 20 KB gz, JS ≤ 60 KB gz, per-day payload untouched, **no
  runtime dependency**, no UI kit, no icon package, no webfont from any host, no `@import`.
- **CSP and infrastructure.** `schema/constants.ts`'s policy is unchanged (it already allows
  `font-src 'self'`), `infra/**`, `.github/**`, `tools/**` and `public/puzzles/**` are untouched.
- **Svelte 5 idioms.** No `let x = $state(prop)`; no exported reassigned `$state` in `.svelte.ts`
  (§10.7 #8/#9). Keep animations as CSS keyframes, not `transition:` directives.
- **Photo floor.** No viewport may render the frame smaller than the §5.14.1 baseline.

#### 5.14.9 The gate before this pass may be called done

1. `npm run build` — budgets green (CSS is the one to watch; there is ~16 KB of gzip headroom).
2. `npx vitest run --maxWorkers=1` and `npm run check` — clean.
3. `npx playwright test --workers=1` — all specs, `mobile-layout` and `colorblind` in particular.
4. `node .claude/skills/impeccable/scripts/detect.mjs src index.html public/404.html` — **zero
   non-advisory findings**, and the advisory `design-system-*` list (12 at baseline, §5.14.1) should
   be empty once the §5.14.3 ramp is in and `DESIGN.md` has been regenerated. Every remaining
   advisory needs a one-line reason.
5. Re-measure the photo frame at 360×640, 390×844, 768×1024, 1280×800, 1920×1080 and confirm every
   value is **≥** the §5.14.1 baseline; re-measure the 360×640 fold (`submit.bottom ≤ innerHeight`,
   `scrollWidth ≤ clientWidth`).
6. Re-shoot the 15 states × 2 viewports × 3 themes matrix and look at them, colorblind-dark included
   (that is where C4 lives).
7. Re-run `/impeccable document` so `DESIGN.md` describes the world that actually shipped, and record
   the pass in §11.

#### 5.14.10 Critique findings and decisions (revision 10)

`/impeccable critique`, 2026-09-03, run against the current build (`npm run build` + the init pass's
90-screenshot matrix in
`/tmp/claude-1000/-home-chris-workspace/852d5747-63d4-4155-bc73-5cf062e93be6/scratchpad/shots/`,
looked at directly, plus a fresh `detect.mjs` run and a source read of every `.svelte` file, the two
stylesheets, `index.html` and `public/404.html`).

**⚠️ DEGRADED: single-context (no sub-agent/Task tool exposed in this session).** `critique.md`
requires Assessment A (design review) and Assessment B (detector + browser evidence) to run as two
isolated sub-agents. This session's tool surface exposes no `Task`/subagent tool (probed:
`ToolSearch select:Task,Agent` → no match), so both assessments were run sequentially in one context:
the design review was written from the screenshots and sources **before** the detector was run, and
the detector output was folded in afterward. **Two further substitutions, disclosed per the skill's
`AUTONOMY_DIRECTIVE_CHECK`:** (1) there is no `AskUserQuestion` tool and no decision-page channel
(probed, no match), so the playbook's closing questions could not be asked — they are recorded below
as **§5.14.10.9 Open questions for the operator** instead of being put to a human; (2) the run's
snapshot was **not** persisted to `.impeccable/critique/`, because `.impeccable/` is outside this
pass's writable file set. This subsection *is* the archive.

Numbering: findings here are **K1…K13** so they never collide with §5.14.1's **C1…C14**. Where a
K-finding restates a C-finding it says so and adds only what is new. **§5.14.10.6 lists the places
where this critique overrides the init brief** — those amendments win over §5.14.2–§5.14.7.

##### 5.14.10.1 Design health score

Mode is **Operate** (§5.14), so all ten heuristics apply; none is scored `n/a`.

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Strong in play (`Guess n of 5` on the button, the board, the live region, `LOCKED` chips, the stale-day banner). But nothing on the page says *which* puzzle this is (`#N` exists only inside the archive/credits modals and the share text), and once the game ends the screen reports no status at all — see K1. |
| 2 | Match between system and real world | 3 | `Make` / `Model` / `Year`, `Give up` and the multiplier table are the player's language. Against that: `Photo by uploader was User:HellbillyD at en.wikipedia` is a raw Commons field shown verbatim at the emotional peak; `0 × 1 = 0 / 15` is arithmetic notation where a result belongs; the archive lists ISO dates (`2026-09-02`). |
| 3 | User control and freedom | 2 | Esc / backdrop / close on every dialog, Cancel on give-up, practice + `Back to today`. But the reveal **cannot be reopened** — `openResult()` in `src/state/game.svelte.ts:352` has no caller anywhere in `src/` (verified by grep), so closing the result modal permanently removes the answer photo, the attribution and the score from the session; and the auto-opened first-run help modal hides its own `Got it` below an un-hinted scroll at 360×640 (K3). |
| 4 | Consistency and standards | 2 | The engineering is consistent (one control height, one focus ring, one token file). The *visual language* is not: four icon idioms in a single header row (a text `?`, a color emoji `📊`, a color emoji `📅`, two near-identical geometric circles `◐`/`◑`), eleven distinct `font-size` literals, and a `public/404.html` built from an entirely different palette. |
| 5 | Error prevention | 3 | Genuinely good: native `<select>`s make an invalid make/model unrepresentable, the model list is gated on the make, the year is clamped to 1885…+1 and validated by parse rather than length, `novalidate` keeps validation in the app's own voice, and give-up is confirmed. One point off because the confirmation sentence that states the consequence is the one string that truncates at 360×640 (C8). |
| 6 | Recognition rather than recall | 2 | Every option is visible in the selects and every field is labelled. But the entire header is icon-only with no visible text; two of the five icons are indistinguishable at 44 px; and the theme button's glyph never changes, so the only way to learn which of the three theme states you are in is a `title` tooltip that does not exist on touch (`App.svelte` says so in a comment). |
| 7 | Flexibility and efficiency of use | 3 | More accelerators than the surface suggests: Enter-to-submit wired explicitly through the `<select>`s, arrow-key roving on the crop scrub, press-and-hold auto-repeat on the year steppers with keyboard equivalents, the three-rung share ladder, archive/practice via `?d=`. Missing: any way back to the reveal, and any keyboard path to help/stats. |
| 8 | Aesthetic and minimalist design | 2 | The empty five-row board is the largest object on the first screen (166 px of grey lozenges against a 140 px photograph); `Make Model Year` is printed twice, 14 px apart; the stats distribution draws eight accent-blue stubs labelled `0`; the desktop layout is a 480 px column with ~800 px of empty white beside it. |
| 9 | Help users recognize, diagnose and recover from errors | 2 | The messages themselves are exemplary — `Choose a make`, `Enter a year between 1885 and 2027`: plain, specific, actionable. They are **positioned over the wrong controls** (K2), which is worse than a vague message correctly placed. The load/catalog failure states capture `puzzleReason` / `catalogReason` in the store and show neither. |
| 10 | Help and documentation | 3 | The 3×3 rules grid is the best-designed artifact in the app: one short cell per rule, the yellow bands explained in a player's words, auto-opened on first run. Held back by K3 (its dismiss is below the fold on a phone) and by nothing explaining the crop ladder or the archive anywhere. |
| **Total** | | **25/40** | **Acceptable — significant improvements needed before players are happy.** |

Read that number correctly: this is not a broken interface. It is a **well-engineered, undesigned**
one. Almost every point lost is a presentation decision, which is exactly what this pass is allowed
to change. The three that are not (K1, K2, K3) are cheap.

##### 5.14.10.2 Design specificity verdict

**LLM assessment: category-interchangeable.** Replace the photograph with an album cover, a film
still, a flag or a car and *nothing else on the page would need to change*. The only two decisions in
the entire interface that are specific to motorbikes are functional, not expressive: the three-column
`Make / Model / Year` board, and the crop ladder. Everything drawn around them is default —
`system-ui` at one weight, zinc grays, framework blue `#2563eb`, a 6/10/16 radius ladder, emoji as
icons, a uniform 16 px gap between every section. The product's real position (per `PRODUCT.md`: the
country/era yellow bands, and "every puzzle is a real, CC-licensed photograph of a real bike, credited
in full") is stated nowhere in the visual language. This confirms and sharpens §5.14.1's **C2**.

**Deterministic scan.** `node .claude/skills/impeccable/scripts/detect.mjs --json src index.html public/404.html`
→ **12 findings, all `advisory`, all `design-system-*` drift** (exit 0): ten `design-system-font-size`
(`GuessForm.svelte` 320/409/431 → `0.65rem`, `0.9rem`, `0.8rem`; `HelpModal.svelte` 91 → `0.9rem`;
`ResultModal.svelte` 81 → `1.1rem`; `Scoreboard.svelte` 83 → `0.8rem`; `StatsModal.svelte` 98/138 →
`1.4rem`, `0.8rem`; `Toast.svelte` 28 → `0.9rem`; `app.css` 200 → `0.9rem`), one
`design-system-color` (`public/404.html:35` → `rgb(237,237,237)`), one `design-system-radius`
(`public/404.html:28` → `0.5rem`). Zero `critical`, zero `warning`. This reproduces §5.14.1 exactly
and adds one number worth having: a raw count of every `font-size` literal in the tree gives
**twelve distinct values** — `0.65 / 0.7 / 0.75 / 0.8 / 0.85 / 0.9 / 1 / 1.1 / 1.25 / 1.4 / 1.5 rem`
plus one `16px`. An app with roughly six type roles is carrying an eleven-step ramp. The detector's
finding is real regardless of which `DESIGN.md` it is measured against.

The detector caught nothing the design review missed, and the design review caught the majority of
what follows, because every K-finding below is about composition, state and moment — categories a
static scanner cannot see. **No false positives.** The rendered/URL pass (computed contrast, real
spacing rhythm) still cannot run: it needs `puppeteer`, absent and unfetchable offline.

**Visual overlays: not available.** No browser automation with script injection was used in this run,
so **no user-visible overlay exists** in any browser tab. The fallback signal is the CLI scan above
plus the screenshot matrix.

##### 5.14.10.3 Cognitive load

Eight-item checklist, judged at 360×640 mid-game (`06-play-l3`):

| Item | Verdict |
|---|---|
| Single focus | **Fail** — the squint test finds no primary element. The loudest object on the play screen is the crop scrub (five 44 px buttons, one filled accent-blue); the quietest is the photograph. |
| Chunking | Pass |
| Grouping | **Fail** — one 16 px gap (8 px under 1000 px height) separates *every* section, so header, stage, board and form are four equal slabs with nothing binding any of them. |
| Visual hierarchy | **Fail** — the hero is the smallest element on the page (140 px tall) and the empty state of the scoring surface is the largest (166 px). |
| One thing at a time | Pass |
| Minimal choices | Pass at the actual decision point (make, model, year, submit = 4). Noted below at the header (5 icon buttons, two of which are settings, not actions). |
| Working memory | **Fail** — the reveal modal covers the board at the exact moment the player is asked to `Share` the grid it draws, so the result and the grid it summarizes are never on screen together. |
| Progressive disclosure | Pass |

**4 failures → high cognitive load.** Three of the four (single focus, grouping, visual hierarchy) are
one root cause — the uniform rhythm named in **C5** — which means §5.14.5's rhythm work clears three
boxes with one change. That is the single highest-leverage item in the whole brief.

##### 5.14.10.4 What is working (do not "improve" these)

1. **The guess form is the most carefully-reasoned surface in the app.** The single two-column grid
   at every width, the label line that exists in *every* state so an error costs zero layout, the
   deliberate visual split between LOCKED (the player's own settled answer, full-strength ink) and
   DISABLED (dead control, muted) — with the explicit refusal to use `opacity` for either — and the
   soft-disabled submit that stays clickable so it can explain itself. This is better than most
   shipping product forms. §5.14.7 item 7 is right to restyle and not restructure it.
2. **The help modal's rules grid.** Three categories × three colors as a table of one-phrase cells,
   with the country example spelled out in the player's own words. It teaches the game's actual
   differentiator (the yellow bands) in about eight seconds. Make the rest of the app as clear as
   this table.
3. **The accessibility scaffolding is real, not performative.** Per-cell visually-hidden sentences,
   a dedicated polite live region for the newest row (with a comment explaining why it is *not*
   `role="status"`), glyphs that are markup rather than CSS `content` so they stay in the
   accessibility tree, one focus ring for everything, 44 px targets, a 16 px input floor, `svh` over
   `dvh`, pinch-zoom never suppressed, and reduced motion honored. Every restyle below must survive
   with all of it intact.

##### 5.14.10.5 Priority findings and decisions

Ranked by impact. Each carries the **decision the implementer executes**. Findings marked
**[operator-gated]** add behavior or a new visible string and must not be built without the
operator's word; everything else is presentation and is in scope now.

---

**K1 · [P1] After the game ends, the screen is a corpse — and the reveal cannot be reopened.**
*New; §5.14 does not address the post-game state at all.*

When today's game is over, the largest object on the page is a dead form: locked `<select>`s, a
disabled button still reading `Guess 3 of 5`, and no give-up row. There is no Share, no score, no
streak, no countdown, no path back to the answer photograph. `openResult()` exists at
`src/state/game.svelte.ts:352` and **nothing in `src/` calls it** — verified by grep. So the reveal is
a one-shot: close it and the answer, the attribution and the score are gone until a page reload, at
which point `applyPuzzleResult()` (`:225`) shoves the modal back in the returning player's face
unbidden. Both directions are wrong. For a product whose entire value is the *return visit*, the
screen a returning player actually lands on offers them nothing, and the two things that bring them
back — the streak and the countdown — are buried behind an unlabelled bar-chart emoji.

*Evidence:* `09-after-win-board__360x640__{light,dark,cb}`, `src/state/game.svelte.ts:225,352`.

**Decision.** Two rungs; ship rung 1 in this pass.

- **Rung 1 (in scope, presentation + one existing store method).** When `today.status !== 'in_progress'`,
  the submit button's grid cell renders a control that calls the existing `game.openResult()` instead
  of a dead disabled submit. Wire it, do not invent state.
  **The submit button itself must still exist** with its `Guess {n} of 5` accessible name and its
  `button[type="submit"]` selector intact (`App.test.ts:104`, `e2e/mobile-layout.spec.ts`,
  `e2e/blocked-submit.spec.ts` all address it) — so add the reopen control as a **sibling in the
  `guess-form__secondary` row**, which is empty in the game-over state today (`{#if !gameOver}`),
  rather than replacing the submit. That row already has the hairline and the centered layout, and
  it costs no layout above the hairline, so `mobile-layout.spec.ts`'s "submit does not move"
  assertion is untouched. The new string is **[operator-gated]** — propose `See the answer`,
  matching the existing accessible-name vocabulary (`How to play`, `Photo credits`).
- **Rung 2 [operator-gated].** The end-of-day screen becomes a small result summary panel (score
  plates + `Next Motodle` countdown + Share) in place of the dead form. Records the intent; do not
  build it without a decision.

---

**K2 · [P1] Validation messages point at the wrong field.**
*New; §5.14.7 item 7 notices only the `LOCKED` chip's collision, not the errors'.*

`.guess-form__label-row` is `justify-content: space-between`, so the make column's error renders
flush against the **right** edge of that column — directly abutting the word `Model`. At 360×640 the
line reads `Make        Choose a make | Model`, and the message describing the *make* field sits
optically closer to the *model* select than to the one it belongs to. Same class of failure on the
year row, where `Enter a year between 1885 and 2027` spans across and terminates above the **submit
button**, not above the year field. This is a clarity defect in the one place the app talks to a
player who has already made a mistake — the moment where a first-timer decides whether the game is
worth the trouble.

*Evidence:* `03-validation__360x640__light` (and both other themes), `GuessForm.svelte`
`.guess-form__label-row`.

**Decision.** Change `.guess-form__label-row` from `justify-content: space-between` to
`justify-content: flex-start` with `gap: var(--space-2)`, so the error sits **immediately after its
own label**, and let the `LOCKED` chip take `margin-left: auto` to keep its end-of-line position (a
chip cannot be misread as belonging to the neighbouring field the way a sentence can). Drop
`text-align: right` from `.field-error`; keep `white-space: nowrap` + `text-overflow: ellipsis` **only
for the two short messages**, and keep `min-height: 1.05rem` / `line-height: 1.05rem` on the row so
the zero-layout-cost guarantee (§5.11.4 U6) and `mobile-layout.spec.ts`'s
`bottomAfter === bottomBefore` assertion both hold exactly as today. Add a 12 px inline warning SVG
(`aria-hidden`, `--color-danger`, same 1.75-stroke family as the header icons) before the message so
an error is legible as an error without relying on the red alone.

---

**K3 · [P1] The mandatory first-run modal hides its own exit below an un-hinted scroll.**
*New; §5.14.7 item 9 restyles the help modal but does not touch its scroll behavior.*

`prefs.seenHelp` is false on a first visit, so a first-timer's very first sight of Motodle is a
full-screen dialog. At 360×640 `.modal-dialog`'s `max-height: 90vh` (576 px) clips the content
mid-sentence — the screenshot ends on *"…so the"* — with no scroll shadow, no fade, no indicator of
any kind, and the `Got it` button roughly 250 px further down inside the scroll container. A
first-timer who does not think to scroll *inside* a dialog is looking at a wall of rules with no
visible way out, on the first screen of the product. That is the worst possible first five seconds,
and it is the "Confused First-Timer" persona's exact abandonment point.

*Evidence:* `01-help__360x640__{light,dark,cb}`, `Modal.svelte` `.modal-dialog`, `game.svelte.ts:224`.

**Decision.** In `Modal.svelte`, make the dialog a flex column with its own scrolling body, and let a
consumer opt a trailing element into a sticky footer: `.modal-dialog > :last-child` that is a
`.button--primary` gets `position: sticky; bottom: calc(var(--space-5) * -1)`, a
`background: var(--color-bg-elevated)`, a `border-top: 1px solid var(--color-border)` and matching
negative side margins, so `Got it` / `Share` is **always** on screen regardless of content length.
Add a bottom scroll-shadow on the dialog
(`background-attachment: local, local, scroll, scroll` gradient technique, or a single
`mask-image` fade) so a clipped dialog *looks* clipped. This also improves the credits modal, which
is the app's longest scroller. Keep the focus trap, Esc, backdrop `pointerdown` close, opener refocus
and `overscroll-behavior: contain` byte-for-byte.

---

**K4 · [P1] The empty board out-weighs the photograph — the "Photograph First Rule" loses to its own
scoreboard.** *Extends C5 and the Photograph First Rule with the measurement that makes it concrete.*

At 360×640 before the first guess, the measured stack is: photo frame **140 px**, empty board
**166 px** (`metrics-360x640.json`). The *empty state of the scoring surface* is 19 % larger than the
hero. Fifteen grey lozenges, each carrying both a fill **and** a 1 px border, form a solid block that
reads as content when it contains nothing. §5.14.7 item 6 makes this **worse**, not better: it gives
empty tiles `background: var(--color-surface)` *and* `border: 1px solid var(--color-border)` — i.e.
keeps both weights — and describes them as "slightly inset". Meanwhile §5.14.7 item 4 raises the stage
to only ~170 px at this viewport, so even after the pass the photo barely draws level with the empty
board.

*Evidence:* `02-play-l1__360x640__*`, `metrics-360x640.json`, `Scoreboard.svelte` `.tile`.

**Decision (this overrides §5.14.7 item 6 — see A2).** An empty tile carries **exactly one** visual
weight, not two: `background: transparent; border: 1px solid var(--color-border);` in light, and
`background: var(--color-surface); border-color: transparent;` in dark (where a hairline grid on a
near-black ground is the noisier of the two). A **filled** tile keeps its fill, matching border-color
and — per A5 — the plate treatment. The board then reads as a faint staff that fills in with play,
which is both the correct hierarchy and the correct metaphor for the "pit board" direction. Keep
`min-height: 2rem` / `1.6 rem`, `role="table"`, the per-cell hidden sentences, the live region and the
colorblind glyph markup exactly as they are.

---

**K5 · [P1] In colorblind mode the interface speaks one color for two meanings — and the brief's own
fix creates a second collision.** *Extends C3 with the downstream consequence C3 does not name.*

C3 is correct and the screenshot proves it: at `06-play-l3__360x640__cb` the two "close" tiles, the
active crop segment and the submit button are all the same blue, so a hint state and an action are
indistinguishable. §5.14.4 fixes it by pointing `--color-accent` at **ink** in colorblind mode. That
is the right call, and it introduces a second problem the brief does not follow through on: in
colorblind mode `--color-accent`, `--color-fg`, the ink-filled active crop segment, the ink `LOCKED`
chip and the focus ring all become **one value**. The focus ring then stops reading as a ring and
starts reading as a border — precisely for the keyboard-and-low-vision users colorblind mode exists to
serve. Separately, in colorblind **light** the "wrong" fill `#17171a` measures 16.5:1 against the new
`#f4f6f7` ground — dead level with the body ink itself (`#15181d`, 16.4:1) — so the tiles a player got
*wrong* are drawn at the same weight as the page's own strongest text, and louder than the tiles they
got *right* (orange, 5.2:1 against white).

*Evidence:* `06-play-l3__360x640__cb`, `09-after-win-board__360x640__cb`, §5.14.4's colorblind table,
`app.css`'s `:focus-visible` rule.

**Decision.**
1. Keep §5.14.4's accent→ink move in colorblind mode.
2. Replace the single-ring focus style with one that is visible on **any** fill in **any** theme, and
   define it once in `app.css`:
   `:focus-visible { outline: 2px solid var(--color-fg); outline-offset: 2px; box-shadow: 0 0 0 4px var(--color-bg); }`
   — an ink ring separated from the element by 2 px of page ground and haloed by 2 px more. Drop the
   `.button--primary:focus-visible { outline-color: var(--color-fg) }` special case; the halo makes
   it unnecessary in all three themes. Verify against the accent-filled submit, the ink-filled active
   crop segment, an ink `LOCKED` chip and a filled tile.
3. The colorblind "wrong" plate must **not** be the loudest object on the light screen: use
   `#2a2d33` rather than `#17171a` in colorblind light — 13.8:1 with its white label, 12.7:1 against
   the ground: still unmistakably the darkest of the three states, but now a step below the body ink
   instead of level with it. §5.14.4's dark-mode inversion to bone (`#e9ecef` / `#15181d`, fixing C4) stands as
   written — it is correct and it matches `share.ts`'s `⬜`.
4. `--tile-green-bg: #3b7d22` and the colorblind `#c2410c` stay **verbatim**:
   `e2e/colorblind.spec.ts:8-9` asserts both hex strings in light and dark and that file is not
   writable in this pass.

---

**K6 · [P2] Win and loss are the same object.** *Extends C7 with what C7's fix must additionally do.*

`08-win-result` and `13-loss-result` are structurally identical: same headline slot, same answer line,
same photo, same grey credit wall, same score sentence, same `Share` + `Photo credits` pair. Only two
text strings differ. The peak-end rule says the *end* is half of what a player remembers about a daily
game — and here the end of a perfect run and the end of a total failure look the same. Worse, `Better
luck tomorrow` promises a tomorrow the modal never delivers: the countdown exists in `StatsModal`
(computed by `msUntilNextLocalMidnight()`, `src/lib/date.ts`) and is absent from the one screen where
"tomorrow" is the message.

**Decision.** §5.14.7 item 11's composition stands. Add three differentiators, none of which touches
game logic:
- The **verdict line** takes state ink: `--tile-green-bg` for a win, `--color-muted` for a loss.
  Never `--color-danger` — red means "wrong tile" and the One Signal Rule holds here too.
- The **score plates** (per A4 below) draw the total plate filled on a win and outlined on a loss.
- **[operator-gated]** A `Next Motodle` countdown row at the foot of the modal, reusing
  `msUntilNextLocalMidnight()` and `StatsModal`'s existing `formatHMS` + 1 s interval verbatim. If
  the operator does not want a timer here, the static fallback is a single `meta`-role line and no
  interval. This is the same gate as C13's no-puzzle countdown; decide both together.

---

**K7 · [P2] Nothing on the page identifies the day, the puzzle, or the streak at stake.**
*New.*

`Motodle #N` appears in the archive modal, the credits modal and the share text — never on the game
screen. A daily game's masthead is `Motodle · #2`; ours is `Motodle` plus five unlabelled icons. The
streak, which is the entire retention mechanic, is two taps away behind a color emoji. `PRODUCT.md`
names "come back the next day for the streak" as the success condition; the interface never mentions
it.

**Decision [operator-gated — adds visible text].** Give the header a second line under the wordmark in
the `data-sm` role (`--font-numeric`, muted): `#{game.puzzle.number}` when a puzzle is loaded, and
nothing at all otherwise. It costs ~14 px, it comes from data already in the store, and it is what
turns a masthead into a *daily* masthead. This also resolves A3's wordmark-authority problem more
cheaply than making the wordmark bigger. If the operator declines the text, the wordmark keeps its
single line and A3 still applies.

---

**K8 · [P2] Five top-level header controls, two of which are settings, not actions.**
*New; §5.14.7 item 3 restyles the icons but keeps the flat row of five.*

`?`, stats, archive, theme, colorblind sit in one undifferentiated row at equal weight. Two of them
change what the player *does*, three change how the app *looks or reports*. At the working-memory
boundary (Cowan's ≤ 4) with zero grouping, and the last two are the pair that look identical.

**Decision.** No menu — a menu adds behavior and would break the frozen accessible names' direct
reachability. Group visually instead, from the global sheet: `.app-header__actions` gets a
`gap: var(--space-2)` between the first three and a wider `--space-3` plus a `1px --color-border`
vertical divider before the theme/colorblind pair, with that pair drawn one step quieter (muted
stroke at rest, `--color-fg` on hover/focus, no border at rest). Five buttons, two groups, one glance.
Keep the `max-width: 380px` 2 px-gap escape hatch and re-verify the five 44 px buttons plus the
wordmark under DejaVu Sans (the CI runner's fallback). All `aria-label`s, `title`s and the
`aria-pressed` on the colorblind toggle stay verbatim.

---

**K9 · [P2] The crop ladder reads as pagination, not as progress.** *Extends C5 / §5.14.7 item 5.*

Five 44 × 44 numbered buttons with one accent-filled cell is the universal visual signature of a
pager or a stepper form. Nothing labels it, nothing says "this is how much of the bike you have
earned", and locked segments (which are `disabled` today) are drawn nearly identically to unlocked
ones — so the difference between *available* and *not yet earned* is smaller than the difference
between *viewing* and *available*. That is exactly backwards for a progress indicator. §5.14.7 item 5
correctly moves the current segment to ink; it does not fix the ranking.

**Decision.** The visual distance between **locked** and **unlocked** must be larger than the distance
between **viewing** and **unlocked**. Concretely: *viewing* = ink fill, `--color-bg` digit;
*unlocked* = `--color-bg-elevated`, 1 px `--color-border`, `--color-fg` digit; *locked* = no fill, no
border, `--color-muted` digit at reduced weight. Digits take `--font-numeric` + `tabular-nums`.
**All five segments keep `min 44 × 44` — `e2e/mobile-layout.spec.ts` measures every one of them, width
and height** — and `.scrub__seg`, the `role="group"`, the roving arrow-key handler and every
`Crop level N of 5` label stay verbatim.

---

**K10 · [P2] The reveal shows a photograph the dialog is too small to honor, and the letterbox reads
as a rendering bug.** *Extends C7.*

The one moment the product is allowed to be about the photograph, the photograph is 432 px wide inside
a 30 rem dialog on a 1280 px screen, letterboxed inside a fixed `aspect-ratio: 4 / 3` box with
`object-fit: contain` — so a typical 3:2 Commons photo paints grey `--color-surface` bars above and
below itself. Grey bars on grey chrome look like a bug, not a mount.

**Decision.** `.result-image img`'s `aspect-ratio: 4 / 3` + `object-fit: contain` **stay** —
`ResultModal.test.ts:113` reads that exact selector and asserts the letterboxing. Change the two
things that are free: (1) the `.result-image` container's ground becomes a deliberate mount — ink at
low alpha in light, `--color-bg` in dark — so the bars read as a mat board rather than as empty
chrome; (2) at `@media (min-width: 900px)` the modal `max-width` goes to `36rem` so the reveal is the
one dialog that gets bigger on a large screen, and the photo bleeds to the dialog edges as §5.14.7
item 11 specifies. Combined with the two-column game layout (§5.14.7 item 4) this makes the desktop
experience coherent rather than a phone screenshot in a desert (C6).

---

**K11 · [P3] Stats: the empty state is eight blue zeros, and one caption breaks the grid.**
*Confirms C11; adds the day-one case.*

C11 is right about the zero-count stubs. It misses the day-one case: with `played === 0` the modal is
`0 / 0% / 0 / 0` over eight blue `0` bars — a first-time player who opens stats sees a chart of
nothing. **Constraint the fix must respect:** `StatsModal.test.ts:20` asserts *"always shows all 8
distribution buckets, zeros included"* and reads `.distribution__label` for all eight, and
`:41-42` asserts `getByText('4')` / `getByText('75')` as **exact** strings — so the eight rows must
keep rendering, and the element that carries a bucket's count must not move to a place where a count
could newly collide with a summary value.

**Decision.** Keep all eight rows and keep the count inside `.distribution__bar` exactly as today;
only the **fill** changes: zero → no fill (the `0` sits in `--color-muted` at the track's left edge,
the track still drawn in `--color-surface`); non-zero → `--color-fg` at 12 % with ink label; today's
bucket → `--tile-green-bg` / `--tile-green-fg`, the one sanctioned state-color exception.
`.distribution__label` and `.distribution__bar--highlight` keep their class names. For the caption
wrap, take §5.14.7 item 10's second option — `grid-template-columns: repeat(2, 1fr)` under 380 px —
rather than the first: shortening `Current streak` to `Streak` is a copy change and copy is frozen.

---

**K12 · [P3] The attribution at the peak moment is a raw database field.** *Extends C7.*

`Photo by uploader was User:HellbillyD at en.wikipedia · Public domain · cropped, resized, re-encoded
to WebP · Source on Commons` — four lines of muted grey directly beneath the reveal photo and directly
*above* the score. `PRODUCT.md` treats full credit as a brand commitment, and it should be; but a
Commons `author` string passed through verbatim reads as an unhandled edge case, and placing it above
the score buries the emotional payload under legal metadata.

**Decision.** Presentation only — **do not touch the strings, the fields or the links**
(`ResultModal.test.ts:79-99` asserts author text, both link names and hrefs, `credit.modified` and
`creditNote`; §5.10.3 fixes the composition). Move the whole block **below** the score row, set it in
the `meta` role at 0.75 rem above a hairline, and let it be a caption. Rewriting or truncating
`credit.author` is a **content-pipeline** decision for `tools/`, out of scope here — record it in §11
as a follow-up, not as a UI change.

---

**K13 · [P3] Eleven type sizes, and the brief adds a twelfth.** *Confirms the detector; amends A1.*

Twelve distinct `font-size` literals ship today. §5.14.3's ten-role ramp is the right answer and will
silence all ten `design-system-font-size` advisories — except that it introduces `0.8125rem` (13 px)
as a *new* step, giving three separate sizes inside the 12–14 px band (`0.75`, `0.8125`, `0.875`).

**Decision.** Collapse `section` from `0.8125rem` to `0.75rem` and let weight (700) and tracking
(`0.08em`) plus the uppercase transform carry the distinction. The sub-1 rem ramp is then exactly two
steps — `0.75` and `0.875` — which is what makes the detector go quiet and the page feel systematic.

##### 5.14.10.6 Amendments — where this critique overrides the init brief

These win over §5.14.2–§5.14.7 as written.

- **A1 — `section` role drops to 0.75 rem** (K13). Replaces §5.14.3's `0.8125 rem`.
- **A2 — Empty tiles lose one of their two weights** (K4). Replaces §5.14.7 item 6's "background
  surface *and* 1 px border". Empty is the ground; filled is the figure.
- **A3 — At most two uppercase-tracked roles ship, and they are `wordmark` and `section`.**
  §5.14.3 currently sets four surfaces in uppercase-and-tracked (wordmark, section, label, the
  `LOCKED` chip). Four is how a game turns into a monitoring dashboard — which is the standing risk
  of pairing a mono numeric voice with a petrol accent and no display face. The `label` role
  (`Make` / `Model` / `Year`) and the `LOCKED` chip stay **sentence case**, 0.75 rem, weight 600,
  muted. This also fixes a defect §5.14 did not notice: the scoreboard column heads and the form
  field labels print the same three words 14 px apart, and the brief as written gives them two
  near-identical uppercase-tracked treatments. One of them must be uppercase-tracked and the other
  must not; the board heads win it, because they are the static legend and the form labels are the
  interactive layer.
- **A4 — The score row stays one element.** §5.14.7 item 11 says to render the score "as three
  ink-on-surface plates in a row … not as a sentence." **`ResultModal.test.ts:124` asserts
  `screen.getByText(/3 × 3/)`** — a regex over a single element's text content, including the spaces
  around the `×`. Splitting the score across three sibling plates breaks that test, and
  `src/components/ResultModal.test.ts` is not in this pass's writable set. **Do this instead:** keep
  the single `<p class="result-score">` with its literal `" × "` and `" = "` text nodes intact, and
  wrap only the numerals in `--font-numeric` spans styled as inline plates
  (`background: var(--color-surface); border-radius: var(--radius-sm); padding: 0 var(--space-2)`).
  The element's `textContent` stays `3 × 3 = 9 / 15`; the composition still reads as plates. Verify
  with `npx vitest run --maxWorkers=1 src/components/ResultModal.test.ts` before going further.
- **A5 — `--shadow-plate` is defined in both themes and applied to the photo frame only.**
  §5.14.5/§5.14.7 item 6 put a 6 %-alpha 1 px shadow on filled tiles in light mode only. At tile
  scale it is invisible, it costs bytes, and "light only" makes the board a different object in dark
  mode. One element lifts: the photo frame. Define the token in both palettes.
- **A6 — The focus ring gets a halo and loses its `.button--primary` special case** (K5.2).
  Replaces `app.css`'s current two-rule focus treatment.
- **A7 — The tiebreaker, when two brief items conflict: the photograph wins.** The direction's
  personality must be carried by the image and the composition, not by the typography. If a choice
  makes the type more expressive and the photo smaller, take the photo. This is §5.14.2's Photograph
  First Rule promoted from a token rule to the arbitration rule.

##### 5.14.10.7 Persona red flags

**Jordan (Confused First-Timer).** Lands on a full-screen rules dialog whose `Got it` is invisible
below an unmarked scroll (**K3**) — abandonment point #1. If they get past it: five unlabelled icon
buttons, two of which are the same circle (**K8**); a row of five numbered buttons that look like a
form stepper (**K9**); and on their first failed submit, an error that points at the field next door
(**K2**). Nothing on screen tells them the crop opens up when they guess wrong — the mechanic that
makes the game *fun* is explained only inside the dialog they just escaped.

**Sam (Accessibility-Dependent).** Genuinely well served on the mechanics: per-cell hidden sentences,
a polite live region, glyphs in markup, 44 px targets, a 16 px input floor, one focus ring, reduced
motion honored, pinch-zoom never suppressed. Three real flags: in colorblind mode every ink surface —
accent, focus ring, active crop segment, `LOCKED` chip — collapses to one value, so the focus ring
stops reading as a ring (**K5**); the theme control never changes appearance across its three states,
so its only state indicator is a `title` tooltip that does not exist on touch; and the eleven-size
type ramp bottoms out at 10.4 px (**C9**), under the functional-text floor, on the `LOCKED` chip that
communicates a scoring state.

**Ray, 58, rides a Bonneville, plays at 6 am on a phone without reading glasses** *(project persona,
from `PRODUCT.md`'s "enthusiasts of all ages … mostly on phones … one-handed, often in the morning")*.
The bike photo — the only reason he opened the app — is 140 px tall, smaller than the empty score grid
below it (**K4**), and the licence line beside it is 11 px. The tile labels that carry his answer are
0.85 rem and ellipsized. He can complete the task; he never gets the pleasure of *looking at the
bike*, which is the product.

**Priya, streak-keeper, shares to a WhatsApp riding group** *(project persona, from `PRODUCT.md`'s
"share a spoiler-free emoji grid, and come back the next day for the streak")*. Her streak is behind
an unlabelled color emoji. When she finishes, the modal she shares from covers the grid she is
sharing (**cognitive-load: working memory**). If she closes it to look at her board and then wants the
photo again, there is no way back (**K1**). Nothing tells her when the next one lands (**K6**).

##### 5.14.10.8 Minor observations

- **The toast lands on the give-up row.** `Toast` is fixed at `bottom: max(1rem, safe-area)`; the
  give-up row's bottom edge measures 632.5 px at 360×640. `Copied to clipboard` covers it. Lift the
  toast to `bottom: max(4.5rem, …)` on short viewports, or let it sit above the footer.
- **The modal close button is the heaviest control in every dialog** — a bordered 44 px box that
  out-weighs `Got it` and `Share` and sits optically above the headline. §5.14.7 item 8 fixes the
  overlap with `padding-top`; also drop its border at rest and give it `--color-surface` on
  hover/focus, so it stops competing with the dialog's own primary. Keep the 44 px hit area and the
  `aria-label="Close"`.
- **`--color-bg` and `--color-bg-elevated` are both `#ffffff`** (C10), which is why the `.state-message`
  card, the practice bar and every modal are separated from the page by a 1.41:1 hairline and nothing
  else. §5.14.4's `#f4f6f7` / `#ffffff` split fixes all three at once.
- **The archive shows ISO dates** (`Motodle #1  2026-09-02`). A human date is a copy change and
  therefore operator-gated; the free half is setting them in `--font-numeric` + `tabular-nums` so the
  column aligns.
- **`index.html`'s favicon uses `#3b7d22`** — the *tile* green, which the One Signal Rule reserves for
  "right". §5.14.7 item 17 already calls this; note that the same hex is also hard-coded as the button
  fill in `public/404.html`, so C12 and item 17 are one edit in two files.
- **`--font-numeric` is a system **mono** stack**, and mono at 0.875 rem inside a 1 fr tile column will
  be wider than the sans it replaces. Check the year tiles and the `Guess n of 5` button label for
  new ellipsis at 320 px before calling the type work done.
- **`puzzleReason` / `catalogReason` are captured in the store and never rendered.** Not a design
  defect today (the copy is frozen and `Retry` is the right action), but worth recording: the app
  knows *why* a load failed and never says.

##### 5.14.10.9 Open questions for the operator

`critique.md` closes by putting targeted questions to the user. **Questions could not be asked: this
session exposes no `AskUserQuestion` tool and no decision-page channel (probed; no match).** They are
recorded here instead, each tied to a specific finding, so the operator can answer them in one pass.
They are the gates on the four **[operator-gated]** items above.

1. **Post-game screen (K1).** Ship rung 1 now — a `See the answer` control in the existing give-up
   row that calls `openResult()` — or leave the end-of-day screen as it is and record rung 2 for a
   later revision? *(Rung 1 is ~10 lines and one new string; it is the highest-value item in this
   critique.)*
2. **Countdowns (K6 + C13).** Both the result modal and the no-puzzle screen are missing a
   `Next Motodle` countdown that §5.1 already specifies and `StatsModal` already computes. Add both,
   add neither, or add a static line with no timer?
3. **The masthead (K7).** May the header carry `#{puzzle.number}` under the wordmark? It is the one
   thing that makes the app read as *daily*, and it is new visible text.
4. **Priority.** If the pass has to be cut short, this critique's order is: the rhythm work
   (§5.14.5 — it clears three cognitive-load failures at once), then K1–K3 (the three cheap
   correctness-of-experience defects), then K4/K5 (hierarchy and colorblind integrity), then the
   expressive layer (icons, wordmark, motion, reveal). Confirm or reorder.

##### 5.14.10.10 Gate additions

Add to §5.14.9's list:

8. `npx vitest run --maxWorkers=1 src/components/ResultModal.test.ts src/components/StatsModal.test.ts src/App.test.ts`
   **specifically**, before the full suite — these three hold the assertions most likely to be broken
   by this pass (A4's `/3 × 3/`, K11's eight-bucket and exact-string assertions, the level-1 heading
   name `Motodle` and the `Make` / `Model` combobox names).
9. Re-check the **focus ring** (A6) on: the accent-filled submit, the ink active crop segment, a
   filled tile, the `LOCKED` chip and a modal close button — in light, dark, colorblind-light and
   colorblind-dark. Eight of those sixteen combinations are new as of this pass.
10. Re-run this critique's own two measurements at 360×640: photo-frame height **vs** scoreboard
    height (K4 — the photo must no longer be the smaller of the two), and `Toast` bottom edge **vs**
    the give-up row.

#### 5.14.11 Fixer pass — blockers resolved (2026-09-03)

Four rendered-result blockers, filed against the 5.14.10 critique's own build, fixed and
re-measured against a fresh `npm run build` + `vite preview`. All four verified with the same
measurement scripts the findings cited (`wordmark.mjs`, `cta.mjs`, `measure.mjs`, `contrast.mjs`).

| # | Defect | Fix | Verified |
|---|---|---|---|
| B1 | Wordmark hard-clipped, no ellipsis, at 320px and 381-479px (the entire 390/393/412/430 modern-phone band) | `app.css`'s `.app-header h1` breakpoint moved from `max-width:380px` to `max-width:479px`; the clipped text moved into a non-flex `.app-header__text` span so `text-overflow:ellipsis` actually applies (a flex container never applies it to its own box) as a last-resort fallback; one merged compact tier (0.6875rem, 0 tracking, 0 header gap) rather than a second breakpoint, after a two-tier attempt clipped two narrow bands (341-347px, 381-383px) that `wordmark.mjs`'s own outer-`<h1>` check couldn't see (the clip was absorbed inside the new span's `overflow:hidden`) | Zero clipped widths in a per-pixel scan of the full 320-1920px range, ≥9px genuine headroom at the tightest point (320px, computed from actions-row/header geometry directly, not from the post-shrink box) |
| B2 | Sticky modal CTA not full-bleed at any width; a stray square-cornered pill above 599px | `Modal.svelte`'s `.modal-dialog > .button--primary:last-child` gets `display:flex` and `width: calc(100% + var(--space-5) * 2)` (not `width:auto` — empirically, a `<button>`'s UA widget keeps its own fit-content sizing under `width:auto` even once display is block-level; an equivalent `<div>` does not) plus bottom corner radii matching the dialog's; the now-redundant `@media (max-width:599px){width:100%}` rules in `HelpModal.svelte`/`StatsModal.svelte` removed | CTA left/right edges equal the dialog's exactly at 360/599/600/768/1024/1280 |
| B3 | 320×568 fold regressed to 590.5/568 (−22.5px) | New `@media (max-height:700px)` rules (matching GuessForm's existing short-viewport breakpoint) drop `ImageStage.svelte`'s `--stage-max-h` floor from 140px back to its pre-pass 120px and `app.css`'s `.app-header` padding-bottom to `--space-1`; `Scoreboard.svelte`'s `.scoreboard__head` padding-bottom zeroed in the same block for extra buffer. Scoped to `(max-width:899px)` alongside the height query so it can never fight the ≥900px two-column hero layout at heights that satisfy both | 320×568 → 562.6/568 (+5.4px slack); all other six contract viewports unaffected or improved (360×640 +28.5, was +20.5); zero horizontal overflow; frame heights unchanged or larger everywhere |
| B4 | Colorblind mode: `--color-accent` and `--tile-red-bg` were the same achromatic plate (1.29:1 light, 1.05:1 dark) | `tokens.css`: `--tile-red-bg` set to `#606773`, one mid-neutral value used in **both** colorblind themes (deletes the light/dark inversion special-case for this token only — `--color-accent`'s own dark-mode inversion stays, unrelated) | Tile-red vs its white text 5.70:1 (both themes, ≥4.5 required); accent vs tile-red-bg 3.12:1 light / 5.03:1 dark (≥3 required); `--tile-green-bg` untouched, still byte-identical to `e2e/colorblind.spec.ts`'s pinned value |

Also applied, all cheap and zero new copy: **#3** stats distribution empty state (`.distribution__track` background replaced with a 1px baseline — a day-one player no longer sees eight full grey plates); **#4** the `LOCKED` chip's `margin-left:auto` dropped so it sits next to its own label instead of flush against the next field's, at 360px; **#6** `.button{text-decoration:none}` (an `<a class="button">` was underlined); **#7** the disabled give-up button's `opacity:0.55` deleted (contradicted the system's own no-opacity-for-disabled rule; the rule beneath it already colors it `--color-muted` regardless of `:disabled`, so nothing is lost).

Full gate (§5.14.9) re-run after all of the above: `npm run check` 427 files/0 errors; `npx vitest run --maxWorkers=1` 916/916; `npm run build` CSS 5.79 KB / 20, JS 30.53 KB / 60, all 9 payload budgets green; `npx playwright test --workers=1` 10/10; `detect.mjs` unchanged at 7 advisory findings, 0 non-advisory. Gate items 4 (7's advisory list needs a reason each — carried in the 5.14 critique) and 7 (`/impeccable document` regenerating `DESIGN.md`, recorded in §11) remain outstanding — both outside this pass's writable set, same as the critique that filed them.

---

## 6. Content pipeline

All under `tools/`, TypeScript, run with `tsx`. Never imported by `src/`.

### 6.1 npm scripts

| Script | Command | Network | Purpose |
|---|---|:--:|---|
| `catalog` | `tsx tools/catalog.ts` | ✓ | Build `public/catalog.json` |
| `fetch` | `tsx tools/fetch.ts` | ✓ | Find candidates → `data/review/<batch>.json` |
| `prefetch` | `tsx tools/prefetch.ts` | ✓ | Cache approved candidates' originals for `schedule` (which never downloads) + write review thumbnails (added 2026-09-03) |
| `crop` | `tsx tools/crop.ts` | ✗ | Source image + params → 5 WebP levels + full |
| `schedule` | `tsx tools/schedule.ts` | ✗ | Approved candidates → `public/puzzles/**` |
| **`generate`** | `tsx tools/generate.ts` | **✗** | **crop + schedule over `fixtures/` — the offline path** |

**`npm run generate` must never touch the network.** It reads `fixtures/fixtures.json` and
`fixtures/images/*`, and writes `public/puzzles/**` and `docs/ATTRIBUTION.md`. Its output is **also
committed**, so a clean clone runs `npm run dev` without running `generate` at all.

**`npm run generate` must be IDEMPOTENT** — running it on a clean clone, where all three dates already
have puzzle files, must exit 0 and leave `git status` clean (§7.5 step 5). Concretely:

- It **copies** each fixture's `id` (§3.6) and **overwrites** `public/puzzles/**` unconditionally. It
  never asks for `--force`, and it never mints a new id for a date that already has a puzzle file.
- It **regenerates `docs/ATTRIBUTION.md` wholesale** from the current puzzle set, sorted by puzzle
  number. It never appends — appending is what made the old design produce three duplicate credit
  blocks per invocation and a guaranteed diff.
- The WebP encode is deterministic for a fixed sharp/libvips build (see the §7.5 note).

### 6.2 CLIs

```
tools/catalog.ts   --out public/catalog.json  [--brands <n>=40] [--depth 2]
                   [--cache .cache/wikimedia] [--dry-run] [--resume]
                   [--review-only]   # offline: re-render docs/CATALOG-REVIEW.md from the catalog
tools/fetch.ts     --models <id,id,…> | --models-file <path>
                   --out data/review/<batch>.json  [--per-model 20] [--min-width <MIN_SOURCE_WIDTH=2182>]
                   [--licenses pd,cc0,cc-by,cc-by-sa] [--cache .cache/wikimedia] [--dry-run]
tools/crop.ts      --in <image> --out <dir> --focus 0.5,0.5 [--source-crop x,y,w,h]
                   [--fractions 0.11,0.19,0.32,0.55,0.95] [--quality auto]
tools/schedule.ts  --review data/review/<batch>.json --start 2026-09-05 [--dry-run]
tools/generate.ts  (no args — fixtures only)
```

### 6.3 The review-and-approve loop

```
npm run fetch -- --models suzuki-gsxr750,kawasaki-ninja-zx6r
   ↓  data/review/2026-09-02-batch01.json   (every candidate `pending` or auto-`reject`)
   ↓  OPERATOR EDITS: set decision=approve, fill operator.year / focus / sourceCrop as needed
npm run schedule -- --review data/review/2026-09-02-batch01.json --start 2026-09-05
   ↓  downloads originals → tools/crop.ts → public/puzzles/img/NNNN/*.webp
   ↓  writes public/puzzles/YYYY-MM-DD.json + updates manifest.json
   ↓  regenerates docs/ATTRIBUTION.md wholesale from the resulting puzzle set
   ↓  refuses to run if ANY approved candidate has yearConfidence low/none AND operator.year is null
   ↓  refuses an approve whose source is below MIN_SOURCE_WIDTH unless operator.cropFractions
      yields a level-1 rect ≥ MIN_LEVEL1_PX (§3.4)
   ↓  needs --force ONLY to re-point a date at a DIFFERENT puzzle
```

**Id and idempotency rules — one statement, binding on `schedule` and `generate` alike:**

- `number = puzzleNumber(date)`; `id = "mtd-" + String(number).padStart(4, '0')`.
- **A date that already has `public/puzzles/<date>.json` reuses that file's `id`** and is rewritten in
  place. Re-running with the same inputs is a no-op on disk. **Ids are never regenerated**, so `id`
  survives an operator correcting a year or a model (§3.1).
- `id` is **minted** only for a date that has no puzzle file yet. For the fixtures it is not minted at
  all — it is authored in `fixtures/fixtures.json` and copied (§3.6).
- `--force` exists **only** to re-point an existing date at a *different* source photo. It is not part
  of the normal regeneration path, and `npm run generate` never passes it.
- **`docs/ATTRIBUTION.md` is regenerated wholesale**, sorted by puzzle number, on every run — never
  appended to, never hand-edited. It opens with the licence statement of §6.5.

### 6.4 Year confidence rules

Recon R2 warns the "year in title" counts conflate model year with photo/event year. The proposed
leading-token discriminator is **unvalidated**, so it is used only to *rank*, never to auto-approve
above `medium`.

**The scanned fields are exactly two: the file title (`ObjectName`) and `ImageDescription`.** Nothing
else is scanned for year tokens. In particular:

- **`DateTimeOriginal` is NOT scanned** — it is the camera's capture year and is present on virtually
  every photo, so a naive "no other 4-digit token appears anywhere" rule would demote 100 % of
  candidates to `medium`. It is recorded as **negative evidence** instead: a token equal to the
  `DateTimeOriginal` year is **discarded** from `yearCandidates`, not counted against `high`.
- **SDC `P571` is likewise negative evidence**, not a year source — recon proved it is the
  *photograph's* date (`File:1966 Triumph Bonneville T120 TT.jpg` carries `P571 = 2023-01-28`).

| Confidence | Rule | Auto-decision |
|---|---|---|
| `high` | A **leading** 4-digit token in `1885..currentYear+1` **and** the same year appears in the description, **and** no *other* distinct 4-digit token appears anywhere. | `pending` |
| `medium` | A leading 4-digit token in range, but a second distinct 4-digit token exists elsewhere (possible event/photo year), or the year appears only in the description. | `pending` |
| `low` | A 4-digit token appears only in a non-leading or date-shaped position (`2013-11-09`, `- 2016 -`), or `sourceCategory` is a family category. | **`reject`** |
| `none` | No 4-digit token in range. | **`reject`** |

Anti-patterns that force `low` (all from real recon examples): a date-shaped token (`YYYY-MM-DD`), a
token adjacent to `Bonhams`/`Salon`/`Show`/`Days`/`Wiki Loves`/`Pride`/`Parade`/`AutoShow`, and a
trailing token following a hyphen-separated event name. **The operator rescues a `low` candidate by
setting `operator.year`,** which stamps `yearEvidence.confidence = "operator"`.

### 6.5 Licence allowlist — matched against the strings recon actually observed

**Allow** (prefix/regex, so jurisdiction suffixes like `CC BY-SA 2.0 de` pass):

| Pattern on `LicenseShortName` | `license.id` |
|---|---|
| `^Public domain$` | `PD` |
| `^CC0` | `CC0` |
| `^CC BY (\d\.\d)(\s\w+)?$` | `CC-BY-<v>` |
| `^CC BY-SA (\d\.\d)(\s\w+)?$` | `CC-BY-SA-<v>` |

The optional trailing group is the **jurisdiction** (`CC BY-SA 2.0 de`). It is dropped from
`license.id` but **kept verbatim** in `credit.license.jurisdiction`, and `credit.license.name` /
`credit.license.url` are copied verbatim from `LicenseShortName` / `LicenseUrl` — so a ported licence
never links the unported deed (§3.1).

**Deny — explicitly, by name:** `GFDL 1.2`, any string containing `GFDL` or `GNU Free Documentation`,
`Copyrighted free use`, empty/absent, and anything not matching an allow pattern. Recon found 3
GFDL-1.2-only files in a 269-file sample (~1 %) that a naive "contains a known licence name"
allowlist would pass.

**Mechanics, all verified pitfalls:**
- **Read SDC `P275` via `wbgetentities`, not just `extmetadata`.** `extmetadata` collapses dual
  licensing (proven: `M142102925` has `P275 = [GFDL-1.2+, CC BY-SA 3.0]` but reports only CC BY-SA 3.0).
  A file is allowed only if **every** `P275` value is on the allowlist **or** at least one is and none
  is a *sole* GFDL. Practical rule: allow if `∃` an allowed `P275` value; deny if the **only** value is
  `Q26921686` (GFDL 1.2) or `Q50829104` (GFDL 1.2+).
- **Never gate on `extmetadata.Copyrighted`.** CC0 files report `Copyrighted = 'True'`.
- `AttributionRequired` is reliable, but is **advisory only** in this project — we always credit (R12).
- `Restrictions` containing `personality` ⇒ auto-reject (identifiable people).
- `Attribution` was empty on every sampled file; the usable credit is `Artist` (**HTML — strip tags**)
  plus `Credit`.

**Licence Q-ids for the SDC check** — the map must cover every licence the `LicenseShortName`
allowlist admits, or the two gates disagree. Recon's 269-file census found CC BY-SA 2.0 (23),
CC BY 3.0 (10), CC BY 2.5 (4), CC BY-SA 2.5 (2) and CC BY 4.0 (1) with no Q-id in the original list —
~15 % of otherwise-allowed files:

| Licence | Q-id |
|---|---|
| CC0 | `Q6938433` |
| PD, by copyright holder | `Q98592850` |
| PD dedication (`P6216`) | `Q88088423` |
| copyrighted (`P6216`) | `Q50423863` |
| CC BY 2.0 | `Q19125117` |
| CC BY 2.5 | `Q18810333` |
| CC BY 3.0 | `Q14947546` |
| CC BY 4.0 | `Q20007257` |
| CC BY-SA 2.0 | `Q19068220` |
| CC BY-SA 2.5 | `Q19113751` |
| CC BY-SA 3.0 | `Q14946043` |
| CC BY-SA 4.0 | `Q18199165` |
| **GFDL 1.2 (deny)** | `Q26921686` |
| **GFDL 1.2+ (deny)** | `Q50829104` |

**Precedence between the two gates — stated once:** **`P275` is authoritative for *denial* only.**
A file whose *sole* `P275` value is a GFDL Q-id is rejected outright, whatever `extmetadata` says
(that is the dual-licence collapse recon proved). But an **unrecognised** `P275` Q-id is **not** a
rejection: the fetcher emits a `unknown-p275` warning and leaves `decision: "pending"`, so the
operator sees the gap instead of losing candidates invisibly.

### 6.5a Derivative works and share-alike — what the repo must state

Every level WebP and every full reveal is a **crop, a resize and a re-encode** of the source photo
(§4.7). Those are **derivative works**, and the brief requires the position to be written down:

1. **A derivative carries its source's licence.** The crops of a CC BY-SA 4.0 photo are distributed
   under CC BY-SA 4.0; the crops of a CC BY-SA 2.0 photo under CC BY-SA 2.0; PD and CC0 sources carry
   no obligation. Per-file, per-version — there is no single project-wide image licence, which is why
   `credit.license` is stored per puzzle.
2. **The modification must be indicated** (CC BY 4.0 §3(a)(1)(B) and the BY-SA equivalents). The
   `credit.modified` field (§3.1) carries that indication — `"cropped, resized, re-encoded to WebP"` —
   and the ResultModal renders it beside the licence link for **every** puzzle, PD included.
3. **The repo's own licence does not extend to the images.** `docs/ATTRIBUTION.md` and `README.md`
   both carry the same paragraph, verbatim:

   > The images under `fixtures/images/` and `public/puzzles/img/` are **not** covered by this
   > repository's code licence. Each is a cropped, resized, WebP-re-encoded derivative of a Wikimedia
   > Commons photograph and is distributed under **that photograph's own licence**, named per puzzle
   > in `docs/ATTRIBUTION.md` and shown in the game's result screen. Where the source is CC BY-SA, the
   > derivative is offered under the **same CC BY-SA version**; reusers inherit that share-alike
   > obligation.

4. Today all three committed fixtures are Public domain (§6.9), so nothing in the current repo is
   share-alike — but §6.5 admits CC BY/BY-SA for real puzzles, so the statement ships **now**, not
   when the first BY-SA photo lands.

### 6.6 The `NO_LEGIBLE_YEAR` curation rule

Confirmed by inspecting the fixture images during planning:

- **Brand and model badging on the bodywork is acceptable.** The GSX-R750 fixture has `SUZUKI` in
  200 px letters on the fairing and `750` on the tail; the 916 has `DUCATI 916` painted on the flank.
  This is inherent to motorbikes and is exactly the signal a player is meant to read — Cardle has the
  same property with car badges.
- **Legible YEAR text is a hard reject or a mandatory `sourceCrop`.** Museum placards, dated event
  signage, registration plates with a year, dated race boards. The 916 fixture's museum placard reads
  "1995 DUCATI 916" and **must** be cropped out via `sourceCrop`.
- Every `schedule`/`generate` run's DoD includes **eyeballing `l4.webp` and `l5.webp`** for legible
  year text.

### 6.7 Wikimedia API recipes (from recon — use verbatim)

Base `https://commons.wikimedia.org/w/api.php`, `https://www.wikidata.org/w/api.php`.
**Always append `&format=json&formatversion=2&maxlag=5`.**

| Purpose | Recipe |
|---|---|
| Resolve up to 50 categories at once (existence, file count, Wikidata Q-id) | `action=query&prop=categoryinfo\|pageprops&redirects=1&titles=Category:A\|Category:B…` |
| Subcategories | `action=query&list=categorymembers&cmtitle=…&cmtype=subcat&cmlimit=500` |
| Files + licence + thumb in one call | `action=query&generator=categorymembers&gcmtitle=…&gcmtype=file&gcmlimit=20&prop=imageinfo\|categories&cllimit=50&iiprop=extmetadata\|url\|size\|mime\|timestamp&iiurlwidth=800&iiextmetadatafilter=LicenseShortName\|License\|UsageTerms\|Artist\|Credit\|Attribution\|AttributionRequired\|Copyrighted\|Restrictions\|ImageDescription\|DateTimeOriginal\|ObjectName\|LicenseUrl` |
| **Two independent walks in one call** (halves cost) | a `generator=*` (`gcm*`) and a `list=*` (`cm*`) coexist in one query |
| Structured Data, 50 M-ids per call | `action=wbgetentities&ids=M123\|M456&props=claims` (M-id = `"M" + pageid`) |
| Wikidata model items | `action=wbgetentities&ids=Q…&props=labels\|claims&languages=en` |
| Wikidata catalog | `action=query&list=search&srnamespace=0&srlimit=50&srsearch=haswbstatement:P31=Q23866334` — **and also `P31=Q71310524`** (model *series*; Gold Wing and Sportster are classified there and would otherwise be silently missed) |

**Negative recipes — verified to return 0, do not use:** `incategory:"A" OR incategory:"B"`,
`incategory:"A"\|"B"`. **Exactly one `incategory:` per query.**
`Category:Motorcycles by manufacturer` does not exist — the root is `Category:Motorcycles by brand`.

**Thumbnails — the HTTP 400 trap:** arbitrary widths are rejected
(`Error: 400, Use thumbnail sizes listed on…`), and `iiurlwidth=800` silently snaps to 960.
**Request `iiurlwidth=<n>` and then use the returned `thumburl` verbatim**, stripping the appended
`utm_*` query string. Never construct a width. For the *original* (what `crop` needs), use the
`imageinfo.url` field.

**Gotchas to encode:** `gcmsort=sortkey` returns oldest-uploads-first (biases the licence mix toward
CC BY 2.0/PD-self); use `gcmsort=timestamp&gcmdir=desc` for recent, high-resolution uploads.
Mixed `gcmtype=file|subcat` crowds out subcats — fetch subcats separately.
Soft-redirect categories (0 files, 0 subcats, no `wikibase_item` — e.g. `Category:Kawasaki ZX-6R`)
must be detected and skipped; confirm with `prop=templates` for `Template:Category redirect`.
Wikidata `pageprops.wikibase_item` is **not** guaranteed to be the topic item — check `P31` for
`Q4167836` (Wikimedia category) and follow `P301`. Normalize manufacturers (two different Q-ids both
return as "BMW").

### 6.8 Etiquette, rate limiting, caching — `tools/lib/wikimedia.ts`

- **User-Agent (required on every request, api and upload hosts alike):**

  ```
  motodle/0.1 (https://playmotodle.com; homelab hobby project) node-fetch
  ```

  Assembled in `tools/lib/wikimedia.ts` from `MOTODLE_UA_CONTACT`, which **defaults to the contact URL
  above** (operator decision D5, amended 2026-09-02 from the GitHub repo URL to `https://playmotodle.com`
  — the repo is private, so a Wikimedia operator following it would get a 404, which the UA policy treats
  as worse than no URL) and may be overridden by the environment to another **real** repo or
  contact URL. `DEFAULT_UA_CONTACT` in `tools/lib/wikimedia.ts` is the single source of the string; the
  literal copies in `tools/fetch.test.ts`, `tools/schedule.test.ts` and `schema/validate.test.ts` are
  updated with it, and the fail-fast checks plus the "no `@` anywhere in the UA" test are unchanged and
  still pass. **Fail fast at startup** — before any request — if the assembled UA is empty or still
  contains `<` or `>`: a literal `<owner>` placeholder yields a 404 contact URL, which under
  Wikimedia's UA policy is worse than no URL at all. **No email address is used anywhere** (D5).
  Document the variable in the README beside `npm run catalog` / `npm run fetch`.
- `maxlag=5` on every API call; on a `maxlag` error, sleep the returned lag and retry (max 5).
- `Accept-Encoding: gzip` (responses were 4 KB–254 KB gzipped).
- **Serial requests only — no parallelism**, plus a **200 ms** inter-request delay and a token bucket
  capped at **5 req/s**. Recon issued 36 back-to-back calls with zero 429/503 but explicitly warns
  (R22) that this is not evidence a 1,000-call walk will be tolerated.
- **No rate-limit headers exist** (`Retry-After`, `X-RateLimit-*` all absent). Back off on
  `429`/`503`/`5xx` with exponential delay (1 s → 30 s, 5 attempts) regardless.
- **Read-only. The client has no write path at all** — no `action=edit`, no tokens, no login.
- **On-disk response cache** at `.cache/wikimedia/<sha256(url)>.json` with a 7-day TTL and the URL
  stored alongside for auditing. `api.php` responses are `x-cache: … pass` (never edge-cached), so
  client-side caching is the only caching there is. `--resume` re-reads the cache and skips
  already-fetched pages, making a 1,000-call walk restartable.
- Every request URL is appended to `.cache/wikimedia/urls.log` for auditing.

### 6.9 The fixture set

**Three PD fixtures, committed** (see C2). All three are Public domain — no CC BY/BY-SA in the repo,
so there is no share-alike or attribution obligation attached to a git clone. Credit is shown anyway.

| # | Date | Answer | Commons file | M-id | Source | Licence | Year evidence | Params |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-09-02 | 2004 Suzuki GSX-R750 | `File:2004 Suzuki GSXR-750 Left SIde.jpg` | M12193306 | 800×600 | PD (`PD-user`), `P275=Q98592850` | **high** — leading `2004` in title, repeated in description | `focus {0.30,0.68}`, `cropFractions [0.30,0.41,0.55,0.74,1.00]` (r = 1.351; C4 — 800 px source, so `f1` cannot go below `240/800 = 0.30`; level 1 = 240 px ≥ 240 ✓). **The focus moved in revision 9** (§4.7a): at `{0.52,0.55}` the tightest crop this source allows *still* frames the SUZUKI wordmark. `{0.30,0.68}` puts level 1 on the exhaust can, rear wheel and rearsets and defers the wordmark to level 4; the accepted cost is that levels 3–4 now reach the frame's left edge and show the cardboard boxes the old focus avoided. |
| 2 | 2026-09-03 | 2002 Kawasaki Ninja ZX-6R | `File:2002 kawasaki zx-6r.jpg` | M3111849 | 960×720 | PD (`PD-user`) | **high** — leading `2002` in title, description "2002 Kawasaki ZX-6R, U.S. model" | `focus {0.5,0.55}`, `cropFractions [0.25,0.35,0.49,0.69,0.96]` (r = 1.400; level 1 = 240 px ≥ 240 ✓; 960 px source is below `MIN_SOURCE_WIDTH`). Rendered and inspected in revision 9: level 1 is engine case + frame + fairing edge with no badging, level 2 adds the ZX-R decal, level 3 the Kawasaki wordmark — the cleanest ladder of the three. |
| 3 | 2026-09-04 | 1995 Ducati 916 | `File:Ducati 916.JPG` | M4303996 | 2048×1536 | PD (`PD-self`), `P275=Q98592850` | **medium→operator** — description "1995 Ducati 916, National Motor Museum in Beaulieu"; on-image placard reads "1995 DUCATI 916" | **`sourceCrop` mandatory** — see the computed block below. `creditNote` = the author's prose credit request (see below). |

**Fixture 3 geometry, computed with §4.7 — use these numbers, do not re-derive by eye:**

| | Value | Why |
|---|---|---|
| `sourceCrop` | `{ "x": 0.08, "y": 0.02, "w": 0.71, "h": 0.72 }` | x ends at 0.79 → drops the blue Yamaha at the right edge. y ends at 0.74 → drops the placard, whose year line sits at y ≈ 0.75–0.79. |
| cropped size | 1454 × 1106 (aspect 1.315) | 0.71·2048 × 0.72·1536 |
| base 4:3 rect | **1454 × 1091** | crop is narrower than 4:3, so `bw0 = W`; `bh0 = Math.round(1454 / (4/3)) = Math.round(1090.5) = ` **1091** — JS rounds .5 up. Use 1091; do not write 1090. |
| min first fraction | **0.1651** (= 240 / 1454) | anything below fails `MIN_LEVEL1_PX`; the smallest two-decimal fraction that clears it is **0.17** |
| `cropFractions` | `[0.17, 0.26, 0.40, 0.62, 0.96]` (r = 1.542) | level **rects** 247·185, 378·284, 582·437, 901·676, 1396·1047 — `rect.w` strictly increasing ✓, level 1 = 247 px ≥ 240 ✓, geometric ✓ (§4.7a) |
| output widths (`levels[].w`) | 247, 378, 582, **900, 900** | `min(CROP_TARGET_WIDTH, rect.w)`, never upscaled. **Levels 4 and 5 legitimately tie** — both rects exceed 900. This is why `levels[].w` is *non-decreasing* and the strictly-increasing invariant belongs to `levels[].rect.w` (§3.1, §4.7, §7.2 #8). **The tie now hangs on one pixel** — `0.62 × 1454 = 901.48 → 901` — which is deterministic, but if a future `sourceCrop` tweak pushes level 4 under 900 the fix is `f4 = 0.63` (rect 916), not deleting the tie from the contract (§4.7a). |
| `full` | width `min(1400, 1454) = 1400`, height 1065 (aspect 1.315, **not** 4:3) | encoded from the **source-cropped** image, so the placard stays gone; `ResultModal` letterboxes it (§3.1) |
| `focus` | `{ "x": 0.56, "y": 0.55 }` | fractions **of the cropped image**; centres on the bike's mass |

**The crop deliberately cuts the bottom edge of both wheels.** That is unavoidable: the rear wheel's
bottom (~y 0.77) is *below* the placard's top (~y 0.745) and they overlap in x, so no rectangle
contains both wheels' bottoms and excludes the year. Losing a sliver of tyre is the correct trade for
a dev fixture — a puzzle that prints its own answer is worthless.

**Fixture 3's `creditNote`** is non-null and must be rendered verbatim: the `Artist` string explicitly
asks to be credited as *"Przemysław Jahr / Wikimedia Commons"* despite `AttributionRequired = 'false'`.
This is the concrete case that justifies always showing credit.

**The three fixtures' frozen identity fields** (authored in `fixtures/fixtures.json`, copied verbatim
into the puzzle JSON — §3.6):

| Date | `id` | `answer.makeId` / `make` | `answer.modelId` / `model` | `acceptModelIds` | `year` |
|---|---|---|---|---|---|
| 2026-09-02 | `mtd-0001` | `suzuki` / Suzuki | `suzuki-gsxr750` / `GSX-R750` | `["suzuki-gsxr750"]` | 2004 |
| 2026-09-03 | `mtd-0002` | `kawasaki` / Kawasaki | `kawasaki-ninja-zx6r` / `Ninja ZX-6R` | `["kawasaki-ninja-zx6r"]` | 2002 |
| 2026-09-04 | `mtd-0003` | `ducati` / Ducati | `ducati-916` / `916` | `["ducati-916"]` | 1995 |

Every id above is `normalizeId(make + " " + model)` under §3.2's frozen function — check them against
the vector table before typing them. The seed catalog must carry all three makes with a `country`
(`JP`, `JP`, `IT`) and all three models with a `years` range, since §7.2 #3 resolves every one of these
ids against `catalog.json`.

**How they get into the repo:** the operator (or the fixture workstream, with network access) downloads
each `imageinfo.url` **original** once, commits it under `fixtures/images/`, and hand-authors
`fixtures/fixtures.json` with the `id`, credit and yearEvidence blocks transcribed from these tables.
`npm run generate` then produces `public/puzzles/**`, which is **also committed**. Total committed
image weight ≈ 1.9 MB of source JPEG + ~450 KB of generated WebP.

**Explicitly rejected as fixtures**, with reasons recorded so nobody re-adds them:

| Candidate | Reason |
|---|---|
| `Blue Honda 750 Four.JPG` (CC0) | Year evidence "NONE explicit" — fails the brief's own low-confidence rule (C2). |
| `Blue Moto Guzzi 850 Le Mans pic1.JPG` (CC0) | "WEAKEST year evidence of the five" (C2). |
| `Honda Japauto 950 Bol dOr (1972).jpg` (CC0) | **Wrong answer** — a Japauto 950 coachbuilt endurance racer, not a CB750. |
| `Honda CR 750 Daytona (1972).jpg` (CC0) | Same — a race version, not the road model. |
| `Kawasaki ZX-6R 636.JPG` (PD) | Weak provenance: "no machine-readable author", "Assumed own work". |

### 6.10 Seed catalog

`public/catalog.json` ships hand-authored (C7), and it is **not just typeahead filler any more** — its
`country` and `years` fields decide two of the three tile colours (§4.2), so authoring them is a
first-class task, not a nicety.

**Target size: 40–60 makes and 300–500 models**, covering the well-known bikes of **every decade since
1950** — the 50s/60s British twins and Japanese two-strokes, the 70s UJMs and superbikes, the 80s
race-replicas, the 90s sportbikes, the 2000s litre-bikes, and the modern adventure/naked era. Start
from the ~12 manufacturers recon resolved (Honda, Kawasaki, Triumph, Ducati, BMW, Harley-Davidson,
Yamaha, Suzuki, Royal Enfield, KTM, Moto Guzzi, Aprilia) and extend outward (Norton, BSA, MV Agusta,
Benelli, Bimota, Husqvarna, Indian, Victory, Buell, Jawa, ČZ, CFMoto, Kymco, Hyosung, Bajaj, TVS,
Hero, Derbi, Gas Gas, Beta, Sherco, Zero, Vespa/Piaggio, Laverda, Cagiva, Bultaco, Montesa, Ossa,
Ariel, Vincent, Matchless, Velocette, Sunbeam, Zündapp, NSU, DKW, Maico, Puch, MZ, Ural, Dnepr …).
Include every recon-verified model and all three fixture answers. `source: "seed"`.

**`country` and `years` are HAND-AUTHORED by the implementing agent from general knowledge.** Recon
proved Wikidata carries almost no production dates and Commons carries none, so there is nothing to
scrape. The standard is explicit:

- `makes[].country` — ISO 3166-1 alpha-2, uppercase, the make's country of origin. **Required on
  every make; there is no "unknown".** If a make's origin is genuinely contested, pick the one a
  player would name and move on.
- `models[].years` — **approximate to ±1 year is acceptable for a hint. When unsure, write `null`.**
  A wrong range produces a misleading yellow tile; `null` produces an honest red one, so `null` is
  always the safe answer. `[from, null]` for anything still on sale.
- A **contract test enforces the shape, not the facts** (§7.2 #11–#12): every make has a valid
  two-letter uppercase country present in `COUNTRY_NAMES`; every non-null range satisfies
  `1885 ≤ from ≤ to ≤ currentYear + 1`.
- **`docs/CATALOG-REVIEW.md`** is a generated markdown table — `make | country | model | years |
  source` — rendered from `public/catalog.json` by `npm run catalog -- --review-only` (offline,
  regenerated wholesale like ATTRIBUTION.md, never appended). It exists so the operator can skim every
  hand-authored country and range in one place and correct them later; corrections are made **in
  `public/catalog.json` itself**, which is the source of truth, and the review file is re-rendered.

`npm run catalog` later regenerates the catalog from Commons/Wikidata but **preserves every
hand-authored `country` and `years`** by id (§3.2). **`KTM 990 Adventure` is deliberately absent**
(C9). Per D4 the catalog carries both variant families and their depth-2 variants
(`Ducati Monster` *and* `Ducati Monster 900`), which is part of why the seed is 300–500 models rather
than 250.

---

## 7. Test plan

### 7.1 vitest unit tests — `src/lib/**/*.test.ts`

| File | Tests |
|---|---|
| `date.test.ts` | `todayKey` uses local components (not `toISOString`); `puzzleNumber('2026-09-02')===1`, `…09-03===2`, `…09-01===0`; **DST-crossing spans exactly N days** (2026-11-02 → 62). **Node cannot flip `TZ` reliably mid-run**, so this runs as two separate processes via a script: `TZ=America/Los_Angeles vitest run src/lib/date.test.ts && TZ=Australia/Lord_Howe vitest run src/lib/date.test.ts` (the latter is a 30-minute offset), wired as `"test:tz"` and called from `npm test` (§10.2); next-local-midnight computation. Anything that reads "now" pins it with **`vi.setSystemTime(new Date('2026-09-02T12:00:00'))`** in a `beforeEach`, with `vi.useRealTimers()` after — no unit test may depend on the day it runs |
| `game.test.ts` | **`evaluateGuess()` is the only entry point** — no test re-implements a tile rule. Make/model id comparison; **RULE A: same make → green; different make same `country` → yellow; different country → red** (§4.2 table as a `test.each`); **RULE B: `acceptModelIds` hit → green; `years` containing `answer.year` → yellow, including `from` and `to` boundaries and `to: null`; one year outside each end → red; `years: null` → red, never yellow**; **RULE B reads `answer.year`, not `guess.year`** (guess CB750/1972 against a 2004 answer ⇒ model red); MODEL green ⇒ MAKE green; a yellow MODEL with each of green/yellow/red MAKE; unknown make or model id throws; **year bands at 0/2/3/10/11 both directions** (§4.2 table, as a `test.each`); locking after each green; **yellow locks nothing on any tile**; a locked category re-scores green; `acceptModelIds` equivalence; duplicate guesses are accepted and cost a guess; give-up at each guess 1–5 appends no row; loss at guess 5; win at each guess 1–5; guess 6 is rejected |
| `score.test.ts` | every row of the §4.3 achievable-score table; **the achievable set is exactly `{0,1,2,3,6,9,12,15}`** (exhaustive over all reachable states); a loss can never score > 2 |
| `share.test.ts` | tests `buildShareText()` only (pure, §4.4). The §4.4 win-on-guess-2 string **byte-for-byte**; the loss string byte-for-byte; the **give-up-during-guess-3 string with exactly 2 rows**; the **give-up-during-guess-1 string — header, one blank line, URL, no empty grid**; **no trailing newline** on any of them; practice prefix; colourblind glyph swap incl. **`⬜` for red**; a row with yellow on all three tiles; header number formatting. The expected strings compose `SITE_URL` **imported from `src/config.ts`** — never the literal domain |
| `match.test.ts` | `trium bonn` → Triumph Bonneville T120 (tier 1); `gs` → GSX-R750 (tier 3); exact beats prefix beats substring; ≤10 results; diacritics (`ČZ`, `Motorräder`); **all 12 frozen `normalizeId` vectors of §3.2, as a `test.each`**; `harley davidson` and `harley-davidson` match; empty query returns []; incremental narrowing agrees with a fresh scan; **locked-make filtering: with the make locked to `suzuki`, `suz gsx` → GSX-R750 (make tokens stay searchable) and `honda` → `[]`** (§5.3) |
| `storage.test.ts` | round-trip; **keys carry no version segment** (`motodle:stats`, not `motodle:v1:stats`); a v1 payload written at `motodle:stats` is found and migrated by v2 code — `MIGRATIONS[v]` runs v→v+1 in ascending order and `motodle:schema` is rewritten only after a full successful pass; a **newer** stored version returns the fallback and **does not delete** the raw value; corrupt JSON returns the fallback; a throwing backend (private mode) degrades to memory; cross-tab `subscribe` fires; **practice records prune to 30, oldest evicted first** |
| `stats.test.ts` | streak +1 when `dayIndex(puzzle.date) − dayIndex(lastWinDate) === 1`; reset to 1 on a gap; 0 on a loss and on a give-up, with `lastWinDate` **left untouched**; `lastWinDate`/`lastCompletedDate` are always the **puzzle's** date; **"complete yesterday's puzzle after local midnight" keys the streak to the puzzle date, not the wall clock** (pin the clock with `vi.setSystemTime`); **the update is a no-op when `lastCompletedDate === puzzle.date`** — replaying a completion twice leaves `played`, the streak and the distribution unchanged; `maxStreak` monotone; abandoned day counts nothing; distribution buckets |
| `catalog.test.ts` | index build; **`makes.get(id).country` and `models.get(id).years` are reachable from the index** — `evaluateGuess` depends on both; locked-make filtering returns only that make; unknown id rejected |
| `puzzle.test.ts` | 404 → `NoPuzzle` (not an error); 500 → `LoadFailed`; schema mismatch → `LoadFailed`; relative `src` resolves against `PUZZLE_BASE_URL` |

**Tool unit tests — `tools/**/*.test.ts` (W2, and `crop.test.ts` with W1's `tools/crop.ts`).** These
are named here because §10.3's `test.include` **must** list `tools/**/*.test.ts` for them to run at
all; W2's DoD depends on them and `tools/` is W2's exclusive file set, so they cannot live in `src/`.

| File | Tests |
|---|---|
| `tools/lib/normalize.test.ts` | all 12 frozen `normalizeId` vectors (§3.2) — the same table `match.test.ts` uses |
| `tools/lib/licence.test.ts` | all 13 observed `LicenseShortName` strings; the GFDL-1.2-only reject; the dual-licence case (`M142102925`); a jurisdiction suffix (`CC BY-SA 2.0 de`) keeps `jurisdiction: "de"` and its own `LicenseUrl`; an unrecognised `P275` Q-id ⇒ `unknown-p275` warning + `pending`, **not** a reject |
| `tools/lib/year.test.ts` | the four confidence tiers; date-shaped and event-adjacent tokens force `low`; a token equal to `DateTimeOriginal`'s year is **discarded**, not counted (§6.4) |
| `tools/crop.test.ts` | too-small source errors; non-monotone `rect.w` errors; `levels[].w` may tie at `CROP_TARGET_WIDTH` without erroring; the §4.7 clamp cases (0.95/0.95, 0.02/0.02, oversize fraction) stay in bounds; the full reveal is encoded from the **source-cropped** image |
| `tools/generate.test.ts` | the offline import-graph assertion (§7.2 #14) |

### 7.2 Contract tests — `schema/*.test.ts` (the cross-agent safety net)

These are the tests that catch two agents disagreeing:

1. Every file in `public/puzzles/*.json` validates against `puzzle.schema.json`.
2. `public/catalog.json` validates against `catalog.schema.json`; all `models[].makeId` resolve.
3. **Every `answer.modelId` and every `acceptModelIds[]` entry exists in `catalog.json`**, and its
   `makeId` matches `answer.makeId`.
4. **Every puzzle's `number === puzzleNumber(date)`**, `date` equals its filename stem, and
   **`id === "mtd-" + String(number).padStart(4,'0')`** — and the same for every `fixtures.json` entry,
   which is what proves the fixture-authored id and the generated one are the same id (§3.6).
5. `manifest.json` lists exactly the puzzle files present, ascending, and contains **no answer fields**
   (and its ids, being `mtd-NNNN`, encode no make/model/year — §3.3).
6. Every puzzle's `yearEvidence.confidence !== 'low'` and `approvedBy === 'operator'`.
7. Every puzzle's `credit.license.id` is on the allowlist; `author` is non-empty; **`credit.modified`
   is non-empty** (the §6.5a indication of modification).
8. `cropFractions` are strictly increasing and in `(0,1]`; **`levels[].rect.w` strictly increases**;
   **`levels[].w` is non-decreasing** (two levels tie once both rects exceed `CROP_TARGET_WIDTH` —
   fixture 3 does, §6.9); `levels[].w/h` are 4:3 ±1 px and `image.full` is exempt from that.
9. Budgets: per-day JSON + 5 WebPs ≤ `DAY_BUDGET_BYTES`; catalog gz ≤ `CATALOG_GZ_BUDGET_BYTES`.
10. `tools/lib/normalize.ts` and `src/lib/match.ts` produce **identical** ids for the §3.2 frozen
    vector list plus every make and model name in `catalog.json` (they must not drift).
11. **Every `makes[].country` is two uppercase A–Z characters and has an entry in `COUNTRY_NAMES`**
    (§4.7). No `"??"`, no missing field. RULE A reads this on every single guess.
12. **Every non-null `models[].years` satisfies `1885 ≤ from ≤ to ≤ currentYear + 1`**, where a `null`
    `to` is read as `currentYear + 1`. `years: null` is always legal. RULE B reads this.
13. **`schema/validate.ts` self-test**: each of the five JSON Schemas uses only the supported keyword
    subset (§7.2a), so "validates against the schema" never silently means "validated the parts we
    implemented".
14. **`tools/generate.ts` is offline by construction**: a static test walks its transitive import graph
    and asserts it contains no `tools/lib/wikimedia.ts` and no `fetch` / `node:https` / `node:http` /
    `undici` reference. A clean-clone run cannot prove the absence of network by observation, so it is
    proved by the import graph instead (§7.5 step 5).
15. **`cropFractions` is geometric** (§4.7a): for every puzzle file *and* for
    `DEFAULT_CROP_FRACTIONS`, each `f[i]/f[i-1]` is within **±3 %** of `(f[4]/f[0])^(1/4)`. Strictly
    increasing (#8) is not enough — it permits exactly the front-loaded, hand-typed ladder revision 9
    removed, and this is the only check that stops the next override from silently reverting it.

**7.2a — `schema/validate.ts`'s supported keyword subset.** It is a *tiny dependency-free* validator,
so its capability is stated rather than assumed. Supported: `type`, `required`, `properties`,
`additionalProperties`, `items`, `enum`, `const`, `pattern`, `minimum`/`maximum`,
`minItems`/`maxItems`, and `$ref` to a `$defs` entry in the same file. **The five schemas must not use
anything outside this list**, and test #13 enforces that by walking each schema document.

**Do not test WebP byte-identity** — output varies across sharp/libvips builds. Test dimensions,
budget, monotonicity and schema validity instead.

### 7.3 Component tests — `src/components/**/*.test.ts` (vitest + jsdom + @testing-library/svelte)

`svelteTesting()` from `@testing-library/svelte/vite` is **mandatory** in the plugin list — the probe
proved that without it `mount()` throws `lifecycle_function_unavailable`.

| Component | Tests |
|---|---|
| `GuessForm` | `#mtd-make` carries the `"Choose a make…"` placeholder first and then **every** catalog make, alphabetical by display name, `option.value` = make id; `#mtd-model` is `disabled` with `"Choose a make first"` until a make is chosen; choosing a make fills `#mtd-model` with **exactly that make's models — all of them, families and depth-2 variants, no year filtering**, alphabetical, option text = model name with the make **not** repeated, and no other make's model present; **changing the make resets `#mtd-model` to the placeholder**; a complete make+model+year submit calls `onsubmit` **once** with `{makeId, modelId, make, model, year}`; **submit with nothing chosen is never silently dead** — the button is `aria-disabled="true"`, `#mtd-make` gets `aria-invalid="true"` + `aria-describedby` and the inline *"Choose a make"* renders; with a make but no model the same happens on `#mtd-model` with *"Choose a model"*; out-of-range/empty year shows the year message (all offending fields marked on the same attempt); **locked MAKE** ⇒ `#mtd-make` is `disabled` showing the locked make with the locked chip and `aria-label`, while `#mtd-model` still lists that make's models and stays enabled; **locked MODEL** ⇒ `#mtd-model` is `disabled` too, showing **the player's own chosen model** (never `answer.model`), and only `#mtd-year` is editable; a **resumed** game whose locks are already set pre-fills both selects on mount (the §5.3.6 `$effect`, not `$state(prop)`); selections survive a submitted guess and are never silently cleared; give-up shows the confirmation step and only then calls `ongiveup` |
| `YearInput` | steppers clamp at 1885 and `currentYear+1`; non-numeric blocked; disabled + pre-filled when year is locked; **revision 8 (§5.11.7)**: it sets `aria-invalid` + `aria-describedby="{id}-error"` when `invalid`, but no longer renders the message element — the parent does |
| `Scoreboard` | 5×3 tiles; colours match results, **including yellow in the make and model columns** (RULES A and B); colourblind glyphs present |
| `ImageStage` | level N shown during guess N; scrub back allowed, forward disabled; **all 5 levels unlock once `status !== 'in_progress'`**; `viewLevel` persists; full reveal is **not requested** before game end; **the in-play licence line (§5.10.1)**: `#mtd-photo-licence` renders exactly `Photo: ` + `credit.license.name` and its `href` is `credit.license.url` (assert with a jurisdiction-suffixed fixture, `CC BY-SA 2.0 de`, so nobody re-derives the label from `license.id`); and the **spoiler assertion** — `container.innerHTML` (attributes included, so a `title=`/`aria-label=` leak is caught too) contains **none of** `credit.author`, `credit.fileTitle`, `credit.descriptionUrl`, `credit.creditNote`; a PD fixture renders `Photo: Public domain`, still linked |
| `ResultModal` | attribution renders (author, licence link, Commons link) **even when `attributionRequired` is false**; **`credit.modified` renders beside the licence link**; `creditNote` renders verbatim; a non-4:3 `full` image is **letterboxed, not distorted**; the `Photo credits` affordance `#mtd-credits-link-result` is present and its click closes the result modal **and** opens the credits view (both callbacks fire, never two dialogs at once — §5.10.3) |
| `StatsModal` | 8 distribution buckets always present; today's bucket highlighted; countdown format |
| `HelpModal` | auto-opens when `seenHelp` is unset; sets the flag; does not re-open |
| `CreditsModal` *(new, §5.10.4)* | with `status='ready'` and three rows, `#mtd-credits` renders three `[data-mtd-credit-row]` items **newest first**, each carrying puzzle number, date, `year make model`, `photo by <author>`, the licence name linked to `license.url`, `Source on Commons` linked to `descriptionUrl`, and `credit.modified`; a row whose `creditNote` is non-null renders it verbatim; the intro sentence renders verbatim; `rows: []` + `ready` renders `#mtd-credits-empty` and **no** `#mtd-credits`; `hasMore=false` renders no `#mtd-credits-more`, `hasMore=true` renders it labelled `Show more (N remaining)` and calls `onmore` once per click; `loadingMore=true` renders it `disabled` and labelled `Loading…`; `status='failed'` renders the failure copy + a `Retry` that calls `onretry` |

**Revision 8 changes exactly one row of this table** — `YearInput`, above. `GuessForm`'s row is
unchanged and is the regression net for the §5.3.1 DOM contract during the §5.11 layout refactor:
every assertion in it is on ids, roles, accessible names, `aria-*`, option values/text,
`getAllByText('Locked')` and the give-up copy, all of which §5.11.3 preserves.

`GuessCombobox.test.ts` is **deleted** with its component (§5.3.7). Its assertions have no analogue: a native
`<select>` needs no `aria-expanded`, no `aria-activedescendant`, no always-mounted listbox and no `pointerdown`
commit — the browser owns all of it (§5.3.5).

**`src/lib/credits.test.ts` — the spoiler filter and the batching (§5.10.4).** These are pure-function
tests and follow §7.1's rules (no DOM, `vi.setSystemTime` where a date is read), but they are listed
here because they are the safety net behind the `CreditsModal` rows above and must land with it:

- `eligibleCreditDates()` returns days **strictly before** `todayDateKey`, newest first, and **never**
  a future day — asserted against a manifest that contains tomorrow and the day after (the committed
  fixture set is exactly this shape: 2026-09-02..04).
- Today's own date is **excluded** when `todayFinished` is `false` and **included** when it is `true`
  — the same manifest, both ways, one assertion each.
- A manifest with only future days yields `[]` (the launch-day empty state).
- `nextCreditBatch()` returns at most `CREDITS_PAGE_SIZE` (20) dates, resumes at `loadedCount`, and
  returns `[]` when everything is loaded — a 365-day manifest yields 20 on open, then 20 per call,
  never 365 (this is the assertion that keeps a year of puzzles from becoming 365 fetches).
- The store-level test (`src/state/game.test.ts`) rounds it out with a stub fetch: `openCredits()`
  issues **exactly** `min(20, eligible.length)` requests, a 404 day contributes no row and no error,
  and re-opening the dialog issues **zero** further requests (the `puzzleCache`).

Async flush: prefer `await tick()` from `'svelte'`; the probe used `await new Promise(r => setTimeout(r, 0))`
and that works — the recon flagged `tick()` as idiomatic-but-untested, so the first component test to
land settles it and the rest follow that pattern.

### 7.4 Scripted playthrough — **Playwright chromium** (chosen)

The toolchain recon **proved** all three options work on this machine (bundled chromium sandbox on,
sandbox off, and `channel:'chrome'` against system Chrome 152). **Bundled chromium is chosen**:
`~/.cache/ms-playwright` (656 MB, Chrome Headless Shell 151.0.7922.34) is **already downloaded and
lives on `/` (296 GB free), not on tmpfs**, so it costs nothing now and is version-pinned and
reproducible. vitest+jsdom component tests are a **complement**, not a fallback.

#### 7.4a Clock pinning — MANDATORY, and the reason the suite survives past 2026-09-04

`LAUNCH_DATE` is 2026-09-02 and there are exactly three fixtures (09-02, 09-03, 09-04). Left on the
real clock the suite is **self-contradictory on every date**: on 09-02 the archive is empty so the
practice spec cannot run; on 09-03 "today" is the ZX-6R so the win assertions are wrong; from 09-05
the client 404s into "no puzzle today" and nothing runs at all. **Every spec therefore pins the
clock**, and none of them may read the real date:

| Layer | Mechanism |
|---|---|
| Playwright (1.62 has the Clock API — confirmed present in the installed types) | `await page.clock.install({ time: new Date('2026-09-02T12:00:00') })` **before `page.goto`** in the win / loss / give-up specs. `page.clock.runFor(...)` is used only by the rollover spec. |
| Practice spec | `await page.clock.install({ time: new Date('2026-09-05T12:00:00') })`, then navigate `?d=2026-09-02` — 09-02 is now a valid past date, **and the same spec gets the "no puzzle today" screen for 09-05 for free**. |
| vitest | `vi.setSystemTime(new Date('2026-09-02T12:00:00'))` in a `beforeEach` for anything that reads `todayKey()`; `vi.useRealTimers()` afterwards. |
| Manual runs (`npm run dev`, `npm run preview`) | **`todayOverride`** — a `src/config.ts` value that is honoured **only when `import.meta.env.DEV` is true** and is `null` in a production build. Set it (or pass `?today=YYYY-MM-DD`, same DEV-only guard) to play any fixture date by hand. Documented in the README beside the acceptance checklist. |

The dates above are **local** wall times with no timezone suffix, matching `todayKey()`'s local-date
semantics (§4.1). A `Z` suffix would put half the planet on the previous day.

`e2e/playthrough.spec.ts` drives the real build via `vite preview`. **A guess is entered by selecting
options, never by typing** (§5.3): `await page.selectOption('#mtd-make', '<makeId>')`, then
`await page.selectOption('#mtd-model', '<modelId>')`, then fill `#mtd-year` and press the submit
button. Option **values are catalog ids**, so specs address them by id and never by visible text.

1. First visit (clock pinned to **2026-09-02T12:00:00**) → HelpModal auto-opens → close.
2. Puzzle #1 loads; level 1 shown; scrub-forward disabled.
3. Guess 1 — a make from **a different country** and a model whose production range **excludes 2004**
   (`selectOption('#mtd-make', 'triumph')` then `selectOption('#mtd-model', 'triumph-bonneville-t120')`
   — `GB`, `[1959,1974]`), year 11+ off → `🟥🟥🟥`; image advances to level 2; scrub back to level 1
   works, forward to 3 does not. Before selecting the make, assert `#mtd-model` is **disabled**; after
   it, assert it is enabled, then switch `#mtd-make` to another make and assert `#mtd-model` has
   reset to `''` (the §5.3.2 cascade reset) before switching back to `triumph` and choosing the model.
4. Guess 2 correct make, **wrong model whose range excludes 2004** (`suzuki` +
   `suzuki-gt750`, `[1971,1977]` — picking a still-current Suzuki would make the model tile yellow,
   not red), year 5 off → `🟩🟥🟨`; **the MAKE select locks** — assert `#mtd-make` is `disabled` with
   value `suzuki` and the locked chip is visible, that `#mtd-model` is **still enabled**, that its
   option values include `suzuki-gsxr750` and include **no** non-Suzuki model (e.g.
   `triumph-bonneville-t120` is absent), and that it lists **more than one** Suzuki model — i.e. the
   whole make, unfiltered by year (§5.3.2).
5. Guess 3 correct model (`selectOption('#mtd-model', 'suzuki-gsxr750')`), year 2 off → all green →
   **win**, ResultModal opens. Assert both selects are now `disabled` (game over) and that `#mtd-model`
   shows the player's own choice.
6. Assert score reads **9** (3 points × multiplier 3).
7. Share → assert the clipboard text equals the expected §4.4-shaped string exactly. The spec must
   call `context.grantPermissions(['clipboard-read', 'clipboard-write'])` first; `127.0.0.1` is a
   secure context, so `navigator.clipboard.writeText` is available. Stub `navigator.share` to
   `undefined` so the clipboard branch is the one exercised.
8. Stats modal: played 1, win 100 %, streak 1, the `9` bucket highlighted.
9. Reload → the finished state is restored, not replayed.
10. A second spec (clock pinned the same way): 5 wrong guesses → loss, score 0, `X`-less loss grid;
    and a give-up spec that asserts the shared grid has **`guesses.length` rows, not `endedAtGuess`
    rows** (§4.4).
11. A third spec: clock pinned to **2026-09-05T12:00:00** → the "no puzzle today" screen renders for
    09-05 → navigate `?d=2026-09-02` practice → play to a win → assert `motodle:stats` is
    **byte-identical** before and after.
12. Viewport 360×640, **no keyboard, nothing focused** (`window.scrollY === 0`): both selects,
    `#mtd-year` and the submit button are inside the viewport (no scrolling). Unfocused is the
    stronger check — focusing a control can itself scroll the page, which would pass the assertion
    for the wrong reason (§5.8) — so the e2e spec asserts that, not a "focus `#mtd-model` then check"
    variant. (The keyboard-open case is §7.5 step 10 — headless Chromium cannot simulate it, §5.8.)
    **Revision 8 adds one assertion to this spec** (§5.11.7): the submit button's
    `getBoundingClientRect().bottom` is read before and after a failed submit (click submit with
    nothing chosen) and the two must be **equal** — the §5.11 layout reserves the error's space, so a
    validation message may never move the form.
13. **The in-play licence chip, and what it must not say** (§5.10.1) — in the win spec, clock pinned
    to 2026-09-02, after the help modal closes and **before any guess**: `#mtd-photo-licence` is
    visible, its text is exactly `Photo: Public domain` (fixture #1's `license.name`) and its `href`
    is fixture #1's `license.url`. Then the spoiler assertion, against the **whole page**
    (`page.content()`, so attributes count): it contains neither the author string `Pawlex`, nor the
    substring `File:`, nor `GSXR`, nor `commons.wikimedia.org/wiki/File:` — i.e. the Commons file
    title and description URL are nowhere in the DOM while the game is in progress. (`GSXR`,
    unhyphenated, is the *file title's* spelling; the catalog's model label is `GSX-R750`, so a
    populated `#mtd-model` dropdown cannot false-fail this assertion.) Re-assert after
    guess 1 (level 2 showing) that the chip is still there and the page is still clean.
14. **The credits view** (§5.10.4) — same spec, after the win of item 5: close the result modal via
    its `Photo credits` button (`#mtd-credits-link-result`), assert the credits dialog is open, and
    that `#mtd-credits` contains **exactly one** `[data-mtd-credit-row]`, the one with
    `data-date="2026-09-02"`, whose text carries `Motodle #1`, the answer `2004 Suzuki GSX-R750`, the
    author, a licence link and a `Source on Commons` link whose `href` is fixture #1's
    `descriptionUrl`. **Then the spoiler assertion that matters**: no row exists for `2026-09-03` or
    `2026-09-04` (both are future days and both puzzle files are published — §13.8), and
    `#mtd-credits-more` is absent (nothing more to load). Close it, re-open from the **footer** link
    `#mtd-credits-link`, and assert the same single row — the two entry points render one view.
    A second, cheaper leg in the practice spec (clock pinned to 2026-09-05, playing `?d=2026-09-02`):
    all three days are past, so the view lists **three** rows, newest first (`#3`, `#2`, `#1`), and
    still no `#mtd-credits-more` at 3 < 20.
15. **The fold rule, with the licence chip present** — `e2e/mobile-layout.spec.ts` gains three
    assertions to the existing 360×640 case, and nothing else about it changes (§5.10.2): the
    submit-button/`innerHeight` and `scrollWidth`/`clientWidth` assertions stay exactly as written;
    `#mtd-photo-licence` is **visible**; and every `.scrub__seg` still measures ≥ 44 × 44 CSS px
    (the licence line takes its width out of the scrub, so a regression that squeezes the segments
    below the touch target is the realistic way this design fails). The footer's `Photo credits`
    button is deliberately **not** asserted to be above the fold — §5.8 requires only the submit
    button.

Config: `workers: 1`, `webServer.command = npx vite preview --port 4173 --strictPort --host 127.0.0.1`.
**`--host 127.0.0.1` is mandatory** — Vite otherwise binds IPv6-only (`[::1]`) on this host and
`curl http://127.0.0.1:4173/` returns nothing. `webServer.url` must match whichever the command binds.

### 7.5 "Runs great locally" acceptance checklist

From a clean clone, in order. Every command must exit 0. **This checklist is runnable on any date** —
every step that could depend on "today" is pinned (§7.4a).

| # | Command | Expected |
|---|---|---|
| 0 | `npx playwright install chromium` | **One-time, needs network.** `npm ci` does not fetch browsers, and step 8 fails without them. On this host `~/.cache/ms-playwright` is already populated, so it is a no-op here. Zero-download alternative: set `channel: 'chrome'` in `playwright.config.ts` and use the system Chrome (verified working, but the version then floats with the OS package). |
| 1 | `npm ci` | exit 0, **no `ERESOLVE` warning** (that warning is the TS-7 trap, C5). **`npm ci`, not `npm install`** — `ci` hard-fails on any `package.json`/lockfile drift, whereas `install` would silently rewrite the verified lockfile and re-resolve the tree (§10.1). Confirm `npm ls typescript` reports **6.0.3**. |
| 2 | `npx svelte-check --tsconfig ./tsconfig.json` | 0 errors |
| 3 | `npx tsc --noEmit` | clean |
| 4 | `npm test` | all unit + tool + contract + component tests pass, **including the `test:tz` two-timezone run** (§10.2) |
| 5 | `unshare -rn npm run generate` | regenerates `public/puzzles/**` and `docs/ATTRIBUTION.md`; **`git status` shows no diff** (idempotent by §6.1, output committed). **`unshare -rn` gives the process no network at all**, so "no network access occurs" is mechanical, not trust-based. (`systemd-run --user -p PrivateNetwork=yes` is the alternative.) Contract test §7.2 #14 proves the same thing statically. |
| 6 | `npm run build` | `vite build` succeeds **and `check-budget.ts` prints all budgets green**; JS gz well under 60 KB |
| 7 | `npm run preview` | serves on `http://127.0.0.1:4173`; `curl -sS -o /dev/null -w '%{http_code}'` → `200` |
| 8 | `npm run test:e2e` | all Playwright specs pass — **on any date**, because every spec pins `page.clock` (§7.4a) |
| 9 | `unshare -rn npm run dev` | app loads offline, **typeahead works, and the puzzle for `todayOverride` renders**. Set `todayOverride = '2026-09-02'` in `src/config.ts` (DEV-only, §7.4a) or append `?today=2026-09-02`; on any date other than 2026-09-02/03/04 the unpinned app correctly shows "no puzzle today", which is a **pass, not a failure**. |
| 10 | **Operator plays a full round by hand in a real browser** | final gate. Includes the one thing e2e cannot check: **360×640 with the on-screen keyboard open**, on a real phone or in device emulation (§5.8). |

Note for step 5: `npm run generate` is byte-deterministic only for a fixed sharp/libvips build. If a
future sharp bump makes the WebPs differ, the check becomes "schema + budget valid", not "no diff" —
the contract test suite (§7.2) is the durable guard, and this is stated in the README.

---

## 8. Implementation workstreams

Streams are ordered so that `schema/` and the fixtures land first. **File sets are disjoint across any
two streams that run in parallel.**

**Single-owner rule — every file has exactly one writer, and the exceptions are named here.** Agents
cannot talk to each other, so "coordinate with W0" is not a thing this plan may say. The four files
that previously had two writers are resolved as:

| File | Owner | Everyone else |
|---|---|---|
| `index.html` | **W0**, in full, per §10.5 (viewport meta included) | read-only — **it is not in W4's file set** |
| `tools/check-budget.ts` | **W0 creates it as a passing stub** (prints `budgets: stub (W5 replaces this)`, exits 0) so `npm run build` works from day one; **W5 replaces the body** | nobody else touches it |
| `docs/ATTRIBUTION.md` | **generated** by `tools/schedule.ts`/`generate.ts` (§6.3) | nobody hand-authors it — not W1, not W5 |
| `docs/CATALOG-REVIEW.md` | **generated** by `tools/catalog.ts --review-only` (W2, offline, §6.10) | nobody hand-authors it; corrections go into `public/catalog.json` |
| `README.md` | **W0 creates it**; **W5 appends** the acceptance-checklist and licence sections | nobody rewrites it |
| `public/catalog.json` | **W1** hand-authors the seed; W2's `tools/catalog.ts` regenerates it *by running it*, preserving W1's `country`/`years` (§3.2) | — |
| `public/puzzles/**` | **W1** commits the generated output (using its own `tools/crop.ts`); W2 rewrites it only *by running* `npm run generate`, which is idempotent (§6.1) | never hand-edited by anyone |
| `tools/crop.ts` | **W1** (see I6 below) | W2 imports it, never edits it |

### W0 — Scaffold *(owner: `scaffold`)* — must land first, blocks everything

- **Files:** `package.json`, `package-lock.json`, `vite.config.ts`, `svelte.config.js`,
  `tsconfig.json`, `playwright.config.ts`, `index.html` (**in full**, §10.5), `.gitignore` (§2),
  `README.md`, `tools/check-budget.ts` (**passing stub**), `src/main.ts`, `src/setup-test.ts`,
  `src/App.svelte` (placeholder only).
- **Inputs:** §10 verbatim.
- **Lockfile procedure (do not improvise):** copy
  `~/.cache/motodle-planning/package-lock.verified.json` → `package-lock.json`, then edit **only**
  `name` → `motodle`, `version` → `0.1.0` and `license` (both at the top level **and** in
  `packages[""]`). Leave every resolved dependency untouched. `package.json` must declare
  `"typescript": "^6.0.3"` — **byte-identical to the range in the lockfile**; any other range makes
  npm re-resolve and the "verified green" pin becomes nominal.
- **DoD:** **`npm ci`** exits 0 **with no ERESOLVE warning** and `npm ls typescript` reports 6.0.3;
  `npm run build` (stub budget check included), `npm test` (one trivial test), `npx svelte-check`,
  `npx tsc --noEmit` all clean; **`npm test` parses the §10.3 config with `maxWorkers` and the extended
  `include` (`schema/**`, `tools/**`) without a warning** — neither was exercised by the toolchain
  probe; `npm run preview` answers 200 on `127.0.0.1:4173`; `npx playwright test` passes one smoke
  spec.

### W1 — Contracts + fixtures *(owner: `contracts`)* — blocks W2/W3/W4

- **Files:** `schema/**` (all), `fixtures/**`, **`tools/crop.ts` + `tools/crop.test.ts`**,
  `public/catalog.json` (seed), `public/puzzles/**`.
- **Inputs:** §3, §4.2, §4.7, §6.9, §6.10.
- **DoD:** every type in §3.7 exists and compiles, **including `evaluateGuess`'s `GuessInput` /
  `TileStates` / `CountryCode` and `CropLevel.rect`**; all five JSON Schemas validate their example
  payloads and use only the §7.2a keyword subset; the three fixture source JPEGs are committed with
  correct credit, `credit.modified` and an authored `id`; **the seed catalog has 40–60 makes and
  300–500 models, every make with a valid `country` and every model with a `years` range or an
  explicit `null`** (§6.10), including all three fixture answers; the fixture WebPs are generated with
  `tools/crop.ts`; **`l4.webp` and `l5.webp` for all three fixtures have been viewed and contain no
  legible year text (§6.6)** — specifically the 916's placard is gone, and the ZX-6R has been rendered
  and looked at for the first time by anyone; **contract tests §7.2 items 1–13 pass**.
- **Why `tools/crop.ts` is W1's and not W2's:** W1 must produce the fixture WebPs before W2 exists, and
  a "throwaway script implementing §4.7 verbatim" would be a *second* implementation of the crop
  geometry — precisely the drift §7.2 #10 exists to prevent, and §7.5 step 5's byte-determinism would
  then depend on two independent implementations agreeing. There is **one** crop implementation, W1
  writes it, and W2 imports it from `tools/generate.ts`. File sets stay disjoint.

### W2 — Content pipeline *(owner: `tools`)* — parallel with W3, W4

- **Files:** `tools/catalog.ts`, `tools/fetch.ts`, `tools/schedule.ts`, `tools/generate.ts`,
  `tools/lib/**`, and their `*.test.ts`. *(Not `tools/crop.ts` — that is W1. Not
  `tools/check-budget.ts` — W0 stub, W5 body.)*
- **Inputs:** W1's `schema/` and `tools/crop.ts`; §6 entire.
- **DoD:** **`npm run generate` is idempotent** — it regenerates `public/puzzles/**` and
  `docs/ATTRIBUTION.md` from `fixtures/` **offline**, reuses each fixture's `id`, leaves `git status`
  clean on a second run, and the result is contract-valid and within budget; §7.2 #14's import-graph
  test proves `generate.ts` cannot reach the network; **`npm run catalog -- --dry-run` and
  `npm run fetch -- --dry-run`** (note the `--` — `npm run fetch --dry-run` sets *npm's* dry-run flag,
  not the tool's) exit 0 against the on-disk cache, and on a clean clone, where `.cache/` is empty and
  git-ignored, they exit 0 reporting an empty cache **without making a network call**;
  `npm run catalog -- --review-only` regenerates `docs/CATALOG-REVIEW.md` offline; the tool unit tests
  of §7.1 pass, covering all 13 observed `LicenseShortName` strings, the GFDL-only reject, the
  dual-licence case and the `unknown-p275` warning path; the client **fails fast** if the assembled
  User-Agent is empty or contains `<`/`>`, sends the §6.8 UA, and serializes requests.

### W3 — Core game library *(owner: `core`)* — parallel with W2, W4

- **Files:** `src/lib/**` (all), `src/config.ts`, and their `*.test.ts`.
- **Inputs:** W1's `schema/`; §4 entire.
- **DoD:** every §7.1 test passes; **`evaluateGuess()` is the sole implementation of RULES A and B and
  the year bands, exported from `src/lib/game.ts` with exactly the §3.7 signature**; `share.test.ts`
  matches §4.4 byte-for-byte (2-row give-up, collapsed zero-row give-up, no trailing newline, `⬜` in
  colourblind mode) against `SITE_URL` imported from `src/config.ts`; `stats.test.ts` proves the
  §4.3 streak arithmetic **and the `lastCompletedDate` idempotency no-op**; `score.test.ts`
  exhaustively proves the achievable set is `{0,1,2,3,6,9,12,15}`; `date.test.ts` passes under two
  non-UTC `TZ` values including a 30-minute offset; storage keys carry **no version segment**;
  **`src/lib/` imports nothing from `src/components/` and touches no DOM API at all** — `share.ts`
  exports only the pure `buildShareText()`, and the `ShareSink` delivery ladder is W4's
  `src/state/share.ts`.

### W4 — UI *(owner: `ui`)* — parallel with W2, W3

- **Files:** `src/App.svelte`, `src/components/**`, `src/state/game.svelte.ts`,
  `src/state/share.ts` (the `ShareSink`), `src/styles/**`, and `*.test.ts` for components.
  **`index.html` is W0's and is already final (§10.5) — W4 does not touch it.**
- **Inputs:** W1's `schema/` and fixture JSON; W3's `src/lib/` **interfaces** (W4 codes against the
  §3.7 types and may stub `src/lib/` until W3 lands).
- **DoD:** every §7.3 component test passes; the app runs against the committed fixture puzzles;
  the combobox satisfies the full §5.3 ARIA and keyboard table, **including the always-mounted
  `hidden` listbox** and the locked-make filtering rule; **every tile colour comes from
  `evaluateGuess()` — no component computes one**; the HelpModal explains all three yellow bands in
  the §5.6 wording; the ResultModal renders `credit.modified` and letterboxes a non-4:3 full reveal;
  pinch zoom works; light/dark/colourblind all render; 360×640 keeps the form reachable (no-keyboard
  case; the keyboard-open case is the operator's, §7.5 step 10); **`npm run build` JS gz < 60 KB**
  (W0's stub budget check keeps `build` green before W5 lands).
  **W4's final DoD depends on W2's `npm run generate` output** — until W2 lands, W4 runs against W1's
  hand-authored puzzle JSON and placeholder images.

### W5 — E2E, budgets, docs *(owner: `verify`)* — after W2/W3/W4

- **Files:** `e2e/**`, `tools/check-budget.ts` (**body only** — W0 created the file), and an **appended
  section** in `README.md` (acceptance checklist, `npx playwright install chromium`,
  `MOTODLE_UA_CONTACT`, `todayOverride`, and the §6.5a image-licence paragraph). **`docs/ATTRIBUTION.md`
  is generated, not written here.**
- **Inputs:** everything.
- **DoD:** the full §7.5 checklist passes from a clean clone **on a date other than 2026-09-02**, which
  is what proves the §7.4a clock pinning works; the e2e playthrough (§7.4) covers win, loss, give-up,
  practice isolation, the "no puzzle today" screen and the 360×640 layout; `check-budget.ts` reads its
  limits from `schema/constants.ts` and fails the build on a deliberate over-budget artifact (verified
  by a temporary test).

**Parallelism:** `W0 → W1 → { W2 ∥ W3 ∥ W4 } → W5`.

**Resource limits** (4.8 GiB available, swap 968/975 MiB used at rest): vitest `maxWorkers: 2`,
Playwright `workers: 1`, `sharp.concurrency(2)` in `tools/crop.ts`. Do not run W2, W3 and W4's test
suites simultaneously on this host.

---

## 9. Later-phase hooks (design only — DO NOT BUILD NOW)

### 9.1 Login + cross-device stat sync

The seam already exists: **`StorageBackend`** (§3.5). Ship a `RemoteStorageBackend` that wraps
`LocalStorageBackend` with a write-through queue and a pull-on-focus; `subscribe()` already exists for
cross-tab and becomes cross-device unchanged. The merge key **will be** `puzzleId`, which is stable
forever and answer-free (§3.1) — but be honest about what exists today: **`StatsState` (§3.5) holds
only aggregate counters, no per-puzzle rows**, so sync needs a `STORAGE_VERSION` bump to 2 adding
`completed: { "<puzzleId>": { date, score, guesses, won } }` and deriving `played`/`wins`/
`scoreDistribution` from it. That is exactly what the migration hook exists for, and it is why the
hook is v1's only piece of forward machinery. Conflict rule to adopt then: highest score per
`puzzleId` wins; streak is **recomputed** from the merged set of win dates, never merged directly. No
component changes; no game-logic changes. (v1 does not ship the map: the §4.3 `lastCompletedDate`
guard already prevents the double-counting it would also have fixed, and an unowned field in a frozen
contract is worse than a documented migration.)

### 9.2 Photo submissions

A submission is a `ReviewCandidate` (§3.4) with `sourceCategory: "submission"` and
`candidateId: "sub-<uuid>"`. It enters the same review file and the same approve loop. The only new
code is an ingest that writes a review entry — the pipeline downstream is untouched.

### 9.3 Crop-level editor

`focus`, `sourceCrop` and `cropFractions` are already per-puzzle fields (§3.1) and already flow through
`operator.*` in the review file (§3.4). An editor is a UI that writes those three fields; `crop.ts`
already accepts all of them as CLI flags. Nothing in the contract changes.

### 9.4 Scheduling UI

`schedule.ts` is already date-driven and idempotent, and `manifest.json` is already the archive index.
A UI writes `decision` and a target date into the review file and shells out to the same script.
`id` is minted once and never regenerated, so re-scheduling a date is safe.

### 9.5 S3 + CloudFront

> **Superseded by §13 (§13.1 D2, D3); kept unedited for history.**

`PUZZLE_BASE_URL` and `CATALOG_URL` are config values in `src/config.ts` and every puzzle `src` is
relative (§3), so moving puzzles to a CDN is a one-line change plus a CORS rule.

**Cache-header plan:**

| Path | `Cache-Control` | Why |
|---|---|---|
| `/assets/*` (hashed JS/CSS) | `public, max-age=31536000, immutable` | Content-hashed by Vite |
| `/index.html` | `public, max-age=0, must-revalidate` | Must pick up a new bundle immediately |
| `/puzzles/manifest.json` | `public, max-age=300` | Changes when a puzzle is scheduled |
| `/puzzles/YYYY-MM-DD.json` | `public, max-age=31536000, immutable` | A published puzzle never changes |
| `/puzzles/img/**` | `public, max-age=31536000, immutable` | Path contains the puzzle number |
| `/catalog.json` | `public, max-age=3600` + ETag | Regenerated occasionally |
| **any 404** | `Error Caching Minimum TTL = 60 s` | **Negative caching must be short.** A puzzle scheduled hours after someone first requested that date must not stay 404 in the CDN. 60 s is long enough to absorb a crawl, short enough to be invisible. |

The site is served at **`https://playmotodle.com`** (`SITE_URL`, D5) — the same value the share text
embeds, so a domain change is one config edit plus a DNS/CloudFront alias.

**Correcting a published puzzle.** `/puzzles/YYYY-MM-DD.json` is `immutable`, so a bad crop or a wrong
year **cannot be fixed in place**. The procedure is: publish the new images under a **new path
prefix** (`/puzzles/img/NNNN-b/…`), rewrite the JSON to point at it, and issue an **explicit
invalidation for that one JSON path**. The images themselves are never invalidated — their path
changed, which is the point.

CloudFront: default root object `index.html`; **404 must be returned as a real 404, not rewritten to
`index.html`** — the client relies on a 404 to mean "no puzzle today" (§5.1). An SPA error-page rewrite
would turn every missing puzzle into an HTML body and a JSON parse error. Invalidate only `/index.html`
and `/puzzles/manifest.json` on deploy.

---

## 10. Pinned versions and exact configs

All versions below were **installed and verified green together** by the toolchain probe on this host
(Debian 13, node v22.23.2, npm 10.9.8). Seed `package-lock.json` from the **durable copy already made during planning**:

```
~/.cache/motodle-planning/package-lock.verified.json   ->  motodle/package-lock.json
~/.cache/motodle-planning/package.probe.json           ->  reference for the devDependency block
```

(The probe's own copy under `/tmp/.../scratchpad/toolchain-probe/` is on **tmpfs and will not survive a
reboot**; the `~/.cache` copy is on `/` and will.)

**Seeding it correctly matters more than it looks.** The verified lockfile records
`name: "toolchain-probe"`, `version: "1.0.0"`, `license: "ISC"` and
`packages[""].devDependencies.typescript = "^6.0.3"`. Copy it, then edit **only** `name` → `motodle`,
`version` → `0.1.0` and `license` — at the **top level and in `packages[""]`** — and change nothing
else. `package.json` must then declare **`"typescript": "^6.0.3"`**, the identical range. A different
range (`~6`, `^6`) does not fail: `npm install` silently rewrites the lock and re-resolves every
dependency against the live registry, so the "verified green" tree quietly stops being the verified
green tree while every check still passes. **The acceptance checklist uses `npm ci`** (§7.5 step 1),
which hard-fails on exactly that drift.

### 10.1 devDependencies

| Package | Pin | Resolved | Note |
|---|---|---|---|
| `vite` | `^8.2.2` | 8.2.2 | Rolldown-based |
| `svelte` | `^5.57.0` | 5.57.0 | ≥ 5.20, so `$props.id()` is available |
| `@sveltejs/vite-plugin-svelte` | `^7.3.0` | 7.3.0 | peers svelte ^5.46.4, vite ^8 |
| **`typescript`** | **`^6.0.3`** | **6.0.3** | **C5 — `*` gives 7.0.2 and crashes svelte-check.** The range must be byte-identical to the verified lockfile's, which is `^6.0.3`, **not** `~6`. |
| `svelte-check` | `^4.7.6` | 4.7.6 | |
| `vitest` | `^4.1.11` | 4.1.11 | |
| `jsdom` | `^30.0.1` | 30.0.1 | |
| `@testing-library/svelte` | `^5.4.2` | 5.4.2 | |
| `@testing-library/jest-dom` | `^7.0.1` | 7.0.1 | |
| `sharp` | `^0.35.4` | 0.35.4 | native libvips 8.18.6, SIMD on |
| `tsx` | `^4.23.13` | 4.23.13 | |
| `@types/node` | `^26.4.1` | 26.4.1 | **required**, and `"node"` must be in `compilerOptions.types` |
| `playwright` | `^1.62.1` | 1.62.1 | |
| `@playwright/test` | `^1.62.1` | 1.62.1 | |

**Runtime dependencies: none.** The app ships no third-party JS.

### 10.2 `package.json` scripts

```json
{
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build && tsx tools/check-budget.ts",
    "preview": "vite preview --host 127.0.0.1 --port 4173 --strictPort",
    "test": "npm run test:unit && npm run test:tz",
    "test:unit": "vitest run",
    "test:tz": "TZ=America/Los_Angeles vitest run src/lib/date.test.ts && TZ=Australia/Lord_Howe vitest run src/lib/date.test.ts",
    "test:e2e": "playwright test",
    "check": "svelte-check --tsconfig ./tsconfig.json && tsc --noEmit",
    "generate": "tsx tools/generate.ts",
    "catalog": "tsx tools/catalog.ts",
    "fetch": "tsx tools/fetch.ts",
    "crop": "tsx tools/crop.ts",
    "schedule": "tsx tools/schedule.ts"
  }
}
```

`test:tz` is why the §4.1 DST claim and W3's "passes under a 30-minute offset" DoD are actually
tested: Node cannot flip `TZ` reliably mid-run, so the two timezones are two processes, and `npm test`
runs both. `build` calls `tools/check-budget.ts`, which **W0 ships as a passing stub** so that
`npm run build` is green from the first commit (§8).

### 10.3 `vite.config.ts` — verbatim from the verified probe, plus `maxWorkers`

```ts
import { defineConfig } from 'vitest/config';          // NOT from 'vite' — TS2769 otherwise
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';

export default defineConfig({
  plugins: [svelte(), svelteTesting()],                // svelteTesting() is MANDATORY (probe §3a)
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setup-test.ts'],
    include: ['src/**/*.{test,spec}.{ts,js}', 'schema/**/*.test.ts', 'tools/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],  // else vitest steals Playwright's specs
    maxWorkers: 2,                                      // 4.8 GiB free, swap full
  },
});
```

**`tools/**/*.test.ts` is not optional.** §8 gives `tools/` exclusively to W1/W2, so the crop, licence,
year and normalize unit tests their DoDs require **cannot** live under `src/` or `schema/` — without
that third glob they would never execute and both DoDs would be vacuous. Likewise `schema/**/*.test.ts`
carries the entire §7.2 contract suite. **Neither glob, nor `maxWorkers`, was exercised by the
toolchain probe** (which ran a single default-config test file), so W0's DoD explicitly includes
"`npm test` parses this config without a warning".

### 10.4 `svelte.config.js`, `tsconfig.json`, `playwright.config.ts` — verbatim

```js
// svelte.config.js
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
export default { preprocess: vitePreprocess() };
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true, "noEmit": true, "isolatedModules": true, "verbatimModuleSyntax": true,
    "skipLibCheck": true, "resolveJsonModule": true, "allowJs": true, "checkJs": true,
    "types": ["vitest/globals", "node"]
  },
  "include": ["src/**/*.ts", "src/**/*.svelte", "schema/**/*.ts", "tools/**/*.ts", "*.ts", "*.js"]
}
```

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
```

### 10.5 `index.html` head — the parts that matter

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="description" content="Guess the motorbike in 5 tries. A new motorbike is available each day.">
<title>Motodle</title>
```

No `user-scalable=no`. No `maximum-scale`. No webfont `@import`. No third-party script tags.
**W0 writes this file in full and it is final** — no other stream edits `index.html` (§8), with one
recorded exception: revision 8 rewrites the `description` above (§5.12 T1). There are no OG or
Twitter-card tags; if any are added they carry the same sentence verbatim.

### 10.6 `src/config.ts` — pinned, because three streams depend on the exact values

```ts
/** Every URL the app fetches, in one place. §9.5's CDN move is an edit to this file. */
export const PUZZLE_BASE_URL = '/puzzles/';        // manifest = `${PUZZLE_BASE_URL}manifest.json`
                                                   // puzzle   = `${PUZZLE_BASE_URL}${date}.json`
                                                   // images   = `${PUZZLE_BASE_URL}${level.src}`
export const CATALOG_URL = '/catalog.json';
export const SITE_URL = 'https://playmotodle.com'; // operator decision D5; share text ends with it

/** DEV-ONLY clock override (§7.4a). MUST be null in a production build — guard every read with
 *  `import.meta.env.DEV`, and honour `?today=YYYY-MM-DD` under the same guard. */
export const todayOverride: string | null = null;
```

Every `src` in a puzzle file is **relative** (§3), resolved against `PUZZLE_BASE_URL` — never absolute,
never a full URL. `share.test.ts` imports `SITE_URL` from here rather than hard-coding the domain, so
D5 stays a one-line change.

### 10.7 Environment gotchas the implementing agents will hit

1. **Vite binds IPv6-only by default on this host.** `curl http://127.0.0.1:4173/` returns nothing
   (`status=000`) while `localhost:4173` and `[::1]:4173` return 200. Always pass `--host 127.0.0.1`.
2. **`pkill -f "vite preview"` kills the calling shell** (the Bash tool's own `-c` line contains that
   literal string; observed exit 144 twice). Use PID files or `ss -ltnp | grep -oP 'pid=\K[0-9]+'`.
3. Background processes **survive across Bash tool calls**. Reap them deliberately.
4. Foreground `sleep` is blocked by the harness — wait on a port with
   `curl --retry N --retry-connrefused --retry-delay 1`.
5. `sysctl` is not on `PATH`; read `/proc/sys/...` directly.
6. `require('<pkg>/package.json')` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` for packages with strict
   `exports`. Read the JSON off disk.
7. `npm ls` reporting `@img/sharp-wasm32`, `@emnapi/runtime`, `tslib` as **extraneous** is normal
   optional-dependency residue, not a broken install.
8. Never write `let x = $state(someProp)` — it produces `state_referenced_locally` and only captures
   the initial value.
9. In a `.svelte.ts` module you **cannot** `export let x = $state(0)` and reassign it. Export an object
   and mutate its properties, or export getter/setter pairs.

---

## 11. Revision log

> **R7 (2026-09-03, first deploy):** the first `deploy.yml` run failed `AssumeRoleWithWebIdentity`. CloudTrail showed GitHub issuing the *immutable* OIDC subject `repo:reenchree@213154582/motodle@1355164768:ref:refs/heads/main` (owner and repo numeric ids) rather than the classic `repo:reenchree/motodle:ref:refs/heads/main`. The trust policy now lists both forms (`local.github_subs`, ids in `variables.tf`). terraform-core's `GitHubOIDCECRPushRole` (`repo:reenchree/*:*`) has the same exposure.


This revision applied every BLOCKER from both critics, the cheap-and-clearly-right IMPROVEMENTS, the
operator's five open-question decisions, and two new game rules. Terse index of what changed and where.

### 11.1 Blockers — game critic

| # | Change | Sections |
|---|---|---|
| B1 | `CropLevel` gains `rect {w,h}`; `levels[].w` is **non-decreasing**, `levels[].rect.w` **strictly increasing**; literal example and field table carry `rect`; contract test rewritten | §3.1, §3.7, §4.7, §6.9, §7.2 #8 |
| B2 | `normalizeId` prose replaced by the **literal function body** + 12 **frozen test vectors**. The critic's stated rule was itself self-contradictory (it turned `honda-cb750` into `hondacb750`); the frozen vectors were kept and the predicate corrected to `short(left) && short(right)`, `short` = digit-run or ≤3-letter run — the only simple rule satisfying all 12 | §3.2, §7.1, §7.2 #10 |
| B3 | `id` is a **required `FixtureSource` field**, copied never re-minted; `schedule` mints only for a date with no puzzle file; manifest example fixed | §3.1, §3.3, §3.6, §6.3, §6.9, §7.2 #4 |
| B4 | `typescript` pinned `^6.0.3` (byte-identical to the verified lock); W0 patches only lock `name`/`version`/`license`; acceptance step 1 is **`npm ci`** | §7.5, §8 W0, §10, §10.1 |
| B5 | `tools/check-budget.ts` shipped by **W0 as a passing stub**, body replaced by W5; named in the single-owner table | §2, §8 intro, §8 W0/W5, §10.2 |
| B6 | `test:unit` / `test:tz` / `test` scripts added; vitest `include` gains `tools/**/*.test.ts` | §10.2, §10.3, §7.1 |
| B7 | **Clock pinning §7.4a** — `page.clock.install` at 2026-09-02T12:00 (win/loss/give-up) and 2026-09-05T12:00 (practice, which also exercises "no puzzle today"); `vi.setSystemTime` in unit tests; DEV-only `todayOverride` for manual runs | §7.4a, §7.1, §7.5 steps 9–10, §10.6 |
| B8 | Give-up appends **no** row: grid = `guesses.length` rows, `endedAtGuess = guesses.length + 1`; give-up example rewritten to 2 rows; zero-row case and **no trailing newline** specified | §4.3, §4.4, §7.1 |
| B9 | Locked-make filtering: entries **keep their full `norm`**, option rows render the model only, make is a chip; `match.test.ts` cases added | §5.3, §7.1, §7.4 step 4 |
| B10 | Streak arithmetic frozen as code: `lastWinDate`/`lastCompletedDate` = **`puzzle.date`**; "yesterday" = `dayIndex` difference of 1; whole update is a **no-op when `lastCompletedDate === puzzle.date`** | §4.3, §3.5, §7.1 |
| B11 | Storage keys lose the `v<N>` segment (`motodle:today`/`stats`/`prefs`/`practice:<date>`); version lives only in `motodle:schema` + `schemaVersion`; `MIGRATIONS[v]` is v→v+1 | §3.5, §4.5, §4.6, §7.1, §7.4 |

### 11.2 Blockers — ops critic

| # | Change | Sections |
|---|---|---|
| B1 | `generate`/`schedule` are **idempotent**: reuse the existing `id`, overwrite unconditionally, `--force` only to re-point a date; **`ATTRIBUTION.md` regenerated wholesale**, never appended | §6.1, §6.3, §7.5 step 5, §8 |
| B2 | Clock pinning — merged with game B7 (see the conflict note in §11.5) | §7.4a |
| B3 | `levels[].w` non-decreasing — merged with game B1; rect monotonicity kept **both** as the `crop.ts` assertion and as contract test #8, since `rect` is now stored | §4.7, §7.2 #8 |
| B4 | **§6.5a share-alike/derivative statement**: derivatives carry the source licence, `credit.modified` added to the contract and rendered in ResultModal, verbatim paragraph required in `ATTRIBUTION.md` + `README.md` | §3.1, §5.6, §6.5a, §7.2 #7, §7.3 |
| B5 | vitest `include` gains `tools/**` — merged with game B6; §7.1 now names the tool test files so every §7 test is reachable | §7.1, §10.3 |
| B6 | check-budget stub — merged with game B5 | §8, §10.2 |
| B7 | `test:tz` — merged with game B6 | §10.2 |
| B8 | Review-file `thumbUrl` example replaced with the **unscaled original** + "never construct a width" annotation | §3.4 |
| B9 | User-Agent is concrete (D5), assembled from `MOTODLE_UA_CONTACT` with that default, **fails fast** on empty or `<`/`>`; documented in README | §3.4, §6.8, §8 W2 |

### 11.3 Improvements applied

Game: 1 (open-questions section replaced by **§1.3 fixed decisions**), 3 (model lock shows the
player's own entry), 4 (`full` encoded **after** `sourceCrop`, `aspect` describes levels only,
letterboxing), 5 (`bh0 = 1091`), 6 (**§10.6 `src/config.ts`** pinned), 7 (catalog-failed screen),
8 (listbox always mounted + `hidden`, `aria-controls` test), 9 (§5.8 keyboard-open moved to the
operator gate), 10 (colourblind red → `⬜`), 11 (`guessDistribution` deleted; `lastCompletedDate`
given its consumer), 12 (all 5 levels unlock post-game), 13 (input retains its label after a guess),
14 (W0 owns `index.html` in full), 15 (`unshare -rn` for the offline steps), 16 (W0 DoD parses
`maxWorkers` + extended include), 17 (duplicate guesses allowed), 18 (practice records pruned to 30).

Ops: I1 (`id = mtd-NNNN`, answer-free), I3 (year scan = title + description only; `DateTimeOriginal`
and SDC `P571` are **negative** evidence), I4 (one `source-width-below-min` rule: warn + pending,
`schedule` refuses without a working override), I5 (floor checked against `min(W, round(H×aspect))`),
I6 (**`tools/crop.ts` moved into W1** — one crop implementation, no throwaway script), I7 (full reveal
= source-cropped width, same quality search; **all budgets moved into `schema/constants.ts`**),
I8 (merged with game B4), I9 (P275 Q-id map completed; **P275 authoritative for denial only**,
unknown ⇒ `unknown-p275` + pending), I10 (`license.url`/`name` verbatim from extmetadata,
`jurisdiction` field added), I11 (`share.ts` pure `buildShareText()`; `ShareSink` in `src/state/`),
I12 (single-owner table for every contested file), I13 (`.gitignore` fixed), I14 (404 negative TTL
60 s + the immutable-JSON correction procedure), I15 (**§7.2a** validator keyword subset + self-test),
I16 (zero-row give-up collapses), I17 (import-graph test proves `generate.ts` is offline),
I18 (`npx playwright install chromium` as acceptance step 0, with the `channel: 'chrome'` alternative).

### 11.4 Improvements skipped

| # | Why |
|---|---|
| Game 2 (`stats.completed` map now) | Widens the frozen v1 storage contract and forces `played`/`wins`/`scoreDistribution` to be derived. B10's `lastCompletedDate` guard already delivers the idempotency half. §9.1 was instead corrected to state honestly that sync needs a v2 migration adding the map — which is what the migration hook exists for. |
| Ops I2 (commit recorded Wikimedia responses under `tools/__fixtures__/`) | Requires copying recon response dumps off tmpfs and committing a new fixture corpus — real scope, and the DoD it defends is a convenience check. The cheap half **was** applied: the CLI gains `--dry-run` for `fetch.ts`, the DoD is written `npm run fetch -- --dry-run`, and the clean-clone (empty-cache) behaviour is now specified as "exit 0, report empty cache, no network call". |

### 11.5 Conflicts between the two critics, and how they were resolved

1. **Clock pinning date.** Game B7 pins the main specs to **2026-09-02** (today = #1); ops B2 pins
   *everything* to 2026-09-03 (today = #2). Took **game B7**: §7.4 steps 2–6 already assert puzzle #1,
   the GSX-R750 and a score of 9, so 09-02 keeps the existing spec text correct, and the practice spec
   at 09-05 buys the "no puzzle today" screen as well. Ops B2's other three parts (vitest
   `vi.setSystemTime`, DEV-only `todayOverride`, README documentation) were applied in full.
2. **Rect monotonicity.** Game B1 stores `rect` on each level and asserts it in the contract suite;
   ops B3 keeps it as a `crop.ts`-internal assertion "since rect widths are not stored". Took **game
   B1** (rect *is* now stored) **and kept** ops B3's `crop.ts` assertion — they are complementary, and
   the cross-agent net is stronger with both.
3. **Puzzle `id` format.** Game B3 (blocker) keeps the answer-bearing slug and asks for `modelSlug` to
   be defined; ops I1 (improvement) makes `id = mtd-NNNN`. Took **ops I1**, because §3.3 already
   declares the manifest answer-free and the slug form made that statement false — a self-consistency
   defect the blocker's own correction would have left standing. Everything else in B3 was applied
   (`id` required on `FixtureSource`, copied never re-minted, manifest example fixed); `modelSlug` is
   no longer needed and is gone rather than defined.
4. **Zero-guess give-up.** Game B8 describes emitting header/blank/blank/URL; ops I16 collapses it to
   header/blank/URL. Took **ops I16** — both critics wanted the case *specified*, and two consecutive
   blank lines is the defect, not the specification.

### 11.6 Open questions — operator decisions

All five are now frozen in **§1.3** and referenced from the sections that consume them.

| Q | Decision | Landed in |
|---|---|---|
| Q1 | `PUZZLE_NUMBER_OFFSET = 1` — 2026-09-02 is Motodle #1 | §1.3 D1, §4.1 |
| Q2 | Keep the Ducati 916 fixture with the computed `sourceCrop` | §1.3 D2, §6.9 |
| Q3 | Stay at 3 fixtures | §1.3 D3, C2, §6.9 |
| Q4 | Catalog keeps families **and** depth-2 variants; `acceptModelIds` decides correctness | §1.3 D4, §3.1, §6.10 |
| Q5 | `SITE_URL = https://playmotodle.com` (config value); UA = `motodle/0.1 (https://playmotodle.com; homelab hobby project)` (contact URL amended 2026-09-02, §11.12); **no email anywhere** | §1.3 D5, §3.4, §4.4, §6.8, §9.5, §10.6 |

### 11.7 The two new rules

**RULE A — MAKE yellow on a shared country.** Green if same make, else yellow if
`makes[].country` matches, else red. Yellow locks nothing and scores nothing.

**RULE B — MODEL yellow when the guessed bike was on sale in the *answer's* year.** Green if in
`acceptModelIds`, else yellow if the guessed model's `years` range contains `answer.year`, else red.
`years: [from, to|null] | null`; `to: null` = still on sale (≤ currentYear + 1); `years: null` =
unknown ⇒ **never** yellow. Evaluated against `answer.year`, never the typed year. Green model still
implies green make; yellow model implies nothing about the make tile.

Where they landed:

| Concern | Sections |
|---|---|
| Brief summary / deviations from Cardle | §1.2 (two new rows), §1.3 D6–D7 |
| Catalog contract, literal example, field table | §3.2 (`makes[].country` required; `models[].years` load-bearing, shape and accuracy standard) |
| Types + the one shared evaluator | §3.7 (`CountryCode`, `GuessInput`, `TileStates`, `evaluateGuess()` signature) |
| Evaluation spec + worked boundary tables | §4.2 (RULE A table; RULE B table with `from`, `to`, `to: null`, `years: null` and one year outside each end) |
| Locking / scoring | §4.3 (yellow locks nothing on **any** tile; scoring still counts only green) |
| Share text and stats | §4.4 (yellow can now appear on all three tiles — glyphs already existed, scoring unchanged), §3.5 (`result.*` may be any colour) |
| Help text | §5.6 (player-facing wording, `COUNTRY_NAMES`, "the year the answer was built") |
| Constants | §4.7 (`COUNTRY_NAMES`) |
| Seed catalog authoring | §6.10 (40–60 makes, 300–500 models, every decade since 1950; `country`/`years` hand-authored, ±1 year acceptable, `null` when unsure; `docs/CATALOG-REVIEW.md`) |
| Tests | §7.1 (`game.test.ts`, `catalog.test.ts`), §7.2 #11–#12 (country valid; year range sane), §7.3 (`Scoreboard` yellow columns), §7.4 (e2e guesses chosen so the intended tiles still come out red) |
| Workstream DoDs | §8 W1 (catalog fields), W3 (`evaluateGuess` is the sole implementation), W4 (no component computes a tile colour) |

### 11.8 Revision 2 — user feedback 2026-09-02

Operator feedback taken verbatim after playing the first build: **"Marque => Make. I'm american"**, and
replace the single make-model typeahead with **two dropdowns — pick the make, then pick from that
make's models, all years**. Both decisions are **fixed**; they are not design options to re-litigate.

| # | Change | Why | Sections |
|---|---|---|---|
| R2-1 | **"marque" → "make" everywhere in this plan's prose**, user-facing wording first (help text, catalog field prose, RULE A worked example, seed-catalog authoring notes) | The operator is American; "marque" is not the word an American player uses. The same rename is required in the UI strings, the help modal, every `aria-label`, and the README | §3.2, §4.2, §5.6, §6.10 |
| R2-2 | The **one exception**: the `/\s+motorcycle marque$/i` suffix strip in `tools/catalog.ts` **stays**. It matches a Wikimedia Commons category name, not a player-facing string — renaming it would break category parsing | §6 (tools, unchanged) |
| R2-3 | §5.3 rewritten from "The combobox — `GuessCombobox.svelte`" to **"Make/Model dropdowns — `GuessForm.svelte`"**: two cascading native `<select>`s, frozen DOM contract (`#mtd-make` / `#mtd-model`, placeholder options, option values = catalog ids), the cascade and its reset rule, the locking affordance, the validation messages, keyboard/touch/sizing notes, and the exact `$state`/`$derived` shape | Native selects give the phone OS picker, free keyboard type-ahead, and accessibility by default; they delete an entire class of hand-rolled-popup defects (the `mousedown`-blur trap, the visual-viewport flip, outside-dismissal, virtual focus) rather than specifying fixes for them | §5.3 (all of it) |
| R2-4 | The **MODEL list is every model of the chosen make — all years, families and depth-2 variants alike, alphabetical**. No year filtering, ever | Operator instruction; also a leak guard — filtering the list by year would expose `answer.year` | §5.3.2 |
| R2-5 | **Locking rules unchanged** (§4.3 still binding): green MAKE disables `#mtd-make` while `#mtd-model` keeps listing that make's models; green MODEL disables `#mtd-model` too; only the year stays editable. Only the *affordance* moved — `disabled` + the existing locked chip / `aria-label` instead of a filtered input | The §4.3 contract, the scoring rules and the "never show `answer.model`" guarantee were all fine; only the widget changed | §5.3.3 |
| R2-6 | **Validation keeps the existing inline pattern**: `aria-disabled` submit, `aria-invalid` + `aria-describedby` on the offending select, messages *"Choose a make"* / *"Choose a model"*, year message unchanged. Never a silently dead button | Cardle's silent-disabled-button trap stays fixed | §5.3.4 |
| R2-7 | **Deletions**: `GuessCombobox.svelte`, `GuessCombobox.test.ts`, the matcher half of `src/lib/match.ts` (`buildMatchIndex`/`rankMatches`/`matchCatalog`/`fold`/`tokenize`/`MatchEntry`/`MatchOptions`), the matcher `describe`s in `match.test.ts`, `GameStore.matchEntries` and the `entries` prop | Dead code once nothing types a query | §5.3.7 |
| R2-8 | **`normalizeId` stays in `src/lib/match.ts`, at that exact path** — §7.2 #10 loads the file by path and diffs it against `tools/lib/normalize.ts`. `match.test.ts` keeps the §3.2 frozen vector table. `MatchResult`/`MatchTier` stay declared in `schema/types.ts` because the §3.7 name list is frozen; nothing imports them | A frozen cross-implementation contract test must not be collateral damage of a UI change | §5.3.7, §7.2 #10 |
| R2-9 | `src/lib/catalog.ts` gains `listMakes(index)` and `modelsForMake` now sorts; both use `localeCompare(…, 'en')` so ordering is locale-proof under the two-timezone run | The dropdowns need a stable, asserted order | §5.3.2 |
| R2-10 | §5.2 component list drops `GuessCombobox.svelte` | follows R2-7 | §5.2 |
| R2-11 | §7.3 swaps the `GuessCombobox` row for a **`GuessForm`** row covering option population and order, the cascade reset, the disabled-until-a-make state, both locked states, resumed-game pre-fill, all three validation messages, and one `onsubmit` call per submit | The component under test changed; every behaviour worth testing moved up into `GuessForm` | §7.3 |
| R2-12 | §7.4 now enters guesses with `page.selectOption(...)` by **catalog id**; step 4 asserts the locked-make state and that `#mtd-model` lists that make's whole model list (`suzuki-gsxr750` present, `triumph-bonneville-t120` absent, >1 option); step 12 stays unfocused, `window.scrollY === 0` (stronger than focusing `#mtd-model`, §5.8 — a focus call can itself scroll the page). **Every other assertion is unchanged** — tiles, scrub, score 9, share text, stats, practice-isolation, loss/give-up grids | The playthrough's subject matter did not change, only the input mechanics | §7.4 |
| R2-13 | Older combobox wording elsewhere (§1.2's two rows, §2's file list, §4.3's "Combobox" cells, §5.1's "no typeahead", §5.8's `dvh` clause, §7.1's matcher cases, §8 W4's ARIA-listbox bullet) is **superseded, not edited** — §5.3 opens with the list and wins any disagreement | Revision 2 was scoped to the sections that define the control; leaving a supersession list is safer than a scattered rewrite. Folding it in is a follow-up | §5.3 preamble |

Everything not listed here is unchanged: `evaluateGuess` and both yellow rules, scoring and the 8-bucket
distribution, share text, stats and streak arithmetic, storage schema, the image stage, the modals, the
payload budgets, and the mobile rules (form reachable at 360×640 without scrolling, pinch zoom on).

### 11.9 Revision 3 — continuous integration 2026-09-02

Adds **§12**, the specification for `.github/workflows/ci.yml`. Nothing in §1–§10 changes; CI is a
*second driver* of the §7.5 checklist, not a new contract. Three things are worth flagging up front:

| # | Change | Why |
|---|---|---|
| R3-1 | New **§12** — one workflow, one job, running §7.5 rows 1–8 headless on `ubuntu-24.04` | The §7.5 checklist was written to be machine-runnable ("runnable on any date", every spec clock-pinned §7.4a); CI is the payoff for that discipline |
| R3-2 | **BLOCKER `B-CI-1`** (§12.8): four test files hard-code a session-specific `SCRATCH_ROOT` under `/tmp/claude-1000/…/build-w2`. `fs.mkdtemp()` on a non-existent parent is `ENOENT`, so `npm test` is **red on any machine but this one** — CI included. Must be fixed *before* the first workflow run | "Green on the first run" is the acceptance bar for §12, and this is the one thing in the repo that guarantees it would not be |
| R3-3 | §7.5 rows **0, 5, 7, 9, 10** behave differently under CI (browser install becomes a cached step; `unshare -rn` is dropped; the preview smoke test is absorbed into Playwright's `webServer`; rows 9–10 are not automatable). Every divergence is enumerated in §12.6 rather than silently ignored | A CI run that quietly skips a checklist row is worse than one that says which rows it does not cover |

No §7.5 row is *weakened* by CI. Row 5's offline guarantee, which locally comes from `unshare -rn`,
comes in CI from the §7.2 #14 import-graph contract test — which is the durable guard anyway (§7.5's
own note), and which row 4 has already run by the time row 5 executes.

### 11.10 Revision 4 — fresh-eyes review 2026-09-02

A senior-engineer pass over the whole repo: read everything, ran the §7.5 checklist, played full
rounds at 360×640 and 1280×800 under a pinned clock, then fixed what was clearly right and inside
the frozen rules. **Nothing in §1.3, §3, §4 or the §5.3.1 DOM contract changed.** Terse index:

| # | Change | Why | Where |
|---|---|---|---|
| R4-1 | Two tabs finishing the same day no longer double-count `played`: `GameStore.onGameEnded()` re-reads `motodle:stats` from the backend before `recordCompletion()` | §4.3's idempotency guard compares `lastCompletedDate`, but each tab handed it its own boot-time snapshot, so the guard never saw the other tab's write | `src/state/game.svelte.ts`, `src/state/game.test.ts` (new) |
| R4-2 | `viewLevel` snaps to `unlockedLevel` after every guess and give-up — i.e. to 5 once the game ends | §5.5 says "snaps to the new `unlockedLevel`"; the store snapped to `guesses.length + 1`, parking a won game on level 3 | same |
| R4-3 | Image stage: the frame's **width** follows the height cap (`width: min(100%, cap × 4/3)`, centred) and the cap is `clamp(120px, 100svh − 500px, 36svh)` instead of a flat `22svh` under 900px | The 100%-wide, height-capped frame letterboxed the crop between grey bars (187 of 336 px was image at 360×640) and shrank a 1280×800 desktop's image to 480×176. Height at 360×640 is unchanged (140 px; the §5.8 no-scroll rule still holds, e2e-verified); 384×288 at 1280×800. §5.8's "sized by viewport width" sentence is superseded by this cap — the size/no-scroll trade-off is flagged for the operator in the review report | `src/components/ImageStage.svelte` |
| R4-4 | Compact-layout breakpoint `max-height: 900px` → `1000px` | Tall phones (412×915) fell into the stacked desktop layout and put the submit button 31 px below the fold | `src/styles/app.css`, `GuessForm.svelte`, `Scoreboard.svelte` |
| R4-5 | Tile fills meet WCAG AA against their white text: green `#3b7d22` (5.1:1, was 3.5), yellow `#946c0a` (4.8:1, was 3.3), colourblind orange `#c2410c` (5.2:1, was 3.6) | 0.85 rem labels at ~3.3:1 fail AA; §5.7's "colour is never the only signal" needs the text to be readable too | `src/styles/tokens.css`, `e2e/colorblind.spec.ts` constants |
| R4-6 | Scoreboard gains a visually-hidden polite live region announcing the latest row ("Guess 2: make Honda close, model CB750 incorrect, year 2000 close.") — `aria-live`, not `role="status"`, so the toast/banner locators stay unambiguous | A screen-reader player submitted a guess and heard nothing | `Scoreboard.svelte` + test |
| R4-7 | Year steppers respond to Enter/Space (one step per press, no key auto-repeat) | They were pointer-only: focusable but inert from the keyboard | `YearInput.svelte` + test |
| R4-8 | StatsModal's Share button renders only once the game has ended (`canShare` prop) | Mid-game it shared a partial grid as "0/15", indistinguishable from a loss; §5.6's "and a Share button" is now read as "once there is a result to share" | `StatsModal.svelte`, `App.svelte` + test |
| R4-9 | `<main>` landmark around the screen; `title` tooltips on the five icon buttons; the theme button's tooltip names the current theme; the practice bar no longer renders "Motodle #" with no number when `?d=` hits a missing puzzle | Landmark navigation; glyph-only buttons were undiscoverable to mouse users | `App.svelte`, `app.css` |
| R4-10 | `index.html`: `description`, `referrer: strict-origin-when-cross-origin`, light/dark `theme-color`, inline-SVG favicon (no `/favicon.ico` 404 on the CDN) | Launch hygiene at zero extra requests; §10.5 unchanged otherwise | `index.html` |
| R4-11 | `loadVersioned` treats a stored non-object (`null`, `42`) as corrupt → fallback | `JSON.parse('null')` came back as the record itself and would have crashed the first `.seenHelp` read | `src/lib/storage.ts` + test |
| R4-12 | Seed catalog: 17 `years` corrections (Monster family still on sale; Sportster `null` → `[1957, null]`; Wide Glide ended 2017; VFR800, YZF-R6, KLX250, 690 Duke, RM250, V7 III ended; KLR650 and Commando 961 back on sale; Varadero from 1999; Nighthawk 250 to 2008; RD250 to 1979; Concours to 2022 to match its ZG1400 name; Vegas to 2017; Ronin from 2022). `docs/CATALOG-REVIEW.md` re-rendered, and a new test pins it to the catalog byte for byte | RULE B hints were wrong for these; the review sheet could drift silently from the catalog | `public/catalog.json`, `docs/CATALOG-REVIEW.md`, `tools/catalog.test.ts` |
| R4-13 | `tools/schedule.ts` validates `--start` (`YYYY-MM-DD`, parseable) before anything runs; `tools/lib/wikimedia.ts` puts a 60 s `AbortSignal.timeout` on every request; `check-budget.ts` uses the frozen `BudgetReport` type instead of a private twin | A bad `--start` produced `NaN-NaN-NaN.json`; a stalled socket hung a walk forever | `tools/` |
| R4-14 | Comments that lied: `stats.ts` and `practice.spec.ts` claimed a `NullStatsSink`. The practice guard is the single `if` in `GameStore.onGameEnded()` — §4.6's "one place, not an `if` at each call site" is met (there is exactly one call site) but not by the named mechanism | Honest docs | `src/lib/stats.ts`, `e2e/practice.spec.ts` |
| R4-15 | The `it.skipIf(!bothExist)` scaffolding in the two no-drift contract tests is gone (a deleted `normalize.ts`/`date.ts` now fails instead of silently skipping); the tautological "abandoned day" test in `stats.test.ts` is removed | Tests that cannot fail are not tests | `schema/*.test.ts`, `src/lib/stats.test.ts` |
| R4-16 | `package.json`: `private: true`, a real `description`, the dead `"main": "index.js"` removed; §1's absolute workstation path replaced | Scaffold residue; a personal path in a doc | `package.json`, this file |

**Known drift left standing (documented, not fixed):** §5.1's no-puzzle countdown is not rendered
(and would mislead once content runs out — tomorrow has no puzzle either); §12.1's
`cancel-in-progress: true` is `github.ref != 'refs/heads/main'` in the real workflow (the workflow
is right — never cancel `main`); §12.2a's `6.*` check is an exact-lockfile match in the workflow
(stricter, also fine); §1.2/§2/§7.1 still carry the pre-R2 combobox wording that §5.3 supersedes.

### 11.11 Revision 5 — deployment 2026-09-02

Adds **§13**, the specification for `infra/` (Terraform), `.github/workflows/deploy.yml`,
`public/404.html` and the CSP-served preview. **§13 supersedes §9.5** — §9.5 stays as written and is
not edited; §13.1 lists every disagreement. Nothing in §1–§8 or §10–§12 changes, with the two small
exceptions noted below. Six things are worth flagging up front:

| # | Change | Why |
|---|---|---|
| R5-1 | New **§13**, structured like §12: topology, the literal HCL for eleven `.tf` files, the literal `deploy.yml`, the literal `404.html`, a numbered operator runbook, a 20-row verification matrix, cost, and workstream **W6** | Deployment is the last unbuilt hook; §9.5 was design-only and predates the domain, the account and the cache classes |
| R5-2 | **`D1` — the bucket policy must grant `s3:ListBucket`, or a missing puzzle returns `403` and the game shows the error screen instead of "No Motodle today"** | AWS's canonical OAC policy grants only `s3:GetObject`, and `GetObject` answers `403` for a missing key without `ListBucket`. `src/lib/puzzle.ts` branches on status **404** alone. Reproduced against the real build. The `403 → 404` safety net (§13.2.6) means the client-facing check alone can't prove the grant exists, so §13.7 splits this into two release gates: **V9a** (bucket policy) and **V9b** (client-facing 404) |
| R5-3 | **§9.5's `/puzzles/YYYY-MM-DD.json` = `immutable, max-age=31536000` is superseded by `max-age=300`** (operator brief), and §9.5's "Correcting a published puzzle" procedure is downgraded from mandatory to optional — a wrong JSON is now fixable by a normal deploy | A 5-minute TTL makes tomorrow's puzzle visible promptly and makes a bad puzzle a commit, not a hand-run invalidation. §9.5's new-prefix trick is still right for *images* |
| R5-4 | **State moved from the brief's S3 backend to HCP Terraform** (org `reenchree`, new workspace `motodle`, execution mode **local**). No state bucket, no bootstrap, no `use_lockfile` | Operator amendment. The workspace must be created with `execution-mode: local` *before* the first `init`, or the plan tries to run on HCP runners with no AWS credentials — §13.6 steps 4–5 |
| R5-5 | The CSP is **verified, not asserted**: `default-src 'none'` plus `script-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data:`, `connect-src 'self'`. Two independent headless probes; a strict `style-src 'self'` produces 5–10 violations from the 6 inline `style=` attributes and the `data:` favicon | §11 R4-10's inline-SVG favicon and §5.3/§5.6's inline style attributes are load-bearing facts about the built app |
| R5-6 | Two small edits outside §13's own files: `vite.config.ts` gains `preview: { headers: … }` so the §7.4 e2e suite runs under the production CSP (a **superset** of §10.3, verified on Vite 8.2.2), and `schema/constants.ts` gains `CONTENT_SECURITY_POLICY` with a no-drift contract test against `infra/variables.tf` | Turns "the CSP works" from a one-off manual probe into something CI re-proves on every run — the §7.2 #10 pattern |

Everything else stands: `ci.yml` is unchanged and keeps `permissions: contents: read` (§12.1); every
write permission lives in the new `deploy.yml`, which only runs after a successful CI run on a push to
`main`. §12.9's "a deploy job — out of scope, deployment needs write permissions this workflow
deliberately does not take" is still correct: the deploy is a **separate** workflow, exactly as that
row anticipated.

### 11.12 Revision 6 — photo credits, code licence, contact URL, deploy doc-drift 2026-09-02

Operator brief of 2026-09-02, after the pre-apply infra review. One new frontend section (**§5.10**),
three small edits to existing sections, and four documentation-drift corrections in §13. **No game
rule, no §1.3 decision, no DOM contract, no scoring, no share text, no storage-schema and no payload
budget changes; the CSP stays byte-identical.** `infra/*.tf` is deliberately **not touched** — a
validated saved plan exists and must stay valid, so every §13 change here is prose.

| # | Change | Where | Why |
|---|---|---|---|
| R6-1 | **§5.10, new**: photo licences and credits — the in-play licence line, the unchanged game-end credit, the `CreditsModal` credits view, and the footer link | §5.10 | Commons photos are CC BY / CC BY-SA / CC0 / PD; the licence has to be visible *while the photo is on screen*, not only after the game ends |
| R6-2 | The in-play line shows **only** `Photo: <license.name>`, linked to `license.url`, and the stage subtree may contain **no** `author`, `fileTitle`, `descriptionUrl` or `creditNote` — attributes included | §5.10.1, §7.3 (`ImageStage` row) | A Commons file title is typically `File:2004 Suzuki GSXR-750 Left SIde.jpg`: showing it during play hands over the answer |
| R6-3 | It lives **in the scrub row**, not in a row of its own — measured against the running build: submit-button bottom is **612.9 px vs a 640 px viewport before and after** at 360×640, and unmoved at 375×667, 412×915 and 768×1024; the 27.1 px of slack is untouched and the scrub segments stay exactly 44×44 | §5.10.2 | §5.8's fold rule is frozen and `e2e/mobile-layout.spec.ts` enforces it. The two alternatives were measured and rejected: a new row costs ~25 px of a 27.1 px budget, and paying for it by moving `--stage-max-h`'s `100svh − 500px` term to `− 525px` hits the clamp's 120 px floor at 640 svh and gives back only 20 px |
| R6-4 | New `CreditsModal.svelte` (a 12th component, extending §5.2's list) + new pure module `src/lib/credits.ts`; manifest-driven, on-demand puzzle fetches, **20 per batch** behind `Show more`, missing days skipped silently, `puzzleCache` so re-opening fetches nothing | §5.10.4 | `manifest.json` is answer-free (§3.3) and the credit lives in the per-day JSON, so the view has to join them at runtime. Batching is what keeps a year of puzzles at 20 requests instead of 365 |
| R6-5 | **The spoiler rule is one pure function**, `eligibleCreditDates()`: strictly-past days always, today only when today's **real** (never practice) game has ended, a future day never | §5.10.4, §7.3 | Every credit row carries the answer. §4.6's practice/archive isolation is otherwise untouched, and `ArchiveList` keeps its own filter |
| R6-6 | Footer becomes `Photos: Wikimedia Commons, Creative Commons licences · Photo credits`; the same view is reachable from `ResultModal` | §5.10.3, §5.10.5 | Two entry points, one view. Measured: the taller footer moves the submit button by **0.0 px** at all four viewports — `.app-column` is a flex column whose footer carries `margin-top: auto`, and at 360×640 the content already overflows it |
| R6-7 | Tests: `ImageStage`, `ResultModal` and a new `CreditsModal` row in **§7.3**, plus `src/lib/credits.test.ts` and a store-level fetch-count test; e2e items **13–15** in §7.4 (licence chip + whole-page spoiler assertion, the credits view after a win listing day #1 and **not** days #2/#3, and the fold rule re-asserted with the chip present) | §7.3, §7.4 | The spoiler rules and the fold rule are both the kind of thing that regresses silently |
| R6-8 | **Code licence = MIT.** `LICENSE` (MIT, "Copyright (c) 2026 Chris Wallace"), `package.json` `"license": "MIT"`, `package-lock.json` `packages[""].license` hand-edited to match (`npm ci` does not compare it), README's licence paragraph names it | repo files, not §1.3 | The repo shipped `"license": "ISC"` from `npm init` with no `LICENSE` file. §6.5a already says the repo's own licence does not extend to the images — that stays true and `docs/ATTRIBUTION.md` stays the photo record |
| R6-9 | **Wikimedia contact URL = `https://playmotodle.com`** (was the GitHub repo URL), in `DEFAULT_UA_CONTACT` and the literal fixture strings in `tools/fetch.test.ts`, `tools/schedule.test.ts`, `schema/validate.test.ts`; the fail-fast checks and the no-`@` test are unchanged | §1.3 D5, §3.4, §6.8, §11.6 Q5 | The repo is **private**, so a Wikimedia operator following the old contact URL gets a 404 — worse than no URL under their UA policy |
| R6-10 | **§13.4's `deploy.yml` block now matches the shipped file byte-for-byte**, including the `vars.AWS_DEPLOY_ROLE_ARN != '' && (…)` pre-provisioning guard; item 1's "three conditions" becomes **four**, and §13.7's row-3 assertion gained the guard as a fifth substring | §13.4, §13.7 | The plan block was the pre-guard draft. A verification matrix that doesn't assert the guard would let a later edit drop it silently |
| R6-11 | **§13.6 step 9.5 rewritten** from "nothing has been pushed yet" to a *check*: `deploy.yml` is already on `main` (commit `7c43481`, CI green, the `Deploy` run **skipped** by the guard), so after the variables are set, run `gh workflow run deploy.yml` or `gh run rerun <skipped-run-id>`. Step 10's "may already have triggered and failed" wording corrected to "skipped, not failed" | §13.6 | The runbook described a repository state that no longer exists |
| R6-12 | **§9.5 gets a one-line superseded banner** at its top | §9.5 | §11 R5's "supersede, don't scatter-edit" convention only works if the superseded section says so where a reader lands |
| R6-13 | **The "reaper race" recorded as an accepted limitation**: pass G's `--delete` can remove a hashed bundle that a PoP still serving the previous `index.html` (`s-maxage=60`) references, for up to a minute after a deploy. Mitigation, if it ever matters: `--exclude "assets/*"` on pass G plus occasional manual pruning | §13.8 | Found in the pre-apply infra review. It is a real, bounded exposure and belongs in the accepted-trade-offs list, not in a review comment that disappears |

**Explicitly not done.** No new `§1.3` decision row (the §13.1 D-numbers already occupy `D8`–`D10`
and a second `D8` would make every "(D8)" citation ambiguous) — R6-8's MIT decision is recorded here
and in the README instead. No CSP edit: the credits view fetches same-origin `/puzzles/*.json` under
the existing `connect-src 'self'` and adds only `<a>` navigations, so §13.2.6's policy string and
`schema/constants.ts` stay byte-identical. No `infra/*.tf` edit of any kind.

### 11.13 Revision 8 — guess-form layout, tagline, US English 2026-09-03

User feedback on the live site, 2026-09-03. Three changes, all **presentation and copy**: no game
rule, no scoring, no storage schema, no payload budget, no CSP, no `infra/**`, no `.github/**` and no
`schema/constants.ts` is touched. *(Revision 7 is the R7 deploy-trust note at the head of §11, which
was an `infra/` fix and got no section of its own.)*

| # | Change | Sections |
|---|---|---|
| R8-1 | **New §5.11 — the guess form is one two-column grid at every width** (Make \| Model, then Year \| Guess, then a quiet Give up under a hairline). Deletes the `@media (max-height: 1000px)` *layout* branch in `GuessForm.svelte`, the four wrapper divs, the hidden `Year` label, the native number spinner and the `opacity: 0.5` disabled skin. Adds one app-wide `:focus-visible` ring. | new §5.11; §5.3.4, §5.3.5, §5.4, §5.7 amended |
| R8-2 | **Errors and the `Locked` chip move onto their field's label line**, which exists in every state — so a validation message costs **zero** layout and the form never shifts. `GuessForm` owns all three messages; `YearInput` drops `invalidMessage`. | §5.11.3, §5.11.4; §5.3.4, §5.4, §7.3 |
| R8-3 | **The fold rule is improved, not merely preserved**: at 360×640 the submit button's bottom goes 612.9 → **575.5** against a 640 px viewport (slack 27.1 → 64.5 px), measured on the real build at six viewports, in the clean, invalid, locked and give-up-confirmation states. 320×568, which **failed** the rule before, now passes. `--stage-max-h` is untouched, so the photo does not get smaller at any viewport. | §5.11.5; §5.10.2 annotated |
| R8-4 | **New §5.12 — one tagline everywhere**: *"Guess the motorbike in 5 tries. A new motorbike is available each day."* Replaces the `index.html` meta description, the HelpModal intro and the README's first sentence; added to §10.5's head snippet. The How-to-play rules table, the scoring table and the midnight line are unchanged. | new §5.12; §5.6, §10.5 |
| R8-5 | **New §5.13 — US English for every user-facing string.** Six rendered strings change (two `aria-label`/`title` pairs on the colorblind toggle, the footer's *Creative Commons licenses*, the credits intro, the `Tile colors` heading, the photo-license `aria-label`); seven test/e2e assertions move with them. Code identifiers, DOM ids (`#mtd-photo-licence`), CSS class names, comments and Wikimedia license *names* are explicitly out of scope. | new §5.13; §5.6, §5.7, §5.10.1, §5.10.4, §5.10.5 quotes updated |
| R8-6 | **The DOM contract is byte-identical.** `#mtd-make` / `#mtd-model` / `#mtd-year`, option values = catalog ids, the label texts `Make` / `Model` / `Year`, the accessible names `Guess {n} of 5` / `Give up` / `Confirm` / `Cancel`, the `mtd-*-error` ids, the `.lock-chip` element and its `Locked` text all survive verbatim — which is why `GuessForm.test.ts` and `playthrough.spec.ts` need **no** edit. | §5.3.1 unchanged; §5.11.3, §5.11.7 |

**Two follow-ups left standing, both recorded with their numbers rather than done:** the recovered
fold slack could buy the 360×640 photo +30 px via `--stage-max-h: clamp(120px, 100svh - 470px, 36svh)`
(§5.11.6), and the UK spellings left in *test names* and source comments are optional tidying
(§5.13). Neither blocks anything.

### 11.14 Revision 9 — the zoom schedule 2026-09-03

User feedback on the live site, 2026-09-03: *"The images should be much more cropped at first. Maybe
zoom out logarithmically — worth a try."* One change, in one constant plus three fixture overrides.
**No game rule, no scoring, no storage schema, no DOM contract, no UI layout, no CSP, no `infra/**`,
no `.github/**`, and no budget value changes.** The full design, with the rendered evidence it was
decided from, is **§4.7a**.

| # | Change | Sections |
|---|---|---|
| R9-1 | **`DEFAULT_CROP_FRACTIONS` becomes a geometric sequence, `[0.11, 0.19, 0.32, 0.55, 0.95]`** (`r = (0.95/0.11)^(1/4) = 1.714`, 2 dp). Level 5 is the same 0.95 full view; level 1 shows **46 % less area** than the old 0.15 and every step now opens up by the same multiple instead of 1.67→1.53. | new §4.7a; §4.7 |
| R9-2 | **`MIN_LEVEL1_PX` 280 → 240**, so the tighter `f1` does not price out ordinary sources. Decided from a fixed-field-of-view resolution ladder (180/220/240/280/360/480 px, each painted at 720 device px = 360 CSS px on a DPR-2 phone): 240 and 280 are indistinguishable, 220 is on the slope, 180 smears. | §4.7, §4.7a (b) |
| R9-3 | **No level-1 upscale.** `withoutEnlargement: true` stays and **`tools/crop.ts`'s geometry is unchanged** — the browser already upscales a 240 px level 1 ~3×, so a pipeline upscale would add bytes, no information, and would make `levels[].w` lie. | §4.7, §4.7a (c) |
| R9-4 | **`MIN_SOURCE_WIDTH` 1867 → 2182** (derived, `ceil(240/0.11)`). Estimated to admit **92–95 %** of the 2000–6000 px band the brief names, against 100 % before; the assumption is stated because the §6 recon carries no width histogram. Nothing is binned — §3.4's warn-and-pend rule is unchanged, so those candidates route to operator review with a required override. | §1.1 C4, §4.7, §4.7a (d), §6.2 |
| R9-5 | **All three fixture overrides re-derived on the same rule** (`f5` unchanged, `f1` at the new floor, geometric between): F1 `[0.30,0.41,0.55,0.74,1.00]`, F2 `[0.25,0.35,0.49,0.69,0.96]`, F3 `[0.17,0.26,0.40,0.62,0.96]`. Fixture 3 still exhibits the `levels[].w` tie the contract cites (level-4 rect 901 px). | §3.1, §6.9, §4.7a |
| R9-6 | **Fixture 1's `focus` moves to `{0.30, 0.68}`.** Its 800 px source floors `f1` at 0.30, and at the old focus that crop still frames the SUZUKI wordmark on level 1. Accepted cost: levels 3–4 now show the boxes at frame left. `focus` **semantics** are untouched — this is one operator value. | §6.9, §4.7a |
| R9-7 | **New contract test §7.2 #15 — `cropFractions` must be geometric** (each ratio within ±3 % of `(f[4]/f[0])^(1/4)`). Strictly-increasing alone permits exactly the front-loaded ladder this revision removes; this is what stops the next hand-typed override from reverting it. | §3.1, §7.2 |
| R9-8 | **Every day payload gets smaller** — 32.8 %→25.2 %, 82.9 %→**69.0 %**, 56.5 %→46.5 % of `DAY_BUDGET_BYTES`; ≈ 115 KB less committed WebP. Quality search still settles at q = 80 for all three. No budget constant changes. | §5.9, §4.7a |
| R9-9 | **E2E is untouched.** The scrub is asserted by accessible name and `aria-current`, never by pixel size; `ImageStage` sizes its frame from `--stage-max-h` in CSS, so a different intrinsic `levels[].w/h` moves no layout. `tools/crop.test.ts` is the only test file whose *assertions* change; `fetch.test.ts` needs its 2000×1500 "no warning" case raised to 2400×1800, which is semantically correct rather than a workaround. | §4.7a, §7.4 |

**One consequence recorded rather than coded:** at `f1 = 0.11` the **focus point is load-bearing** —
a focus parked mid-fairing yields a level 1 that is a colour field, which the 916's shipped
`{0.56, 0.55}` demonstrates. §6.3's review loop should place `focus` on structure (wheel, engine,
frame, headlight, tail). Operator guidance; no code change.

**The fallback, with its number, if 2182 ever proves too tight in the field:** `f1 = 0.12` keeps the
rule, gives `r = 1.677`, and lands `MIN_SOURCE_WIDTH` on exactly **2000** — the bottom of the stated
band. It was not chosen because 0.11 cleared the legibility bar with margin.

---

---

### 11.15 Revision 10 — the Impeccable design pass 2026-09-03

Operator ask: *"add impeccable style to the project."* Applied Impeccable v4.1.3
(`.claude/skills/impeccable`) in its recommended order for an existing project — `init` → `document`
→ critique → polish/typeset/layout/colorize → audit. This entry records the **init + document** phase
and the brief it produced; the implementation lands against §5.14.

**No game rule, no score, no lock, no share text, no storage schema, no DOM contract, no copy, no
CSP, no `infra/**`, no `.github/**`, no `tools/**`, no `public/puzzles/**` and no budget value
changes.** This is a presentation-layer revision.

| # | Change | Sections |
|---|---|---|
| R10-1 | **`PRODUCT.md` (new, repo root)** — durable product truth: users, purpose, positioning, operating context, capabilities and constraints, brand commitments, evidence on hand, five product principles, accessibility. Impeccable's interview could not run (no question tool, no decision-page channel in this session), so every fact is inferred from the operator's brief and the repo, and the inferred ones are marked **[assumed]** for correction. | new file; §5.14.0 |
| R10-2 | **`DESIGN.md` (new, repo root)** — a Google-Stitch-format scan of the visual system **as built on 2026-09-03**: YAML token frontmatter plus Overview / Colors / Typography / Layout / Elevation & Depth / Shapes / Components / Do's and Don'ts. It documents the baseline, not the target, and must be regenerated once §5.14 is implemented. The `.impeccable/design.json` sidecar was **not** written (out of this pass's writable file set). | new file; §5.14.0 |
| R10-3 | **§5.14 (new) — the design brief**: direction, type system, color system with computed contrast, space/shape/elevation, motion, a component-by-component change list, the explicit do-not-change list, and the verification gate. | §5.14 |
| R10-4 | **Baseline evidence captured**: `npm run build` (CSS **3.92 KB** gz of 20, JS **29.54 KB** gz of 60), 90 screenshots (15 states × 2 viewports × 3 themes), measured fold slack at 360×640 (**64.5 px**), and measured photo-frame sizes at five viewports (140 / 274.5 / 360 / 288 / 360 px tall) which become the floor no later change may regress. Screenshots: `…/852d5747-63d4-4155-bc73-5cf062e93be6/scratchpad/shots/`. | §5.14.1 |
| R10-5 | **Detector baseline**: the static pass (`detect.mjs src index.html public/404.html`) returned **zero findings** before `DESIGN.md` existed, and **12 advisory design-system-drift findings** after it (eleven off-ramp `font-size` literals — `0.65`/`0.8`/`0.9`/`1.1`/`1.4 rem` — plus one color and one radius in `public/404.html`); exit code is still 0, since advisories never fail. The rendered/URL pass could not run — it requires `puppeteer`, absent and unfetchable offline — so the render was critiqued by eye against the same rule list (findings C1–C14). | §5.14.1, §5.14.9 |
| R10-6 | **Two accessibility defects found in the current theme tokens**, both fixed by §5.14.4: the app accent `#2563eb` is **1.3:1** against the colorblind "close" fill `#1d4ed8` (action and state are the same blue in colorblind mode), and the colorblind "wrong" fill `#17171a` is **1.04:1** against the dark ground `#121214` (the plate is invisible in dark + colorblind; only its glyph and label show). | §5.7, §5.14.1 C3/C4, §5.14.4 |
| R10-7 | **One copy-truncation defect**: at 360×640 the give-up confirmation renders `Give up? This count…` because §5.11.4's `max-height: 700px` block sets `white-space: nowrap` + ellipsis on it. §5.14.7 item 7 lets it wrap instead; the submit button's position — the only contractual one — is unaffected. | §5.11.4, §5.14.1 C8 |
| R10-8 | **`e2e/colorblind.spec.ts` pins two hex values verbatim** (`#3b7d22` base green, `#c2410c` colorblind green, asserted in light *and* dark). §5.14.4 therefore freezes those two fills and moves only the other four. Any future palette work that wants them must edit that spec deliberately. | §7.4, §5.14.4 |
| R10-9 | **Recorded, not coded — a spec/implementation gap**: §5.1 specifies a next-midnight countdown on the "No puzzle today" screen and the implementation does not render one. It adds behavior, so §5.14 leaves it **operator-gated** rather than folding it into a presentation pass. | §5.1, §5.14.1 C13 |
| R10-10 | **No webfont, stated loudly.** `CONTENT_SECURITY_POLICY` already contains `font-src 'self'`, so a self-hosted subset would need **no** `schema/constants.ts` and **no** `infra/variables.tf` edit; what blocks it is that this session had no network and the repo has no `.woff2` to subset. The design is built to look deliberate on the system stack, with `--font-numeric` (a system mono stack) added as a data voice. A webfont stays a later, optional revision under the operator's ≤ 60 KB / `font-display: swap` / preload rules. | §5.8, §5.14.3 |

**Follow-ups this revision deliberately leaves open:** regenerate `DESIGN.md` + write
`.impeccable/design.json` after implementation; update §10.5's head snippet if `index.html`'s
`theme-color` / favicon change (§5.14.7 item 17); decide the operator-gated countdown (R10-9); and
decide whether the wide-viewport two-column composition (§5.14.7 item 4, P2) ships or the pass keeps
the single column with a larger photo.

---

## 12. Continuous integration

**Deliverable:** exactly one new file, `.github/workflows/ci.yml` (the repo has no `.github/` yet),
plus a one-line badge edit at the top of `README.md` (§12.7). Nothing else in the repo changes —
**no linter, no formatter, no coverage threshold, no config edits**. §12.9 lists the tools that were
considered and deliberately *not* added.

**Acceptance:** the first push runs green, in **under ~6 minutes** wall time, with `permissions:
contents: read`.

### 12.1 Shape — triggers, permissions, concurrency, one job

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    runs-on: ubuntu-24.04
    timeout-minutes: 12
```

Decisions, each with its reason:

- **`push: branches: [main]` + bare `pull_request`.** No branch filter on `pull_request` (it defaults
  to every target branch), and `push` restricted to `main` so a PR branch is **not** built twice —
  the classic duplicate-run waste. A PR is verified by the `pull_request` event; the merge is
  verified by the `push` event.
- **`permissions: contents: read`**, declared at workflow level so every job inherits it. The workflow
  reads code and writes nothing back — no releases, no gh-pages, no PR comments. It does not need
  `actions: write` (the cache action works with the default token under `contents: read`).
- **`concurrency` keyed on `${{ github.workflow }}-${{ github.ref }}`**, `cancel-in-progress: true`.
  Per-ref: a force-push to a PR cancels that PR's in-flight run, and never cancels `main`'s.
- **`runs-on: ubuntu-24.04`, pinned, not `ubuntu-latest`.** `ubuntu-latest` *is* 24.04 today, but the
  §7.5 row-5 byte-identity gate depends on a fixed `sharp`/libvips build (§12.4); a silent runner-image
  migration is exactly the kind of change that should be a deliberate one-line edit, not a surprise.
- **One job, not two.** The e2e half cannot start until `dist/` exists (`playwright.config.ts`'s
  `webServer.command` is `npx vite preview`, which serves `dist/`), so a parallel `e2e` job would have
  to repeat `npm ci` (~35 s) **and** `npm run build` (~20 s), or upload/download `dist/` +
  `node_modules/` as an artifact (~40 s each way). Both cost more than the ~90 s of e2e they would
  overlap. The suite is also `fullyParallel: false, workers: 1` (§7.4), so there is no shard to split
  either. **Revisit only if the e2e step passes ~3 minutes**, at which point the honest fix is
  `workers: 2` in `playwright.config.ts`, not a second job.
- **`timeout-minutes: 12`** on the job — a hard stop at roughly 2× the ~5 min target, generous enough
  that a cold Playwright cache (§12.3) does not trip it, tight enough that a hung `webServer` fails in
  minutes rather than burning the 360-minute default.

### 12.2 Steps, in order, mapped to the §7.5 rows

Each row of this table is one step in `ci.yml`, in this order. The **Row** column is the §7.5
acceptance-checklist row the step discharges.

| # | Step (`name`) | Command | Row | Notes |
|---|---|---|---|---|
| 1 | Checkout | `actions/checkout@v5` | — | Default `fetch-depth: 1` is enough: the row-5 gate diffs the **working tree against `HEAD`**, not against history. No `lfs:` — the repo uses none (no `.gitattributes`; `fixtures/images/*.jpg` and `public/puzzles/img/**/*.webp` are plain committed blobs). |
| 2 | Setup Node | `actions/setup-node@v5` with `node-version: '22'`, `cache: 'npm'` | 1 (prep) | Node 22 matches the verified local toolchain (v22.23.2). `cache: 'npm'` keys the **npm download cache** (`~/.npm`) on `package-lock.json`'s hash automatically — it does **not** cache `node_modules/`, which is correct: `npm ci` must keep deleting and rebuilding the tree. |
| 3 | Install | `npm ci --no-audit --no-fund` (piped to a log, see §12.2a) | **1** | `ci`, never `install` (§7.5 row 1, §10.1). |
| 4 | Assert no ERESOLVE / TypeScript 6 | see §12.2a | **1** | The C5 TS-7 trap. |
| 5 | svelte-check | `npx svelte-check --tsconfig ./tsconfig.json` | **2** | Run separately from `tsc`, **not** as `npm run check`, so the Actions log shows which of the two failed. |
| 6 | tsc | `npx tsc --noEmit` | **3** | |
| 7 | Unit + contract + component + two-timezone tests | `npm test` | **4** | Runs `test:unit` then `test:tz` (§10.2) — the `America/Los_Angeles` + `Australia/Lord_Howe` pair is two extra processes, ~10 s. `tzdata` is present on the runner image; no setup needed. |
| 8 | Generate + idempotency gate | see §12.4 | **5** | |
| 9 | Build + payload budgets | `npm run build` | **6** | `vite build && tsx tools/check-budget.ts` (§5.9). **Must precede step 11** — Playwright's `webServer` serves `dist/`. |
| 10 | Playwright browser (version, cache, install) | three steps, see §12.3 | **0** | |
| 11 | E2E | see §12.5 | **7 + 8** | |
| 12 | Upload Playwright report on failure | `actions/upload-artifact@v4`, `if:` guarded | — | §12.5. |

§7.5 rows **9** (offline `npm run dev`) and **10** (operator plays a round by hand) are **not** run in
CI — see §12.6.

#### 12.2a Steps 3–4 verbatim — the C5 guard

Row 1 has two assertions beyond "exit 0": *no `ERESOLVE` warning*, and *TypeScript resolves to 6.x*.
Both are the same trap (C5: `typescript@7.0.2` hard-crashes `svelte-check` 4.7.6, and npm's warning
text is actively misleading). Neither is checkable by exit code alone, so:

```yaml
      - name: Install (npm ci)
        run: |
          set -o pipefail
          npm ci --no-audit --no-fund 2>&1 | tee /tmp/npm-ci.log

      - name: Assert clean resolution (C5 guard)
        run: |
          if grep -q ERESOLVE /tmp/npm-ci.log; then
            echo "::error::npm ci emitted ERESOLVE — see plan §10.1 C5 (the TypeScript 7 trap)"
            exit 1
          fi
          ts=$(node -p "JSON.parse(require('node:fs').readFileSync('node_modules/typescript/package.json','utf8')).version")
          echo "typescript: $ts"
          case "$ts" in
            6.*) ;;
            *) echo "::error::typescript resolved to $ts, expected 6.x (plan §10.1 C5)"; exit 1 ;;
          esac
```

Three details that are not incidental:

1. **`set -o pipefail` is mandatory.** GitHub's default shell for `run:` is `bash -e {0}` — `-e` but
   **not** `-o pipefail` — so `npm ci | tee` would report `tee`'s exit code and a failed install would
   pass. (`shell: bash` would give pipefail for free, but stating it explicitly documents the intent.)
2. **`grep` reads a file, never a pipe.** Per the workspace's own `pipefail + grep -q` lesson,
   `npm ci … | grep -q ERESOLVE` makes `grep -q` `SIGPIPE` the producer the moment it matches. Capture
   to `/tmp/npm-ci.log` first, then grep the file.
3. **Read `typescript/package.json` off disk, not via `require('typescript/package.json')`** — §10.7
   gotcha 6: strict `exports` maps make that throw `ERR_PACKAGE_PATH_NOT_EXPORTED`. And **do not** use
   `npm ls typescript`: §10.7 gotcha 7 documents `npm ls` exiting non-zero over benign
   `@img/sharp-wasm32` / `@emnapi/runtime` / `tslib` optional-dependency residue, which is a false red
   waiting to happen. The `case 6.*` match — rather than a literal `6.0.3` — keeps an intended future
   patch bump from turning CI red while still catching the only failure that matters (a 7.x resolve).

### 12.3 Playwright browser cache — step 10, three parts

`npm ci` never fetches browsers (§7.5 row 0), so this is required, and it is the one step whose cost
varies. Cache path `~/.cache/ms-playwright`, keyed on the **exact** `@playwright/test` version read
from the lockfile:

```yaml
      - name: Resolve Playwright version
        id: pw
        run: |
          echo "version=$(jq -r '.packages["node_modules/@playwright/test"].version' package-lock.json)" >> "$GITHUB_OUTPUT"

      - name: Cache Playwright browsers
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: ${{ runner.os }}-playwright-${{ steps.pw.outputs.version }}

      - name: Install Playwright chromium
        run: npx playwright install --with-deps chromium
```

- **The key is computed from `package-lock.json`, not `package.json`.** `package.json` says
  `^1.62.1` — a range, which would keep a stale browser build alive across a minor bump and produce
  the "Executable doesn't exist at …/chromium-XXXX" failure. The lockfile says `1.62.1`, exactly.
  `jq` is preinstalled on the runner image and this step runs after checkout, so no ordering trap.
  (`node -p "require('./package-lock.json')…"` returns the same string and is a valid fallback; `jq`
  is preferred because it does not depend on how Node treats `--eval` under `"type": "module"`.)
- **`${{ runner.os }}-playwright-<version>`, and no `restore-keys`.** A partial restore from a
  *different* Playwright version is worse than a miss: it populates the cache directory with a browser
  revision this version will not use, `playwright install` downloads the right one anyway, and the
  saved cache then carries both. Exact key or nothing.
- **`--with-deps` runs unconditionally, even on a cache hit** — and it is *not* redundant. The cache
  holds the browser bundle under `~/.cache/ms-playwright`; it does **not** hold the system libraries
  `install-deps` installs via `apt-get`, which live in `/usr/lib` and are not part of any cached path.
  On a hit, `playwright install` sees the browser already present and skips the ~130 MB download,
  leaving only the apt half (~15–25 s). On a miss it does both (~45–60 s). This is why the step is not
  wrapped in `if: steps.cache.outputs.cache-hit != 'true'`.
- **`--with-deps` needs the runner's `apt`**, i.e. passwordless `sudo`. That is available on
  GitHub-hosted runners and is the reason this flag appears in CI and never in a local instruction
  (§12.6, and the workflow's "no sudo" rail applies to the operator's machine, not the ephemeral VM).
- **`chromium` only.** `playwright.config.ts` declares exactly one project, `chromium`. Installing all
  three engines would triple the cold cost for browsers nothing runs.

### 12.4 The generate idempotency gate — step 8

```yaml
      - name: Generate (offline) and prove the committed output is byte-identical
        run: |
          npm run generate
          git diff --exit-code -- public/puzzles docs/ATTRIBUTION.md
          untracked=$(git status --porcelain --untracked-files=all -- public/puzzles docs/ATTRIBUTION.md)
          if [ -n "$untracked" ]; then
            echo "::error::generate produced files that are not committed:"
            echo "$untracked"
            exit 1
          fi
```

- **`npm run generate` is `tsx tools/generate.ts`, no arguments** (§6.1). Its only inputs are
  `fixtures/fixtures.json` and `fixtures/images/*` — both committed, neither touched by `.gitignore`
  (which ignores only `node_modules/`, `dist/`, `.cache/`, `data/*`, `test-results/`,
  `playwright-report/`). It writes `public/puzzles/**` (3 JSON + `manifest.json` + 18 WebPs across
  `img/0001…0003/`) and `docs/ATTRIBUTION.md`, wholesale, every run.
- **`git diff --exit-code -- public/puzzles docs/ATTRIBUTION.md`** — scoped to exactly the paths
  `generate` owns. Scoped, not bare, on purpose: a bare `git diff --exit-code` would also fail on any
  unrelated tree dirt (and would say nothing useful about *which* contract broke). `--exit-code` makes
  `git` exit 1 on any difference and prints the diff into the log, which for the JSON files is
  directly readable; for the WebPs git prints `Binary files … differ`, which is the signal the
  encoder drifted.
- **The second half is not optional.** `git diff` only compares *tracked* paths — a `generate` that
  emitted a **new** file (say `img/0004/l1.webp`) would leave `git diff` clean and the gate would pass
  on output nobody committed. `git status --porcelain --untracked-files=all`, scoped the same way,
  closes that hole.
- **Determinism across machines.** §7.5's note is explicit that byte-identity holds only for a fixed
  `sharp`/libvips build. The lockfile pins `sharp` 0.35.4 → `@img/sharp-linux-x64` 0.35.4 →
  `@img/sharp-libvips-linux-x64` 1.3.3, and both the local host and the runner are glibc `x86_64`, so
  both resolve the same prebuilt binary and the same libvips 8.18.6. **This is the workflow's one
  environment-coupled step**; if a future `sharp` bump makes it red on a diff no human authored, the
  correct response is the one §7.5 already prescribes — demote the gate to "schema + budget valid"
  (which the `schema/*.test.ts` suite in row 4 already enforces) — **not** to weaken the contract
  tests.
- **No `unshare -rn`.** See §12.6.

### 12.5 E2E and the failure artifact — steps 11–12

```yaml
      - name: E2E (Playwright chromium)
        id: e2e
        timeout-minutes: 6
        run: npm run test:e2e -- --reporter=list,html --trace=retain-on-failure

      - name: Upload Playwright report
        if: ${{ !cancelled() && steps.e2e.outcome == 'failure' }}
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: |
            playwright-report/
            test-results/
          retention-days: 7
          if-no-files-found: ignore
```

- **The two CLI overrides exist so that no config file has to change.** `playwright.config.ts` ships
  `reporter: 'list'` and `trace: 'on-first-retry'` with no `retries`, which in CI means *no HTML report
  is ever written and no trace is ever captured* — there is nothing to upload. `--reporter=list,html`
  keeps the streaming console output **and** writes `playwright-report/`;
  `--trace=retain-on-failure` captures a trace for failing tests without introducing retries (retries
  would mask flake, which is the opposite of what this suite is for). Both are flags, not edits: the
  local `npm run test:e2e` behaviour is untouched.
- **The HTML reporter does not try to open a browser here.** Its `open: 'on-failure'` default is
  suppressed whenever `process.env.CI` is set, which GitHub Actions sets for every step.
- **`npm run test:e2e -- <flags>`**, with the `--` separator, so npm forwards them to
  `playwright test` rather than consuming them.
- **`steps.e2e.outcome == 'failure'`, not a bare `if: failure()`.** A bare `failure()` would fire when
  `svelte-check` or the budget check failed, uploading an empty or stale report. `!cancelled()` keeps
  a cancelled run (concurrency, §12.1) from producing a junk artifact.
- **`if-no-files-found: ignore`** because `test-results/` exists only when something failed; without
  it, upload-artifact warns on every partial upload.
- **Both directories are already in `.gitignore`**, so they cannot dirty the row-5 gate — which is
  moot anyway, since the gate runs three steps earlier.
- **`timeout-minutes: 6`** on this step alone: it is the only step that can hang (a `webServer` that
  never binds), and the job-level 12 is too coarse to fail fast.
- **`workers: 1` and `reuseExistingServer: !process.env.CI` are both already correct for a runner.**
  `CI` is set, so Playwright always starts its **own** `vite preview` on `127.0.0.1:4173` rather than
  adopting a stray one — and the runner has no stray one. The `--host 127.0.0.1` in
  `webServer.command` is the §10.7-gotcha-1 fix and is exactly as necessary on the runner (Playwright
  polls `http://127.0.0.1:4173`, which an IPv6-only bind would never answer). `webServer.timeout` of
  60 s is ample for `vite preview` over a pre-built `dist/`.

**Clock pinning — verified, not assumed.** Every spec in `e2e/` calls `page.clock.install(...)` (or
`pauseAt`) before its first `page.goto`, with dates from `e2e/helpers.ts`: `blocked-submit`,
`colorblind`, `giveup`, `loss`, `mobile-layout`, `playthrough`, `rollover` pin `DAY1` (2026-09-02);
`practice` pins `NO_PUZZLE_DAY` (2099-01-01). `localTime()` builds a **local** wall-clock `Date` with
no `Z` suffix, matching `todayKey()`'s semantics (§4.1). Consequences for CI, both good: the suite
does **not** depend on the runner's clock or on `TZ` (runners are UTC; the specs never assume
otherwise), and it will not start failing on 2026-09-05 the way an unpinned suite would.

### 12.6 Where CI differs from the §7.5 local checklist

| §7.5 row | Local | CI | Why the difference is safe |
|---|---|---|---|
| **0** — `npx playwright install chromium` | One-time, manual; a no-op once `~/.cache/ms-playwright` is warm | A cached step running `--with-deps` every time (§12.3) | The runner is ephemeral: there is no "one-time". `--with-deps` adds the apt libraries a fresh VM lacks and a local Debian workstation already has. |
| **1** | `npm ci`, eyeball the output for `ERESOLVE`, `npm ls typescript` | `npm ci` + a scripted grep + an on-disk version read (§12.2a) | Machine-checkable versions of the same two assertions; both local forms are non-mechanical or (per §10.7 gotcha 7) false-red-prone. |
| **5** — `unshare -rn npm run generate` | `unshare -rn` proves "no network" mechanically | **Plain `npm run generate`**, plus the diff gate | Two reasons. (a) Ubuntu 24.04 restricts unprivileged user namespaces by AppArmor (`kernel.apparmor_restrict_unprivileged_userns=1`), so `unshare -rn` is unreliable on this image — and "wrap it in `sudo`" would defeat the point. (b) It is redundant here: `generate`'s offline guarantee is **structural**, proved statically by the §7.2 #14 import-graph contract test, which row 4 ran one step earlier. §7.5 itself says the contract test is the durable guard. |
| **7** — `npm run preview` + `curl` for a 200 | A separate manual step | **Absorbed into row 8** | Playwright's `webServer` starts the identical command (`npx vite preview --port 4173 --strictPort --host 127.0.0.1`) and blocks until `http://127.0.0.1:4173` answers, failing the step if it does not. A standalone `curl` step would start a second server on a `--strictPort` port and fail. The row is *covered*, not skipped. |
| **9** — offline `npm run dev` in a namespace | Runs, needs `ip link set lo up` and an in-namespace browser | **Not run** | Same userns restriction as row 5, and the check's real content — "the app works with no network" — needs a browser *inside* the namespace to be meaningful. Rows 4, 5 and 8 already cover offline generation, contract validity and a full in-browser playthrough against a local `vite preview`. |
| **10** — operator plays a round by hand | The final gate, includes 360×640 **with the on-screen keyboard open** | **Not run — by definition** | §5.8 states headless Chromium cannot simulate the keyboard-open viewport. `e2e/mobile-layout.spec.ts` covers the unfocused 360×640 case; the keyboard case stays a human gate. CI does not claim it. |

Everything else — rows 2, 3, 4, 6, 8 — is the *same command* locally and in CI.

### 12.7 README badge

Immediately under the `# Motodle` H1, before the description paragraph:

```markdown
[![CI](https://github.com/reenchree/motodle/actions/workflows/ci.yml/badge.svg)](https://github.com/reenchree/motodle/actions/workflows/ci.yml)
```

- The path segment is the **workflow file name** (`ci.yml`), not the `name:` field — GitHub accepts
  either, but the filename is stable across a rename of the workflow's display name.
- Default branch only. Add `?branch=<name>` only if a release branch ever appears; it does not exist.
- **The repo is private**, so the badge image renders only for viewers authenticated with access;
  an anonymous or logged-out viewer sees a broken image. That is expected and is not a reason to
  route the badge through a third-party shield.
- While at it, `README.md`'s §7.5 mirror (its "Runs great locally" table) should gain a one-line
  pointer: *"CI runs rows 1–8 of this table headless on every push and PR — see `docs/PLAN.md` §12;
  rows 9 and 10 stay manual."* One sentence, no table changes.

### 12.8 `B-CI-1` — the blocker that must be fixed before the first run

**`npm test` cannot pass on any machine except this workstation.** Four test files hard-code a
session-scoped scratch path:

```
tools/catalog.test.ts:17       const SCRATCH_ROOT = '/tmp/claude-1000/-home-chris-workspace/852d5747-…/scratchpad/build-w2';
tools/fetch.test.ts:18         (identical)
tools/schedule.test.ts:17      (identical)
tools/lib/wikimedia.test.ts:6  (identical)
```

Each `beforeEach` then calls `fs.mkdtemp(path.join(SCRATCH_ROOT, '<prefix>-'))`. **`mkdtemp` does not
create parents** — on a runner (or any clean clone) that is `ENOENT: no such file or directory`, and
every test in all four files fails at setup. This is not a CI-only defect; it is a portability defect
that CI is simply the first thing to expose, and it also breaks §7.5's own "from a clean clone"
premise.

**Fix — owner: whoever implements §12, applied to all four files, before the workflow's first run:**

```ts
import os from 'node:os';
const SCRATCH_ROOT = os.tmpdir();
```

`os.tmpdir()` exists on every platform, needs no `mkdir`, and each file's existing `mkdtemp` prefix
(`catalog-`, `fetch-`, `schedule-`, …) already keeps the four suites from colliding — prefix them
`motodle-` for legibility if desired. The existing `afterEach` `fs.rm(workDir, …)` cleanup is
unchanged and still correct. **No other change to those files.** Verify locally with `npm test`
before pushing; the four suites must stay green on this host too.

### 12.9 Considered and deliberately NOT added

Recommendations only — **none of these belong in this milestone's `ci.yml`**, and adding one would
violate the "no linters or formatters that are not already in the repo" rail. Recorded here so the
decision is a decision and not an oversight.

| Tool | Why it was not added | Worth revisiting when |
|---|---|---|
| ESLint / Prettier | Neither is in `devDependencies`; adding one means a config file, a lockfile change, and a first run that reformats the whole tree — a large diff, zero defects caught that `tsc` + `svelte-check` miss | Any second contributor joins |
| Coverage thresholds (`vitest --coverage`) | Needs `@vitest/coverage-v8` (a new dependency) and an arbitrary number; the §7.2 contract suite is a stronger guarantee than a percentage | A threshold would gate something real, e.g. `src/lib/` before a refactor |
| Dependabot / Renovate | Real value (the C5 trap is exactly the class of thing a bot surfaces), but it is a *policy* change — it opens PRs, needs `permissions` beyond `contents: read`, and every bump must be re-validated against §10.1's pinned matrix | Post-launch, and only with the §10.1 table treated as the review checklist |
| `actions/cache` for the Vite build | `vite build` is ~20 s; a cache round trip is not obviously cheaper and adds a staleness failure mode | Build passes ~60 s |
| Playwright sharding / a matrix | The config is `fullyParallel: false, workers: 1` (§7.4, deliberate); sharding would fight it | The e2e step passes ~3 min — and then `workers: 2` first |
| A deploy job (S3 + CloudFront) | Out of scope — §9.5 is an explicit later-phase hook, and deployment needs write permissions this workflow deliberately does not take | §9.5 is built |

### 12.10 Expected timings (ubuntu-24.04, warm caches)

| Step | Cold | Warm |
|---|---|---|
| checkout + setup-node | ~15 s | ~10 s |
| `npm ci` | ~60 s | ~35 s |
| svelte-check + tsc | ~35 s | ~35 s |
| `npm test` (unit + contract + component + 2×tz) | ~60 s | ~60 s |
| generate + gate | ~20 s | ~20 s |
| `npm run build` + budgets | ~25 s | ~25 s |
| playwright install (`--with-deps`) | ~55 s | ~20 s |
| `npm run test:e2e` (8 spec files, `workers: 1`) | ~90 s | ~90 s |
| **Total** | **~6 min** | **~5 min** |

The warm number is the steady state (both caches populate on the first run). If the total creeps past
~7 min, the first lever is `workers: 2` in `playwright.config.ts`, not a second job (§12.1).

---

## 13. Deployment — S3 + CloudFront at `playmotodle.com`

**Status of this section:** the same kind of frozen contract §12 is. It specifies `infra/` (a small
Terraform root module living in *this* repo), `.github/workflows/deploy.yml`, `public/404.html`, one
addition to `vite.config.ts`, and one new contract test. An implementing agent should be able to
create every file from this section literally, without design decisions.

**§13 supersedes §9.5.** §9.5 was a design-only hook written before the domain, the account and the
cache classes were decided. Where the two disagree, §13 wins; §13.1 lists every disagreement rather
than editing §9.5 in place (the §11 R2-13 convention — supersede, don't scatter-edit).

### 13.1 Conflicts and corrections — READ THIS FIRST

Four of these change behaviour the rest of the plan depends on. Nothing below is optional.

| # | Conflict | Evidence | Resolution — binding |
|---|---|---|---|
| **D1** | **OAC + the canonical AWS bucket policy makes a missing object return `403`, not `404`.** The whole "No Motodle today" screen (§5.1, `loadPuzzle` in `src/lib/puzzle.ts`) branches on **status 403 lands on "Couldn't load today's Motodle / Retry"** instead. | AWS `GetObject` docs, verbatim: "If you have the `s3:ListBucket` permission on the bucket, Amazon S3 returns an HTTP status code `404 Not Found` error. If you don't have the `s3:ListBucket` permission, Amazon S3 returns an HTTP status code `403 Access Denied` error." AWS's own OAC policy example grants **only** `s3:GetObject`. Reproduced end-to-end against the real build: a 403 renders the error screen, a 404 renders the no-puzzle screen. | The bucket policy grants **two** statements to `cloudfront.amazonaws.com` under the same `AWS:SourceArn` condition: `s3:GetObject` on `arn/*` **and `s3:ListBucket` on `arn`** (§13.2.5). Belt and braces: the distribution also maps **`403 → 404`** via `custom_error_response` (§13.2.6) — which means the client-facing check can no longer tell the two statements apart (that mapping is the whole point, and also its side effect). The gate is therefore **two** checks, both release gates (§13.7): **V9a** reads the live bucket policy directly and asserts the `ListBucket` statement is present; **V9b** is the client-facing behavioural check, `curl` on a missing puzzle returns exactly `404`. |
| **D2** | **§9.5 says `/puzzles/YYYY-MM-DD.json` is `max-age=31536000, immutable`.** The deployment brief says ~5 minutes. | §9.5's table vs. the operator's brief. | **The brief wins: `public, max-age=300`.** §9.5's row is superseded. The consequence is deliberate — a wrong year or a bad crop on a *published* day becomes fixable by a normal commit-and-deploy instead of a hand-run invalidation. §9.5's "Correcting a published puzzle" procedure is therefore **downgraded from mandatory to optional**: republishing images under a new `/puzzles/img/NNNN-b/` prefix is still the right move when the *images* are wrong (browser caches hold them for a year), but the **JSON no longer needs a new path or a manual invalidation** — the 5-minute TTL plus the deploy's `/puzzles/*` invalidation covers it. |
| **D3** | **`error_caching_min_ttl` is per-status-code and DISTRIBUTION-WIDE.** The brief asks for a short negative-cache TTL "for `/puzzles/*.json`". That scoping does not exist. | `custom_error_response` is a top-level block on `aws_cloudfront_distribution` (provider 5.100.0 schema), not a field inside a cache behaviour. | One value, **60 s**, applies to every path class. Recorded honestly: **CloudFront's default is 10 s**, so 60 s is a deliberate 6× *loosening* chosen to absorb a crawl (§9.5's original reasoning, which still holds). The worst case is that a puzzle published mid-day becomes visible up to 60 s after upload. Lower it to 10 s by deleting the two `error_caching_min_ttl` lines if that ever matters. |
| **D4** | **The CSP cannot be `default-src 'none'` alone.** The built app has 6–7 inline `style="…"` attributes and a `data:` SVG favicon. | Two independent headless-Chromium probes against `dist/`: a strict policy produced 5–10 `securitypolicyviolation` events (`style-src-attr`, and `img-src` blockedURI `data`); the policy in §13.2.6 produced **0 violations, 0 console errors** across a full winning round, share, stats, archive and reload. | The exact string in §13.2.6 ships, verbatim, in **two** places (`infra/variables.tf` default and `schema/constants.ts`), kept honest by a contract test (§13.9 W6-5). |
| **D5** | `data "aws_cloudfront_cache_policy" { name = "Managed-CachingOptimized" }` is an unverified API name. | AWS docs publish the console name and the id, not the API `Name`; the lookup could not be resolved without an AWS call. | **No managed cache policies are used at all.** Three small custom policies (`motodle-immutable`, `motodle-short`, `motodle-html`) let the object's own `Cache-Control` drive and only *bound* it. This also fixes the managed policies' two traps: `CachingOptimized` has `min_ttl = 1 s` and overrides `no-cache` from the origin; `CachingDisabled` has `max_ttl = 0`, which would silently discard `index.html`'s `s-maxage`. |
| **D6** | `function_association` is **per cache behaviour** (max 2 each), not per distribution. | Provider 5.100.0 schema. | The www→apex function is attached to **all five** behaviours. Attaching it only to the default behaviour would leave `https://www.playmotodle.com/assets/index-*.js` serving from `www` — invisible in testing because the apex path works. |
| **D7** | `aws s3 sync --delete` will not delete anything its filters excluded. | `aws s3 sync help`, verbatim: "Note that files excluded by filters are excluded from deletion." | The deploy is six *filtered* upload passes (no `--delete` on any of them) followed by a seventh **unfiltered reaper** pass that carries `--delete` and no metadata flags (§13.4). |
| **D8** | `aws s3 sync` does not re-apply metadata to unchanged objects. | `aws s3 sync help`, verbatim: "In a sync, this means that files which haven't changed won't receive the new metadata." | Harmless today (`vite build` rewrites every file, so every object re-uploads), but it means **changing a `Cache-Control` class later does not re-header the objects already in the bucket**. The fix-up command is in §13.6 step 13, and nobody may add `--size-only` to a pass. |
| **D9** | **The brief's original "S3 state bucket + `use_lockfile`" is withdrawn** by the operator's amendment. | Operator amendment, 2026-09-02. | State lives in **HCP Terraform**, org `reenchree`, a new workspace `motodle`, **execution mode `local`**. There is no state bucket, no bootstrap, no DynamoDB, no `use_lockfile`. §13.3 is the whole story, and the workspace's execution mode must be set to `local` **before the first `terraform init`** or the first plan tries to run on HCP runners with no AWS credentials. |
| **D10** | `terraform init -backend=false` does **not** validate the backend/cloud block. | Proven: a bogus attribute inserted into the block still produced "Terraform has been successfully initialized!" and `terraform validate` still reported success. | An agent's `fmt` + `validate` pass is **not** evidence that the `cloud {}` block is right. The operator's first real `terraform init` (§13.6 step 6) is the first test of it. |
| **D11** | `public/404.html` does not exist in the repo. | `ls public/404.html dist/404.html` → both missing. | The implementer creates it (§13.5). Vite copies `public/**` to `dist/` verbatim, so it needs no build wiring. `--delete` in the reaper pass means a hand-uploaded 404 page would be deleted on the next deploy; it **must** come from the build. |

Two smaller notes, recorded so they are decisions and not oversights:

- **Provider pin `~> 5.0` resolves to 5.100.0, the last 5.x release** (the live line is 6.x). Every
  resource this section needs exists in 5.100.0 and the whole configuration validates against it. The
  pin is **deliberate** — it matches `terraform-core/main.tf`, which is the only other Terraform in the
  homelab. Moving to `~> 6.0` is a later, separate change.
- **`style-src 'self' 'unsafe-inline'` beats the tighter `style-src-attr 'unsafe-inline'`.** The
  granular CSP3 form was verified to work in Chromium and is strictly tighter, but WebKit support could
  not be verified from this network. A browser that ignores `style-src-attr` falls back to
  `style-src 'self'` and silently breaks the Stats bar and the Help table on iOS. The blanket form is
  verified and has no such exposure. Deleting the 6 inline `style=` attributes from the components is
  the real hardening path, and it is an **app** change, not an infra one — out of scope here.

### 13.2 `infra/` — the Terraform root module

Eleven files, one concern each. **Every block below is literal** and was validated as a set with
`terraform 1.16.1` + `hashicorp/aws 5.100.0`: `terraform fmt -check -diff` clean,
`terraform init -backend=false && terraform validate` → *"Success! The configuration is valid."*

```
infra/
  versions.tf     terraform{} required_version + required_providers; both provider blocks
  backend.tf      the HCP Terraform cloud{} block (a second, separate terraform{} block)
  variables.tf    every input, all defaulted — `terraform apply` needs no -var
  locals.tf       derived names
  data.tf         account id, the existing hosted zone, the existing GitHub OIDC provider
  s3.tf           bucket, public-access block, ownership controls, SSE, the OAC bucket policy
  acm.tf          the us-east-1 certificate and its validation
  route53.tf      ACM validation records + apex/www A and AAAA aliases
  cloudfront.tf   OAC, the www→apex function, the response-headers policy, 3 cache policies, the distribution
  iam.tf          the GitHub OIDC deploy role, its trust policy and its inline least-privilege policy
  outputs.tf      what the operator needs after apply
```

`infra/.terraform.lock.hcl` **is committed** (it is created by the first `terraform init`).
`infra/.terraform/`, `*.tfstate*` and `tfplan` are **not** — add them to `.gitignore` (§13.9 W6-1).

#### 13.2.1 `infra/versions.tf`

Two `terraform` blocks across two files is legal and was verified — Terraform merges them.

```hcl
terraform {
  # D9 withdrew use_lockfile, so the cloud{} block only truly needs >= 1.1; pinned to match the
  # pinned operator/agent install (§13.6 step 1) rather than left as a stale, non-load-bearing floor.
  required_version = ">= 1.16"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# CloudFront viewer certificates must live in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}
```

#### 13.2.2 `infra/backend.tf`

```hcl
terraform {
  cloud {
    organization = "reenchree"

    workspaces {
      name = "motodle"
    }
  }
}
```

No `AWS_*` credentials are ever set in the HCP workspace: execution mode is **local**, so plan
and apply run on the operator's laptop against the `default` SSO profile. HCP holds state only.

#### 13.2.3 `infra/variables.tf`

Every variable is defaulted, so `terraform plan` takes no `-var` and there is no `.tfvars` file
to keep in sync. The CSP default is the **verified** string from D4.

```hcl
variable "aws_region" {
  description = "Region for the site bucket and all non-CloudFront resources."
  type        = string
  default     = "us-west-2"
}

variable "domain_name" {
  description = "Apex domain; the canonical origin for the site."
  type        = string
  default     = "playmotodle.com"
}

variable "github_repository" {
  description = "owner/repo allowed to assume the deploy role."
  type        = string
  default     = "reenchree/motodle"
}

variable "github_branch" {
  description = "Branch ref allowed to assume the deploy role."
  type        = string
  default     = "main"
}

variable "name_prefix" {
  description = "Prefix for every named resource."
  type        = string
  default     = "motodle"
}

variable "content_security_policy" {
  description = "CSP served on every response. Verified against the built app."
  type        = string
  default     = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'"
}
```

#### 13.2.4 `infra/locals.tf` and `infra/data.tf`

```hcl
locals {
  www_domain = "www.${var.domain_name}"
  origin_id  = "${var.name_prefix}-s3-origin"
  github_sub = "repo:${var.github_repository}:ref:refs/heads/${var.github_branch}"
}
```

```hcl
# used for getting current account ID
data "aws_caller_identity" "current" {}

# The hosted zone already exists and is empty; Terraform owns the records in it.
data "aws_route53_zone" "this" {
  name         = "${var.domain_name}."
  private_zone = false
}

# Created by terraform-core. Referenced, never managed here.
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}
```

The OIDC provider is **looked up, never created** — `terraform-core/iam_github.tf` owns it
(`arn:aws:iam::051946164308:oidc-provider/token.actions.githubusercontent.com`). Looking it up by
`url` rather than by ARN keeps the account id out of this repo.

#### 13.2.5 `infra/s3.tf` — private bucket, OAC-only policy, and the `ListBucket` grant that makes 404 real

```hcl
resource "aws_s3_bucket" "site" {
  bucket = "${var.name_prefix}-site-${data.aws_caller_identity.current.account_id}"

  # §13.8: no S3 versioning here (git is the true source of truth; every deploy is --delete), so a
  # non-empty bucket is never the only copy of anything. force_destroy lets `terraform destroy`
  # (the realistic teardown path) work without a manual `aws s3 rm --recursive` first.
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# OAC requires ACLs to be disabled on the bucket.
resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

data "aws_iam_policy_document" "site_bucket" {
  statement {
    sid     = "AllowCloudFrontServicePrincipalReadOnly"
    effect  = "Allow"
    actions = ["s3:GetObject"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    resources = ["${aws_s3_bucket.site.arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }

  # Load-bearing: without s3:ListBucket, S3 answers 403 for a missing key and
  # the game shows "couldn't load" instead of "no puzzle today" (PLAN 5.1).
  statement {
    sid     = "AllowCloudFrontListBucketSoMissingKeysAre404"
    effect  = "Allow"
    actions = ["s3:ListBucket"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    resources = [aws_s3_bucket.site.arn]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = data.aws_iam_policy_document.site_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.site]
}
```

Three things here are load-bearing and must not be "cleaned up":

- **`BucketOwnerEnforced`** — AWS's OAC documentation requires ACLs disabled. It is the default
  for new buckets; it is set explicitly so a future console change cannot drift it.
- **The second policy statement (`s3:ListBucket` on the bucket ARN, no `/*`)** — this is D1. Without
  it the game's "no puzzle today" screen never renders. It does **not** expose a bucket listing to
  visitors: a listing needs a request to the bucket root with query parameters (`?list-type=2` etc),
  and every path here goes through CloudFront, where `default_root_object` rewrites the bare `/` to
  `index.html` and every one of the three cache policies (§13.2.6) sets
  `query_string_behavior = "none"` — so no request CloudFront will forward ever reaches S3 with the
  query string a listing needs. A future change to any cache policy's `query_string_behavior` is
  exactly the kind of edit that would need this reasoning re-checked.
- **`bucket_regional_domain_name`** as the origin, not the website endpoint. A website-endpoint
  origin is a *custom* origin and cannot use OAC at all.

There is no dependency cycle even though the policy names the distribution: the distribution
references only the bucket's domain name, never the policy.

#### 13.2.6 `infra/cloudfront.tf` — OAC, the function, headers, cache classes, behaviours, error responses

This is the load-bearing file. Read the four notes after it before changing a line.

```hcl
resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${var.name_prefix}-site-oac"
  description                       = "OAC for the ${var.name_prefix} site bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "www_to_apex" {
  name    = "${var.name_prefix}-www-to-apex"
  runtime = "cloudfront-js-2.0"
  comment = "301 www.${var.domain_name} -> ${var.domain_name}, query string preserved"
  publish = true

  code = <<-JS
    function handler(event) {
      var request = event.request;
      var hostHeader = request.headers.host;
      // .toLowerCase(): Host is case-insensitive (RFC 9110); without it "WWW.playmotodle.com"
      // falls through unredirected instead of matching www_domain below.
      var host = hostHeader ? hostHeader.value.toLowerCase() : '';
      if (host !== '${local.www_domain}') {
        return request;
      }
      var params = [];
      var qs = request.querystring;
      for (var key in qs) {
        var entry = qs[key];
        if (entry.multiValue) {
          for (var i = 0; i < entry.multiValue.length; i++) {
            params.push(key + '=' + entry.multiValue[i].value);
          }
        } else if (entry.value === '') {
          params.push(key);
        } else {
          params.push(key + '=' + entry.value);
        }
      }
      var suffix = params.length > 0 ? '?' + params.join('&') : '';
      return {
        statusCode: 301,
        statusDescription: 'Moved Permanently',
        headers: {
          location: { value: 'https://${var.domain_name}' + request.uri + suffix }
        }
      };
    }
  JS
}

resource "aws_cloudfront_response_headers_policy" "site" {
  name    = "${var.name_prefix}-security-headers"
  comment = "CSP verified against the built app; HSTS, nosniff, DENY, strict-origin-when-cross-origin"

  security_headers_config {
    content_security_policy {
      content_security_policy = var.content_security_policy
      override                = true
    }

    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = true
      preload                    = false
      override                   = true
    }
  }
}

# Origin Cache-Control drives every class; these policies only bound it.
resource "aws_cloudfront_cache_policy" "immutable" {
  name        = "${var.name_prefix}-immutable"
  comment     = "Content-hashed assets and per-puzzle image prefixes"
  min_ttl     = 0
  default_ttl = 31536000
  max_ttl     = 31536000

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true

    cookies_config {
      cookie_behavior = "none"
    }

    headers_config {
      header_behavior = "none"
    }

    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

resource "aws_cloudfront_cache_policy" "short" {
  name        = "${var.name_prefix}-short"
  comment     = "Puzzle JSON, manifest and catalog: 5 minutes"
  min_ttl     = 0
  default_ttl = 300
  max_ttl     = 300

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true

    cookies_config {
      cookie_behavior = "none"
    }

    headers_config {
      header_behavior = "none"
    }

    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

resource "aws_cloudfront_cache_policy" "html" {
  name        = "${var.name_prefix}-html"
  comment     = "index.html and 404.html: no browser cache, small edge cache"
  min_ttl     = 0
  default_ttl = 0
  max_ttl     = 300

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true

    cookies_config {
      cookie_behavior = "none"
    }

    headers_config {
      header_behavior = "none"
    }

    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = var.name_prefix
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  http_version        = "http2and3"
  aliases             = [var.domain_name, local.www_domain]

  origin {
    origin_id                = local.origin_id
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    target_origin_id           = local.origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = aws_cloudfront_cache_policy.html.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.site.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.www_to_apex.arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/assets/*"
    target_origin_id           = local.origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = aws_cloudfront_cache_policy.immutable.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.site.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.www_to_apex.arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/puzzles/img/*"
    target_origin_id           = local.origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = aws_cloudfront_cache_policy.immutable.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.site.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.www_to_apex.arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/puzzles/*.json"
    target_origin_id           = local.origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = aws_cloudfront_cache_policy.short.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.site.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.www_to_apex.arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/catalog.json"
    target_origin_id           = local.origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = aws_cloudfront_cache_policy.short.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.site.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.www_to_apex.arn
    }
  }

  # Real 404 status, HTML body. NEVER rewrite to index.html (PLAN 9.5).
  custom_error_response {
    error_code            = 404
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 60
  }

  # Safety net: if the ListBucket grant is ever lost, S3 returns 403 for a
  # missing key. Map it to 404 so "no puzzle today" still works.
  custom_error_response {
    error_code            = 403
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 60
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.site.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}
```

**Note 1 — the CSP string.** Reproduced here so it can be diffed by eye. It is the default of
`var.content_security_policy`, and the identical string ships in `schema/constants.ts` (§13.9 W6-5):

```
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'
```

Why each allowance exists, all empirically established against `dist/`:

| Directive | Why it is not `'none'` |
|---|---|
| `script-src 'self'` | One external module bundle. No inline `<script>`, no `eval(`, no `new Function` anywhere in the build. |
| `style-src 'self' 'unsafe-inline'` | One external stylesheet, plus 6 inline `style="…"` attributes in `HelpModal` (4 `<col>` widths), `ResultModal` and `App` (`aspect-ratio: 4 / 3`), and the dynamic bar width in `StatsModal`. No runtime `<style>` element is ever injected — `'unsafe-inline'` is here for **attributes**, not elements. |
| `img-src 'self' data:` | `data:` is for the inline SVG favicon in `index.html` (§11 R4-10) — nothing else. All puzzle WebPs are same-origin. |
| `connect-src 'self'` | `catalog.json`, `puzzles/<date>.json`, `puzzles/manifest.json`. Every fetch is root-relative and same-origin (§10.6). |
| `font-src 'self'` | No web fonts today (system-ui stack). Present so a self-hosted font is a build change, not an infra change. |
| `frame-ancestors 'none'` | Redundant with `X-Frame-Options: DENY`, which the same policy also sends. Both ship; the brief allows either. |

**Note 2 — cache classes.** The distribution never invents a TTL; the object's own `Cache-Control`
(set at upload, §13.4) drives, and the policy only bounds it.

| Behaviour | Path pattern | Cache policy | `min`/`default`/`max` TTL | Object `Cache-Control` uploaded by the deploy |
|---|---|---|---|---|
| ordered #1 | `/assets/*` | `motodle-immutable` | 0 / 31536000 / 31536000 | `public, max-age=31536000, immutable` |
| ordered #2 | `/puzzles/img/*` | `motodle-immutable` | 0 / 31536000 / 31536000 | `public, max-age=31536000, immutable` |
| ordered #3 | `/puzzles/*.json` | `motodle-short` | 0 / 300 / 300 | `public, max-age=300` |
| ordered #4 | `/catalog.json` | `motodle-short` | 0 / 300 / 300 | `public, max-age=300` |
| default | everything else (`/`, `/index.html`, `/404.html`) | `motodle-html` | 0 / 0 / 300 | `public, max-age=0, must-revalidate, s-maxage=60` |

**Order matters.** `ordered_cache_behavior` blocks are evaluated in the order written; keep the
four `ordered_cache_behavior` blocks in the sequence above and do not reorder them on a future edit.

`/index.html` gets `max-age=0, must-revalidate` for browsers **and** `s-maxage=60` for the edge:
a player always revalidates, the edge absorbs a burst for a minute. `motodle-html`'s `max_ttl = 300`
is the ceiling that keeps a mistyped `s-maxage` from pinning a stale entry point.

**Note 3 — the two `custom_error_response` blocks.** `404 → 404 /404.html` is the whole point:
the **status is preserved**, only a readable body is added. Nothing anywhere rewrites a missing
object to `index.html` — `default_root_object` affects the bare `/` request only. `403 → 404` is
the D1 safety net. Both carry `error_caching_min_ttl = 60` (D3: distribution-wide, per status code).
AWS caches `404` unconditionally, so `error_caching_min_ttl = 60` governs the normal path. It caches
`403` only when the origin sends `Cache-Control`, and S3's `AccessDenied` sends none — so if the
`ListBucket` grant is ever lost, every missing-key request reaches S3 uncached. The 403 mapping
keeps the game working; it does not protect the origin. That is why V9a checks the bucket policy
directly.

`error_caching_min_ttl` is also not the last word on the observed TTL: `/404.html` itself matches
the **default** cache behaviour (`motodle-html`, §13.2.6), which carries its own `s-maxage=60` —
and AWS documents that a cache behaviour matching the custom error page's `response_page_path` wins
over `error_caching_min_ttl` for how long the *response* is held at the edge. Deleting the two
`error_caching_min_ttl` lines (the D3 escape hatch) would therefore likely leave the observed TTL at
~60 s from `motodle-html`'s `s-maxage`, not drop it to CloudFront's 10 s default. V11 (§13.7) is
written to measure this empirically rather than assume either number.

**Note 4 — the www→apex function** runs at `viewer-request` on **every** behaviour (D6) and
reconstructs the query string by hand, because `event.request.querystring` is a parsed object, not
a string — without the loop, `?d=2026-09-01` (the archive/practice link, §4.6) would be dropped on
redirect. `.toLowerCase()` on the `Host` header value is load-bearing too: `Host` is
case-insensitive (RFC 9110) and without it a request for `WWW.playmotodle.com` (a real browser
autocomplete/bookmark artifact, not a hypothetical) falls through the `!==` check unredirected. The
function body was syntax-checked under `'use strict'` and exercised for five cases: apex
pass-through, bare `/`, single-value query, a flag plus a multi-value query (`/a?flag&x=1&x=2`), and
an uppercase `Host: WWW.playmotodle.com`. The `cloudfront-js-2.0` runtime is always strict-mode; the
body uses only `var`, `for…in`, `.toLowerCase()` and string concatenation, so nothing in it depends
on the ES6+ subset.

#### 13.2.7 `infra/acm.tf` and `infra/route53.tf`

```hcl
resource "aws_acm_certificate" "site" {
  provider = aws.us_east_1

  domain_name               = var.domain_name
  subject_alternative_names = [local.www_domain]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate_validation" "site" {
  provider = aws.us_east_1

  certificate_arn         = aws_acm_certificate.site.arn
  validation_record_fqdns = [for r in aws_route53_record.acm_validation : r.fqdn]
}
```

```hcl
# allow_overwrite because apex and www can resolve to the same validation record.
resource "aws_route53_record" "acm_validation" {
  for_each = {
    for dvo in aws_acm_certificate.site.domain_validation_options :
    dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id         = data.aws_route53_zone.this.zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_route53_record" "apex_a" {
  zone_id = data.aws_route53_zone.this.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "apex_aaaa" {
  zone_id = data.aws_route53_zone.this.zone_id
  name    = var.domain_name
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "www_a" {
  zone_id = data.aws_route53_zone.this.zone_id
  name    = local.www_domain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "www_aaaa" {
  zone_id = data.aws_route53_zone.this.zone_id
  name    = local.www_domain
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}
```

Three details that are easy to get wrong:

- The distribution consumes **`aws_acm_certificate_validation.site.certificate_arn`**, not the
  certificate's own ARN. That is what makes the apply *wait* for DNS validation instead of failing
  with an unvalidated certificate.
- `allow_overwrite = true` on the validation records — apex and `www` can hash to the **same**
  validation record, and `for_each` would otherwise fight itself.
- The alias records use `aws_cloudfront_distribution.site.hosted_zone_id`, not the hardcoded
  `Z2FDTNDATAQYW2`. Same value, one fewer magic string.

Both `www` records exist so that `www.playmotodle.com` **resolves** and reaches the distribution —
which is the only way the CloudFront function can 301 it. A CNAME-less `www` would fail at DNS and
never redirect.

#### 13.2.8 `infra/iam.tf` — the GitHub OIDC deploy role

```hcl
data "aws_iam_policy_document" "deploy_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [local.github_sub]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name                 = "${var.name_prefix}-github-deploy"
  description          = "GitHub Actions deploy role for ${var.github_repository} (${var.github_branch} only)"
  assume_role_policy   = data.aws_iam_policy_document.deploy_assume.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "deploy" {
  statement {
    sid       = "ListSiteBucket"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.site.arn]
  }

  statement {
    sid    = "WriteSiteObjects"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["${aws_s3_bucket.site.arn}/*"]
  }

  statement {
    sid       = "InvalidateThisDistribution"
    effect    = "Allow"
    actions   = ["cloudfront:CreateInvalidation"]
    resources = [aws_cloudfront_distribution.site.arn]
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "${var.name_prefix}-deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}
```

The rendered trust policy — this is the shape to eyeball in the plan output:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Principal": {
        "Federated": "arn:aws:iam::051946164308:oidc-provider/token.actions.githubusercontent.com"
      },
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:sub": [
            "repo:reenchree/motodle:ref:refs/heads/main",
            "repo:reenchree@213154582/motodle@1355164768:ref:refs/heads/main"
          ],
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        }
      }
    }
  ]
}
```

`StringEquals` on a single literal `sub`, **not** `StringLike` with a wildcard.
`terraform-core`'s existing `GitHubOIDCECRPushRole` trusts `repo:reenchree/*:*`; this role
deliberately does not follow that precedent — only `main` of this one repo can assume it, so a
pull-request run, a tag build and a fork can never touch the bucket.

The rendered permission policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListSiteBucket",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::motodle-site-051946164308"
    },
    {
      "Sid": "WriteSiteObjects",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::motodle-site-051946164308/*"
    },
    {
      "Sid": "InvalidateThisDistribution",
      "Effect": "Allow",
      "Action": "cloudfront:CreateInvalidation",
      "Resource": "arn:aws:cloudfront::051946164308:distribution/EXAMPLEDISTID"
    }
  ]
}
```

`s3:ListBucket` is needed by `aws s3 sync` (it lists the destination to decide what to upload and
what `--delete` should reap) and `s3:GetObject` by its comparator. `cloudfront:GetInvalidation` is
**deliberately absent** — which is why the workflow fires an invalidation and does not wait on it
(§13.4). No `cloudfront:*`, no `iam:*`, no other bucket, no other distribution.

#### 13.2.9 `infra/outputs.tf`

```hcl
output "site_bucket" {
  description = "S3 bucket holding the built site."
  value       = aws_s3_bucket.site.bucket
}

output "distribution_id" {
  description = "CloudFront distribution id (GitHub variable CLOUDFRONT_DISTRIBUTION_ID)."
  value       = aws_cloudfront_distribution.site.id
}

output "distribution_domain_name" {
  description = "CloudFront domain name, for debugging before DNS propagates."
  value       = aws_cloudfront_distribution.site.domain_name
}

output "deploy_role_arn" {
  description = "Role GitHub Actions assumes (GitHub variable AWS_DEPLOY_ROLE_ARN)."
  value       = aws_iam_role.deploy.arn
}

output "gh_variable_commands" {
  description = "Paste these into a shell at the repo root after apply."
  value = join("\n", [
    "gh variable set AWS_DEPLOY_ROLE_ARN --body '${aws_iam_role.deploy.arn}'",
    "gh variable set SITE_BUCKET --body '${aws_s3_bucket.site.bucket}'",
    "gh variable set CLOUDFRONT_DISTRIBUTION_ID --body '${aws_cloudfront_distribution.site.id}'",
  ])
}
```

### 13.3 State — HCP Terraform, workspace `motodle`, execution mode **local**

The brief's original S3 state bucket is **withdrawn** (D9). There is **no state bucket, no bootstrap
`aws s3api` command, no DynamoDB table and no `use_lockfile`**. If any of those words appear in an
implementation, it is wrong.

State lives in HCP Terraform:

| Setting | Value |
|---|---|
| Organization | `reenchree` (the same org `terraform-core` uses) |
| Workspace | `motodle` — **new** |
| Workflow | CLI-driven |
| Execution mode | **`local`** |
| Workspace variables | **none** — no AWS credentials in HCP |

The backend block is §13.2.2, repeated here because it is the one thing that must be exact:

```hcl
terraform {
  cloud {
    organization = "reenchree"

    workspaces {
      name = "motodle"
    }
  }
}
```

**The one trap.** A workspace that `terraform init` auto-creates defaults to **remote** execution.
Remote execution would run the plan on HCP's runners, which have no AWS credentials and no SSO
session, and it would fail. The workspace must therefore exist with `execution-mode: local`
**before the first `terraform init`** — §13.6 steps 4–5 do exactly that, with `curl` against the HCP
API using the token `terraform login` wrote. A PATCH recovery path is given for the case where an
`init` already created it.

`terraform-core` uses the *other* pattern (remote execution + HCP dynamic credentials against the
`app.terraform.io` OIDC provider that already exists in account `051946164308`). Moving `motodle` to
that pattern later is a real, documented upgrade — it needs its own IAM role with a trust policy
scoped to the HCP workspace — but it is **not built now**, because local execution needs no AWS
identity for HCP at all and this is a hobby site the operator applies by hand.

### 13.4 `.github/workflows/deploy.yml`

One new file. It does **not** modify `ci.yml`. CI stays `permissions: contents: read` (§12.1) — every
write permission lives here, in a workflow that only runs after CI is green.

```yaml
name: Deploy

# Fires when CI finishes. workflow_run reads this file from the DEFAULT branch,
# so edits to it only take effect once merged to main.
on:
  workflow_run:
    workflows: ["CI"]
    types: [completed]
  # SECURITY-CRITIC B1 / OPS-CRITIC B1 correction: the deploy role's OIDC trust policy
  # (infra/iam.tf) admits ONLY sub "repo:reenchree/motodle:ref:refs/heads/main" (§13.2.8).
  # `gh workflow run deploy.yml --ref <branch-or-tag>` mints a token with that ref in the
  # sub and AssumeRoleWithWebIdentity fails; a raw SHA isn't even a legal --ref value. So
  # rollback dispatches stay on `main` (sub keeps refs/heads/main) and pass the target
  # commit as an input instead of a ref.
  workflow_dispatch:
    inputs:
      ref:
        # NOT re-verified by CI: this commit is built and shipped as-is, whatever CI said about
        # it (or didn't -- it may never have run). That's the point of a rollback lever.
        description: 'Commit SHA to build and deploy, unverified by CI (default: main tip)'
        required: false
        type: string

permissions:
  contents: read
  id-token: write

# One deploy at a time, and never cancel one that is mid-sync.
concurrency:
  group: deploy-production
  cancel-in-progress: false

jobs:
  deploy:
    # CI also runs on pull_request, and workflow_run fires for those too. Deploy only a
    # successful CI run that was itself triggered by a push to main.
    # Skips (green, not red) until the operator has applied infra/ and set the repository
    # variables — otherwise every push to main would fail at configure-aws-credentials.
    if: >-
      vars.AWS_DEPLOY_ROLE_ARN != '' &&
      (github.event_name == 'workflow_dispatch' ||
      (github.event.workflow_run.conclusion == 'success' &&
      github.event.workflow_run.event == 'push' &&
      github.event.workflow_run.head_branch == 'main'))
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    env:
      AWS_REGION: us-west-2
      SITE_BUCKET: ${{ vars.SITE_BUCKET }}
      DISTRIBUTION_ID: ${{ vars.CLOUDFRONT_DISTRIBUTION_ID }}
      DEPLOY_ROLE_ARN: ${{ vars.AWS_DEPLOY_ROLE_ARN }}
    steps:
      - name: Assert the repository variables are set
        run: |
          set -euo pipefail
          : "${DEPLOY_ROLE_ARN:?set repository variable AWS_DEPLOY_ROLE_ARN (see PLAN 13.6)}"
          : "${SITE_BUCKET:?set repository variable SITE_BUCKET (see PLAN 13.6)}"
          : "${DISTRIBUTION_ID:?set repository variable CLOUDFRONT_DISTRIBUTION_ID (see PLAN 13.6)}"

      # inputs.ref (rollback dispatch) wins if set; else the workflow_run payload's head_sha
      # (the exact commit CI verified); else github.sha (a plain workflow_dispatch with no
      # input, which defaults to the tip of `main` per the trigger's trust-policy note above).
      - name: Checkout the target commit
        uses: actions/checkout@v5
        with:
          ref: ${{ inputs.ref || github.event.workflow_run.head_sha || github.sha }}
          persist-credentials: false

      - name: Setup Node
        uses: actions/setup-node@v5
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install (npm ci)
        run: npm ci --no-audit --no-fund

      - name: Build + payload budgets
        run: npm run build

      - name: Assert every built file falls into a known cache class
        run: |
          set -euo pipefail
          test -f dist/index.html
          test -f dist/404.html
          test -f dist/catalog.json
          unmatched=$(cd dist && find . -type f \
            ! -path './assets/*' \
            ! -path './puzzles/img/*.webp' \
            ! -name '*.json' \
            ! -name '*.html' -print)
          if [ -n "$unmatched" ]; then
            echo "::error::built files with no cache class (see PLAN 13.4):"
            echo "$unmatched"
            exit 1
          fi

      # v5 exists; pinned to v4 deliberately (untested here -- no network to verify it against
      # this OIDC setup). This step holds id-token: write and mints the AWS session, so bumping
      # the tag is a real change, not routine Renovate churn.
      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ env.DEPLOY_ROLE_ARN }}
          aws-region: ${{ env.AWS_REGION }}
          role-session-name: motodle-deploy-${{ github.run_id }}

      # ---- Pass A-D: immutable classes. These MUST land before index.html. ----
      - name: 'Sync A: hashed JS'
        run: |
          aws s3 sync dist/ "s3://$SITE_BUCKET/" --no-progress \
            --exclude "*" --include "assets/*.js" \
            --content-type "text/javascript; charset=utf-8" \
            --cache-control "public, max-age=31536000, immutable"

      - name: 'Sync B: hashed CSS'
        run: |
          aws s3 sync dist/ "s3://$SITE_BUCKET/" --no-progress \
            --exclude "*" --include "assets/*.css" \
            --content-type "text/css; charset=utf-8" \
            --cache-control "public, max-age=31536000, immutable"

      # Empty today. Content type is guessed from the extension (.svg, .woff2, .png all correct).
      - name: 'Sync C: any other hashed asset'
        run: |
          aws s3 sync dist/ "s3://$SITE_BUCKET/" --no-progress \
            --exclude "*" --include "assets/*" --exclude "assets/*.js" --exclude "assets/*.css" \
            --cache-control "public, max-age=31536000, immutable"

      - name: 'Sync D: puzzle images'
        run: |
          aws s3 sync dist/ "s3://$SITE_BUCKET/" --no-progress \
            --exclude "*" --include "puzzles/img/*.webp" \
            --content-type "image/webp" \
            --cache-control "public, max-age=31536000, immutable"

      # ---- Pass E: mutable JSON (catalog.json, manifest.json, every puzzles/<date>.json) ----
      # --exclude "assets/*": aws s3's filters match "*" against "/" too, so an unqualified
      # "*.json" include would also re-touch any future assets/*.json under the immutable
      # /assets/* behaviour, downgrading it to max-age=300 with no cache-class assertion to catch it.
      - name: 'Sync E: catalog, manifest and puzzle JSON'
        run: |
          aws s3 sync dist/ "s3://$SITE_BUCKET/" --no-progress \
            --exclude "*" --include "*.json" --exclude "assets/*" \
            --content-type "application/json" \
            --cache-control "public, max-age=300"

      # ---- Pass F: the entry point, LAST of the uploads ----
      - name: 'Sync F: index.html and 404.html'
        run: |
          aws s3 sync dist/ "s3://$SITE_BUCKET/" --no-progress \
            --exclude "*" --include "*.html" \
            --content-type "text/html; charset=utf-8" \
            --cache-control "public, max-age=0, must-revalidate, s-maxage=60"

      # ---- Pass G: the reaper. Unfiltered, because --delete ignores filtered-out keys. ----
      # Every object was uploaded above with a LastModified newer than its source mtime, so this
      # pass uploads nothing; it only deletes objects that are no longer in dist/.
      - name: 'Sync G: delete objects no longer in the build'
        run: |
          aws s3 sync dist/ "s3://$SITE_BUCKET/" --no-progress --delete

      - name: Invalidate the mutable paths
        run: |
          aws cloudfront create-invalidation \
            --distribution-id "$DISTRIBUTION_ID" \
            --paths "/" "/index.html" "/404.html" "/catalog.json" "/puzzles/*" \
            --query 'Invalidation.Id' --output text
```

**Repository variables it reads** (plain variables, not secrets — none of these are sensitive, and
being able to read them in the run log is a feature):

| Variable | Value comes from | Example |
|---|---|---|
| `AWS_DEPLOY_ROLE_ARN` | `terraform output deploy_role_arn` | `arn:aws:iam::051946164308:role/motodle-github-deploy` |
| `SITE_BUCKET` | `terraform output site_bucket` | `motodle-site-051946164308` |
| `CLOUDFRONT_DISTRIBUTION_ID` | `terraform output distribution_id` | `E1EXAMPLE2DIST` |

Seven things in that file are deliberate and must survive review:

1. **The `if:` gate is four conditions, not one.** `workflow_run` fires for CI's `pull_request` runs
   as well as its pushes, and a `workflow_run` `branches:` filter matches the PR's *head* branch, not
   its base. Gating on `conclusion == 'success'` alone would deploy a pull-request head — including a
   fork's — straight to production. `event == 'push'` **and** `head_branch == 'main'` are both required.
   The fourth condition, `vars.AWS_DEPLOY_ROLE_ARN != ''`, is ANDed over the whole disjunction (note
   the extra parentheses) and is a **pre-provisioning guard**: until the operator has applied `infra/`
   and set the three repository variables (§13.6 step 9), every push to `main` would otherwise reach
   `configure-aws-credentials` and fail red. With the guard the job **skips** — a grey run, not a red
   one — and the first real deploy is the operator's own `gh workflow run deploy.yml` at §13.6 step 10.
   The block above is the **shipped** file, verbatim (commit `7c43481`); this plan text was corrected
   to match it on 2026-09-02 (§11.12), not the other way round.
2. **`ref: ${{ inputs.ref || github.event.workflow_run.head_sha || github.sha }}`.** Three terms, in
   priority order: `inputs.ref` is set only on a rollback dispatch (§13.6 "Rollback") and wins when
   present; `github.event.workflow_run.head_sha` is the commit CI actually verified, for the normal
   automatic trigger; `github.sha` is the fallback for a plain `workflow_dispatch` with no input
   (there is no `workflow_run` payload on that trigger, so the middle term would otherwise be empty
   and checkout would silently take the default branch tip). `github.sha` on `workflow_dispatch`
   resolves to the tip of whatever ref the dispatch itself ran from — always `main` here, since
   `inputs.ref` carries the target *commit* instead of the dispatch *ref* (see the trigger's
   trust-policy comment in the shipped `deploy.yml`, and §13.6 "Rollback").
3. **`persist-credentials: false`.** The job never pushes; leaving a `GITHUB_TOKEN` in the local git
   config of a job that also assumes an AWS role is free risk.
4. **The build happens here.** `dist/` is in `.gitignore`; there is no artifact hand-off from CI (that
   would need `actions/download-artifact` plus a `workflow_run`-scoped artifact lookup, and the build
   is ~25 s).
5. **The cache-class assertion.** It fails the deploy if `vite build` ever emits a file that none of the
   six filtered passes would match — the exact failure mode that would otherwise let pass G upload a
   stray file with no `Cache-Control` and a guessed content type.
6. **Pass ordering is the deploy's correctness argument.** `index.html` is unhashed and names the hashed
   bundle; a player who fetches the new `index.html` before the new `/assets/*` exists gets a hard 404
   on the bundle and no retry (§13.7). Passes A–E therefore all precede F, and `--delete` appears on
   **neither** — it is confined to pass G, which runs after everything is up.
7. **No invalidation wait.** The role has `CreateInvalidation` but not `GetInvalidation` (§13.2.8), so
   `aws cloudfront wait invalidation-completed` would fail with AccessDenied. Invalidations take
   ~30–60 s; the workflow fires and exits. Five paths per deploy against a 1,000-path free monthly
   allowance is ~200 free deploys a month.

Two cosmetic notes: YAML 1.1 parses the bare key `on:` as boolean `true` (harmless — GitHub's own
parser does not), so nobody should "fix" it by quoting; and `${{ vars.* }}` is read once into job-level
`env` so the step scripts use ordinary shell variables rather than expression interpolation.

### 13.5 `public/404.html` and the CSP-served preview

#### 13.5.1 The page

Create it at **`public/404.html`**. Vite copies `public/**` into `dist/` verbatim with no config
change and no build wiring — the file simply appears at `dist/404.html`, which is exactly where the
distribution's `response_page_path = "/404.html"` looks. It must come from the build, never from a
hand-upload: pass G's `--delete` would reap a hand-placed object on the next deploy (D11).

It is served for two quite different things: a human who typed a wrong URL, and the app's own
`fetch('/puzzles/2099-01-01.json')` for a day with no puzzle. The second caller reads only the status
code and throws the body away (§5.1), so an HTML body is harmless — what matters is that the status
stays `404`.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="light dark" />
    <meta name="robots" content="noindex" />
    <title>Not found — Motodle</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0;
        min-height: 100svh;
        display: grid;
        place-items: center;
        padding: 1.5rem;
        box-sizing: border-box;
        font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        background: #fafafa;
        color: #1a1a1a;
      }
      main { max-width: 32rem; text-align: center; }
      h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
      p { margin: 0 0 1.5rem; line-height: 1.5; }
      a {
        display: inline-block;
        padding: 0.75rem 1.25rem;
        border-radius: 0.5rem;
        background: #3b7d22;
        color: #fff;
        font-weight: 600;
        text-decoration: none;
      }
      @media (prefers-color-scheme: dark) {
        body { background: #121212; color: #ededed; }
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Nothing here</h1>
      <p>That page doesn&rsquo;t exist. There may also be no Motodle for the day you asked for.</p>
      <a href="/">Play today&rsquo;s Motodle</a>
    </main>
  </body>
</html>
```

`1.4 KB`, no external requests, no `/assets/*` reference (those filenames change every build), theme
aware, `noindex`. The inline `<style>` element is permitted by `style-src 'self' 'unsafe-inline'` —
it is the one place in the repo that depends on the *element* half of that allowance rather than the
attribute half, and it is why hardening `style-src` later (D4's closing note) has to consider this
file too.

#### 13.5.2 Serving the production headers in `vite preview`

Add a `preview` block to `vite.config.ts`. This is the only edit to an existing source file that §13
requires, and it turns "the app works under the production CSP" from a one-off manual probe into
something the whole Playwright suite (§7.4) re-proves on every CI run — `playwright.config.ts`'s
`webServer` already runs `vite preview` on 4173.

```ts
import { CONTENT_SECURITY_POLICY } from './schema/constants';

// … inside defineConfig({ … })
  preview: {
    // The exact headers CloudFront serves in production (PLAN §13.2.6), so the e2e
    // suite runs under the real policy instead of an unheadered preview.
    headers: {
      'Content-Security-Policy': CONTENT_SECURITY_POLICY,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    },
  },
```

Verified on this repo's Vite 8.2.2: `preview.headers` is applied to every response (checked on `/`
and on `/assets/index-*.js`). `appType: 'mpa'` stays exactly where it is — it is what makes the
preview server 404 a missing puzzle instead of falling back to `index.html`, which is the same
contract CloudFront has to honour, and a preview run without it silently returns `200`.

`CONTENT_SECURITY_POLICY` is a new export in `schema/constants.ts` (§13.9 W6-5), carrying the D4
string byte for byte, with a contract test asserting `infra/variables.tf`'s default matches it.

### 13.6 Operator runbook

Every command is run by the **operator**, from the repo root, on the workstation. Agents cannot run
any of steps 2–9 or 12: they require an SSO session, an HCP token, `gh` auth and AWS writes.

**Step 1 — install Terraform (once; no sudo, no package manager).**
`~/.local/bin` is already on PATH. The checksum line below is the real one for 1.16.1.

```bash
cd /tmp
curl -fLO https://releases.hashicorp.com/terraform/1.16.1/terraform_1.16.1_linux_amd64.zip
curl -fLO https://releases.hashicorp.com/terraform/1.16.1/terraform_1.16.1_SHA256SUMS
sha256sum -c --ignore-missing terraform_1.16.1_SHA256SUMS   # expect: terraform_1.16.1_linux_amd64.zip: OK
unzip -o terraform_1.16.1_linux_amd64.zip -d /tmp/tfbin
install -m 0755 /tmp/tfbin/terraform ~/.local/bin/terraform
terraform version            # Terraform v1.16.1 on linux_amd64
```

Expected SHA-256 of the zip: `745d33b4b02b7980c62a38ec1beea24ee084ea8caf3f503c200554bd9a0cbe49`.

**Step 2 — AWS session (~30 s, opens a browser).**

```bash
aws sso login --profile default
export AWS_PROFILE=default
aws sts get-caller-identity     # Account must read 051946164308
```

**Step 3 — HCP Terraform login (once; interactive).** Writes a token to
`~/.terraform.d/credentials.tfrc.json`.

```bash
terraform login
```

**Step 4 — create the workspace with LOCAL execution, BEFORE any `init`.** This is the step that
cannot be skipped: an auto-created workspace defaults to *remote* execution and the first plan would
try to run on HCP's runners with no AWS credentials (§13.3). Needs `jq` (installed already on most
workstations; `apt`/`brew install jq` otherwise).

```bash
TFC_TOKEN=$(jq -r '.credentials["app.terraform.io"].token' ~/.terraform.d/credentials.tfrc.json)

curl -sS \
  --header "Authorization: Bearer ${TFC_TOKEN}" \
  --header "Content-Type: application/vnd.api+json" \
  --request POST \
  --data '{"data":{"type":"workspaces","attributes":{"name":"motodle","execution-mode":"local"}}}' \
  https://app.terraform.io/api/v2/organizations/reenchree/workspaces | jq '.data.attributes'
```

Expect `"execution-mode": "local"` and `"name": "motodle"` in the response.

If the org's default execution mode is itself the problem (a project-level default overriding what
a plain workspace create would otherwise get), the fallback is a project settings-overwrite:
`{"data":{"type":"projects","attributes":{"setting-overwrites":{"execution-mode":true}}}}` PATCHed
to that project's `/api/v2/projects/<id>` — only needed if step 4's `POST` result does not already
show `"execution-mode": "local"`.

**Step 5 — only if step 4 said the workspace already exists** (because an `init` created it first).
Likely a separate terminal from step 4 — re-derive `TFC_TOKEN` if so:

```bash
TFC_TOKEN=$(jq -r '.credentials["app.terraform.io"].token' ~/.terraform.d/credentials.tfrc.json)
```

```bash
curl -sS \
  --header "Authorization: Bearer ${TFC_TOKEN}" \
  --header "Content-Type: application/vnd.api+json" \
  --request PATCH \
  --data '{"data":{"type":"workspaces","attributes":{"execution-mode":"local"}}}' \
  https://app.terraform.io/api/v2/organizations/reenchree/workspaces/motodle | jq '.data.attributes["execution-mode"]'
```

Expect `"local"`. The UI equivalent is **Settings → General → Execution Mode → Local → Save**.

**Step 6 — init (~20 s).** This is the first thing that actually reads the `cloud {}` block; an
agent's `terraform validate` cannot have caught a typo in it (D10).

```bash
cd infra
terraform init
```

**Step 7 — plan (~30 s).**

```bash
terraform plan -out=tfplan
```

Expect **22 resources to add and 0 to change/destroy** (counted off the shipped HCL: 21 `resource`
blocks, of which `aws_route53_record.acm_validation` expands to 2 instances — one per SAN, apex and
`www` — for 22): 5 S3 (bucket + 4 sub-resources), 2 ACM (certificate + validation), 6 Route53 (2
`acm_validation` instances + 4 alias records), 7 CloudFront (OAC, function, response-headers policy,
3 cache policies, distribution), 2 IAM (role + role policy). If the plan proposes to *create* an IAM
OIDC provider, stop — the data source is misconfigured and you are about to collide with
`terraform-core`.

If instead the plan **errors** with `Invalid for_each argument … cannot be determined until apply`
on `aws_route53_record.acm_validation`, that's the well-known trap in the
`domain_validation_options`-keyed `for_each` pattern (its keys are `(known after apply)` on a
greenfield certificate): run `terraform apply -target=aws_acm_certificate.site` once to materialize
the certificate, then re-run the full `terraform plan -out=tfplan`.

If instead `terraform plan -out=tfplan` is **rejected outright** with "Saving a generated plan is
currently not supported", the workspace is still in **remote** execution — steps 4–5 did not stick.
Recheck via `curl` (step 4's `GET` equivalent, or the UI: Settings → General → Execution Mode) before
retrying.

**Step 8 — apply (~8–12 minutes; most of it is CloudFront).**

```bash
terraform apply tfplan
```

Timing to expect: Route53 records seconds; `aws_acm_certificate_validation` **2–5 min** (it polls
until DNS validation completes and will look hung — it is not); `aws_cloudfront_distribution`
**5–10 min** to reach Deployed. Do not interrupt it. If the apply is killed mid-distribution, re-run
`terraform plan`/`apply` — the state is in HCP and the operation is resumable.

**Step 9 — read the outputs and set the GitHub variables (~1 min).**

```bash
terraform output
terraform output -raw gh_variable_commands     # prints the three lines below, filled in
```

```bash
cd ..
gh variable set AWS_DEPLOY_ROLE_ARN --body 'arn:aws:iam::051946164308:role/motodle-github-deploy'
gh variable set SITE_BUCKET --body 'motodle-site-051946164308'
gh variable set CLOUDFRONT_DISTRIBUTION_ID --body '<E…, from terraform output distribution_id>'
gh variable list
```

**Step 9.5 — W6 is already on `main`; this step is now a *check*, not a push.** *(Rewritten
2026-09-02 — the original text said "nothing has been pushed yet", which is stale: `deploy.yml`,
`public/404.html` and `infra/**` landed on `main` in commit `7c43481`, CI is green on it, and the
`Deploy` run for that commit **skipped** rather than failed, because the shipped `if:` carries the
`vars.AWS_DEPLOY_ROLE_ARN != ''` pre-provisioning guard, §13.4 item 1.)*

The old ordering worry — that landing the workflow before step 9's variables fires a red deploy — is
what the guard removed. Landing it early is now safe in both directions, and the runbook's ordering
constraint is reduced to: **the variables (step 9) must be set before you deliberately trigger a
deploy (step 10).**

What to confirm here, before moving on:

```bash
gh run list --workflow ci.yml --limit 3          # CI green on the tip of main
gh run list --workflow deploy.yml --limit 3      # expect: skipped (grey), not failed (red)
git status --porcelain -uall infra/              # must be EMPTY on a clean tree
```

The `infra/` hygiene check from the original step still stands and is permanent, not one-off: the
tracked set is exactly the 11 `.tf` files plus `.terraform.lock.hcl`, and **nothing** under
`infra/.terraform/` (~675 MB of provider binary) may ever be committed — recovering from that needs a
history rewrite. `.gitignore` already covers it; verify, do not re-add.

**Step 10 — first deploy.** The bucket is empty at this point, so the site is a 404 until this runs.
No successful deploy exists yet: the runs from step 9.5's commit are **skipped**, not failed, so
there is nothing to "retry" in the sense the old text meant. With the variables now set, either
trigger a fresh run or re-run the skipped one — both work, and `gh workflow run deploy.yml` (no
`--ref`, no `-f ref=`; §13.4's trust-policy note) is the simpler of the two:

```bash
gh workflow run deploy.yml          # or: gh run rerun <skipped-run-id>
gh run watch
```

Expect **~3 minutes** (checkout + `npm ci` + build + seven syncs + invalidation). Thereafter every
push to `main` that passes CI deploys automatically.

**Step 11 — wait for the invalidation** (~30–60 s after the run goes green) before curling.

**Step 12 — verify.** Run every command in §13.7. **V9a** (the bucket policy actually grants
`ListBucket`) and **V9b** (a missing puzzle returns `404` client-side) are both **release gates**
(D1), not formalities — and they are not redundant: the `403 → 404` `custom_error_response`
(§13.2.6) makes V9b pass identically whether or not V9a's grant exists, so V9b alone proves nothing
about D1.

**Step 13 — changing a `Cache-Control` class later.** `aws s3 sync` will not re-header objects it
considers unchanged (D8). After editing a pass in `deploy.yml`, re-header what is already in the
bucket with a `cp`, not a `sync`:

```bash
aws s3 cp "s3://motodle-site-051946164308/puzzles/" "s3://motodle-site-051946164308/puzzles/" \
  --recursive --exclude "*" --include "*.json" \
  --metadata-directive REPLACE \
  --content-type "application/json" --cache-control "public, max-age=300"
```

**Rollback.** The site is whatever the last successful deploy uploaded, so a rollback is a redeploy
of an older commit:

```bash
gh workflow run deploy.yml -f ref=<good-sha>   # runs FROM main; OIDC sub stays refs/heads/main
gh run watch
```

`gh workflow run deploy.yml --ref <branch>` fails at the AssumeRole step by design — the trust
policy is `StringEquals` on `refs/heads/main` only (`infra/iam.tf`, §13.2.8); `--ref` also cannot
take a SHA. The commit to deploy is an **input** (`inputs.ref`), never a ref: the dispatch itself
always runs from `main` (so the OIDC `sub` stays `repo:reenchree/motodle:ref:refs/heads/main`), and
the workflow's checkout step resolves `inputs.ref || github.event.workflow_run.head_sha ||
github.sha` (§13.4 note 2) to pick the commit it actually builds. Expect the same ~3 minutes plus
~60 s of invalidation. Two caveats: hashed `/assets/*` files from the newer build are deleted, so
any browser still holding the newer `index.html` (up to 60 s of edge cache, then a revalidate) will
404 on its bundle and needs one reload; and rolling back **content** (a bad puzzle) is better done as a
forward commit, since puzzle JSON is only 5-minute-cached (D2) and a revert deploy is the slower path.
Infrastructure rollback is `git revert` on `infra/` plus `terraform apply` — never a console edit,
which would drift the HCP state.

### 13.7 Verification matrix

Every row is a command. Run them after the first deploy and after any change to `deploy.yml` or
`infra/cloudfront.tf`. `H='https://playmotodle.com'` throughout.

Every 200 response on every path class carries the same five security headers, because one
response-headers policy is attached to all five behaviours:

```
content-security-policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'
strict-transport-security: max-age=63072000; includeSubDomains
x-content-type-options: nosniff
x-frame-options: DENY
referrer-policy: strict-origin-when-cross-origin
```

| # | Path class | Command | Expected status | Expected `cache-control` | Expected `content-type` |
|---|---|---|---|---|---|
| V1 | entry point | `curl -sI "$H/"` | `200` | `public, max-age=0, must-revalidate, s-maxage=60` | `text/html; charset=utf-8` |
| V2 | hashed JS | `A=$(curl -s "$H/" \| grep -o '/assets/[^"]*\.js'); curl -sI "$H$A"` | `200` | `public, max-age=31536000, immutable` | `text/javascript; charset=utf-8` |
| V3 | hashed CSS | `C=$(curl -s "$H/" \| grep -o '/assets/[^"]*\.css'); curl -sI "$H$C"` | `200` | `public, max-age=31536000, immutable` | `text/css; charset=utf-8` |
| V4 | puzzle image | `curl -sI "$H/puzzles/img/0001/l1.webp"` | `200` | `public, max-age=31536000, immutable` | `image/webp` |
| V5 | today's puzzle | `curl -sI "$H/puzzles/2026-09-02.json"` | `200` | `public, max-age=300` | `application/json` |
| V6 | archive manifest | `curl -sI "$H/puzzles/manifest.json"` | `200` | `public, max-age=300` | `application/json` |
| V7 | catalog | `curl -sI "$H/catalog.json"` | `200` | `public, max-age=300` | `application/json` |
| V8 | static 404 page | `curl -sI "$H/404.html"` | `200` | `public, max-age=0, must-revalidate, s-maxage=60` | `text/html; charset=utf-8` |

Behavioural checks — these are the ones that catch real breakage:

| # | What | Command | Expected |
|---|---|---|---|
| **V9a** | **The `ListBucket` grant is actually present (D1 — RELEASE GATE, policy)** | `aws s3api get-bucket-policy --bucket motodle-site-051946164308 --query Policy --output text \| jq -e '[.Statement[] \| select((.Action\|type=="array" and index("s3:ListBucket")) or .Action=="s3:ListBucket")] \| length >= 1' >/dev/null && echo "D1 ok: ListBucket grant present"` | prints the `ok` line. This is the check that actually exercises D1 — see the note after V9b. |
| **V9b** | **Missing puzzle is a real 404, client-facing (D1 — RELEASE GATE, behavioural)** | `curl -s -o /dev/null -w '%{http_code}\n' "$H/puzzles/2099-01-01.json"` | exactly `404`. Proves the client contract only — the `403 → 404` `custom_error_response` (§13.2.6) means this passes identically whether or not the `ListBucket` grant exists, so it does **not** substitute for V9a; see Note 3 in §13.2.6. |
| V10 | …and it carries the 404 page body, not a JSON parse trap | `curl -s "$H/puzzles/2099-01-01.json" \| head -1` | `<!doctype html>` — fine; the client only reads the status |
| V11 | Negative cache is short, empirically (D3) | Two timed `GET`s: `curl -s -o /dev/null -w '%{http_code} %{time_total}\n' "$H/puzzles/2099-01-01.json"` at `t=0`, again at `t=70`, comparing `x-cache` on each (`curl -sI ... \| grep -i x-cache`) | `x-cache: Hit from cloudfront` (or `Error from cloudfront`, cached) on a call shortly after the first; a call **after 70 s** shows a fresh `x-cache: Miss from cloudfront`/`Error from cloudfront` with a new response, i.e. it re-hit the origin. Don't rely on the `Age` header — CloudFront does not reliably emit it on error responses. See Note 3 in §13.2.6 for why this measures ≈60 s, not 10 s. |
| V12 | Missing page → 404, never `index.html` | `curl -s -o /dev/null -w '%{http_code}\n' "$H/no-such-page"` | `404` (and the body is the 404 page, **not** the app) |
| V13 | `www` → apex, 301 | `curl -sI "https://www.playmotodle.com/"` | `301`, `location: https://playmotodle.com/` |
| V14 | `www` redirect preserves the query string | `curl -sI "https://www.playmotodle.com/?d=2026-09-01"` | `location: https://playmotodle.com/?d=2026-09-01` |
| V15 | `www` redirect covers assets too (D6) | `curl -sI "https://www.playmotodle.com/catalog.json"` | `301` to the apex path — **not** a `200` |
| V16 | http → https, both hops | `curl -sIL "http://www.playmotodle.com/"` | Two hops: `301` to `https://www.playmotodle.com/`, then `301` to `https://playmotodle.com/`. `curl -sIL` follows and terminates at the apex; don't expect a single 301 straight to the apex over `http`. |
| V17 | IPv6 | `curl -6 -sI "$H/"` | `200` (the box needs working IPv6; `dig AAAA playmotodle.com +short` should return CloudFront addresses either way) |
| V18 | TLS floor | `curl --tlsv1.3 -sI "$H/" >/dev/null && echo ok` and `openssl s_client -connect playmotodle.com:443 -tls1_1 </dev/null 2>&1 \| grep -i 'handshake failure\|no protocols available\|alert'` | first succeeds; second shows a handshake failure (`TLSv1.2_2021`). Don't use `curl --tls-max 1.1` for the negative half — OpenSSL 3 refuses to even offer TLS 1.1 locally, so that command fails before it reaches the network and proves nothing about the distribution. |
| V19 | Bucket is not public | `curl -sI "https://motodle-site-051946164308.s3.us-west-2.amazonaws.com/index.html"` | `403` — direct S3 access must be denied; only CloudFront's signed OAC requests work |
| V20 | Compression | `curl -sI -H 'Accept-Encoding: br' "$H/catalog.json" \| grep -i content-encoding`, repeated once | `br` (or `gzip`) on the repeat — compression is negotiated when the object is cached from a `GET`; a `HEAD`-only single call can miss it on a cold cache |
| V21 | Security headers present on every class | `curl -sI "$H/" \| grep -icE 'content-security-policy\|strict-transport-security\|x-content-type-options\|x-frame-options\|referrer-policy'` | `5` — one hit per header. Repeat against `$H/catalog.json`, `$H/puzzles/img/0001/l1.webp`, and `$H/404.html` — same policy is attached to all five behaviours (§13.2.6). |
| V22 | Served CSP matches the shipped string | `curl -sI "$H/" \| grep -i content-security-policy` | byte-identical to the string in §13.2.3 / Note 1 below — a stale edge distribution config would drift silently otherwise |

If V9a or V9b fails, do not launch. If V15 fails, the function is attached to only some behaviours.

### 13.8 Cost, accepted trade-offs, and what is deliberately not built

**Cost — about $0.50/month.**

| Line | Monthly |
|---|---|
| Route53 hosted zone (`playmotodle.com`) | **$0.50** |
| Route53 queries | **$0.00**, exactly — an alias record resolving to a CloudFront distribution is not billed per query at all (only non-alias queries are); the "$0.40/M at volume" line from the original brief draft doesn't apply here |
| CloudFront data transfer + requests | **$0.00** — the *always-free* tier covers 1 TB out and 10 M requests per month; a 1.2 MB site at hobby traffic is nowhere near it |
| ACM public certificate | $0.00 |
| S3 storage (~1.2 MB, growing ~350 KB per puzzle) | < $0.01 |
| S3 requests (a deploy is ~26 PUTs) | < $0.01 |
| CloudFront invalidations | $0.00 — 1,000 paths/month free **per AWS account** (account `051946164308` also carries `terraform-core`'s workloads, so this line is shared, not exclusive to `motodle`); 5 paths per deploy ≈ 200 free deploys before any other account activity is counted |
| www→apex CloudFront Function | $0.00 — runs on every viewer request across all five behaviours (D6), but Functions get 2 M free invocations/month; listed so it's a decision, not an omission |
| HCP Terraform | $0.00 on the free tier |
| **Total** | **≈ $0.50** (exact — every other line is genuinely $0.00 or a rounding error, not just "small") |

**Accepted: future puzzles are publicly readable before their date.** Content publishing is just a
commit — `npm run generate` writes `public/puzzles/<date>.json` and `public/puzzles/img/NNNN/*` for
days ahead, and the deploy uploads all of them. `dist/` today already contains 2026-09-03 and
2026-09-04. Worse, `/puzzles/manifest.json` publishes the list and the `latest` date, so a determined
player does not even have to guess a URL — they can read tomorrow's answer with two `curl`s. This is
**accepted** for a casual game: hiding it would mean a scheduled publish step, which means a server,
which is the one thing this design does not have. Nothing in the client leaks it — the app never
fetches a future date (§4.6 strips a future `?d=`), so a normal player never sees it.

**Operational corollary: nothing deploys on a schedule either.** The committed puzzle runway is
whatever `npm run generate` last produced and a human pushed — `dist/` as of this writing holds
`2026-09-02..04`, three days. The moment that runway is exhausted the site silently starts showing
"No Motodle today" at local midnight, with no alert, because there is no server to notice. Check the
runway with `curl -s "$H/puzzles/manifest.json" | jq -r .latest` and compare against today's date;
keeping at least a week ahead is a reasonable target given the fetcher/review loop (§6.3) is a manual
step, not a cron job.

**Accepted: the reaper race.** Pass G (`aws s3 sync dist/ … --delete`, §13.4) runs *after* pass F has
already published the new `index.html`, and `index.html` is served with `s-maxage=60`. For up to a
minute after a deploy, an edge PoP that has not yet revalidated can still be handing out the
**previous** `index.html`, which names the **previous** hashed bundle — and pass G has just deleted
that bundle from the bucket. A viewer unlucky enough to fetch the old HTML in that window gets a hard
404 on `/assets/index-<oldhash>.js` and a blank page; a reload after the invalidation lands fixes it.
The window is bounded by the `s-maxage` (60 s) and the deploy's own `/index.html` invalidation
(~30–60 s), and it only bites viewers who load the site *during* those seconds, on a PoP that has not
revalidated. **Accepted as-is for a hobby site** — the alternatives (keep N old builds, or a two-phase
deploy) both need bookkeeping this design deliberately does not have. If it ever matters, the cheap
mitigation is one line: add `--exclude "assets/*"` to pass G so hashed bundles are never reaped, and
prune the accumulated `assets/` keys by hand every few months (`aws s3 ls s3://$SITE_BUCKET/assets/`
against the current `dist/assets/`). Noted 2026-09-02 (§11.12) from the pre-apply infra review; it
changes no `.tf` file and no workflow file today.

**Related, and worth knowing:** `/puzzles/img/NNNN/*` is keyed by puzzle **number**, not content, and
future-dated images ship before their date — so bytes at an "immutable" path can legitimately change
if the operator re-crops a not-yet-live puzzle. The deploy's `/puzzles/*` invalidation clears the edge,
so the change does propagate; the residual exposure is the browser cache of anyone who already fetched
that future image, which in practice is nobody. For an **already-published** day, §9.5's procedure
still applies: republish under a new prefix (`/puzzles/img/NNNN-b/…`) and let the 5-minute JSON TTL do
the rest.

**Deliberately not built.** Each of these is a decision, not an oversight.

| Not built | Why | Revisit when |
|---|---|---|
| AWS WAF | ~$5–8/month floor — more than 10× the rest of the stack — to protect a bucket of public static files with no origin logic and no write path | Never, for this site |
| CloudFront standard/real-time logging | Costs S3 storage and buys nothing at hobby traffic; there is no dashboard to feed it | A real traffic question exists (e.g. "did the launch land?") |
| Origin Shield | An extra per-request charge for a single-region origin with a tiny working set | Never |
| S3 versioning on the site bucket | Every deploy is `--delete`; versions would accumulate for a site whose true source of truth is git | Never |
| Amplify / S3 website hosting / any PaaS | Website endpoints cannot use OAC, and the bucket must stay private | Never |
| The S3 + `use_lockfile` state backend from the original brief | Withdrawn by the operator (D9) in favour of HCP Terraform | It is already replaced |
| HCP **remote** execution with dynamic AWS credentials | It is `terraform-core`'s pattern and the `app.terraform.io` OIDC provider already exists in the account — but it needs its own IAM role, and local execution needs no AWS identity in HCP at all | A second person or a CI job needs to apply this module |
| A deploy-time smoke test that auto-rolls-back | The §13.7 matrix is a human gate; automating a rollback needs a health signal this site does not have | The site earns an uptime expectation |
| `robots.txt`, `sitemap.xml`, an OG/social image | None exist in the repo (§13 recon); they are content decisions, not deploy plumbing. Note `robots.txt` specifically interacts with the future-puzzle exposure above: it wouldn't change what's fetchable, but a `Disallow: /puzzles/` would keep tomorrow's answer out of search-engine indexes, which is a step beyond "a determined player can curl it." Deferred with the rest of this row, not forgotten. | Launch marketing |
| Staging / preview environments | One distribution, one bucket, one domain. `vite preview` under the production headers (§13.5.2) is the pre-merge check | Never, for this site |

### 13.9 Workstream W6 — deployment *(owner: `deploy`)*

Runs after §12; depends on nothing in §1–§11 except that the build is green. It is the only
workstream that touches `infra/` and `.github/workflows/deploy.yml`.

#### File set — exactly what W6 creates and edits

**Creates (15 files):**

```
infra/versions.tf          §13.2.1
infra/backend.tf           §13.2.2
infra/variables.tf         §13.2.3
infra/locals.tf            §13.2.4
infra/data.tf              §13.2.4
infra/s3.tf                §13.2.5
infra/cloudfront.tf        §13.2.6
infra/acm.tf               §13.2.7
infra/route53.tf           §13.2.7
infra/iam.tf               §13.2.8
infra/outputs.tf           §13.2.9
public/404.html            §13.5.1
.github/workflows/deploy.yml   §13.4
schema/csp-contract.test.ts    W6-5 below
e2e/csp.spec.ts                W6-4 below
```

`infra/.terraform.lock.hcl` appears after the first `terraform init -backend=false` and **is
committed**.

**Edits (4 files):**

| File | Change |
|---|---|
| `vite.config.ts` | add the `preview: { headers: … }` block and the `CONTENT_SECURITY_POLICY` import (§13.5.2). Change nothing else — `appType: 'mpa'`, the plugins and the `test` block are §10.3-frozen |
| `schema/constants.ts` | add `export const CONTENT_SECURITY_POLICY = "…";` — the D4 string, byte for byte |
| `.gitignore` | add a Terraform block: `infra/.terraform/`, `infra/tfplan`, `*.tfstate`, `*.tfstate.backup` (`infra/.terraform.lock.hcl` is deliberately **not** in this list — it's committed) |
| `README.md` | add a `## Deploying` section (W6-6) |

Nothing else. W6 does **not** touch `ci.yml`, any `src/**` file, any puzzle content, or
`terraform-core`.

#### W6-1 … W6-6, in order

- **W6-1 — `infra/`.** Create the eleven `.tf` files literally from §13.2. Then, from `infra/`:
  `terraform init -backend=false && terraform validate && terraform fmt -check -diff`. Commit
  `.terraform.lock.hcl`; add the ignores. Remember D10: this proves the resources, **not** the
  `cloud {}` block. `.terraform.lock.hcl` as generated is `linux_amd64`-only, which is fine while the
  operator applies from this workstation; if that ever changes, regenerate it first with
  `terraform providers lock -platform=linux_amd64 -platform=darwin_arm64` (or whatever platforms
  apply) before committing, so a different machine's `init` doesn't silently need network access it
  might not have.
- **W6-2 — `public/404.html`.** Literal from §13.5.1. Then `npm run build` and confirm
  `dist/404.html` exists and is byte-identical (Vite copies `public/**` verbatim).
- **W6-3 — `deploy.yml`.** Literal from §13.4. It must parse and the `if:` gate must keep all three
  conditions.
- **W6-4 — `vite.config.ts` preview headers** (§13.5.2) **and `e2e/csp.spec.ts`**, then
  `npm run build && npm run test:e2e`. `csp.spec.ts` installs a `securitypolicyviolation` listener
  via `page.addInitScript` before navigation, plays a full winning round (help modal close, three
  guesses, win, share/clipboard, stats reload) plus a direct visit to `/404.html` for its inline
  `<style>` element, and asserts zero violations and zero console/page errors across all of it —
  without it, (a) buys nothing: the CSP would be wired but nothing would fail if it were wrong. All
  nine spec files (the eight scripted-playthrough specs plus this one) must pass **under the
  production CSP**. A failure here means the CSP is wrong, not that the test is wrong. Note: `vite
  preview`'s `appType: 'mpa'` returns a bare, empty-body `404` for an unmatched path — it does not
  replicate CloudFront's `custom_error_response` rewrite to `/404.html`'s body (that's an
  infra-only behaviour, covered instead by V9b/V12 in §13.7) — so the spec probes the 404 page's CSP
  compliance by visiting `/404.html` directly (a real 200 response locally, matching V8), not by
  navigating to a nonexistent path and expecting its body.
- **W6-5 — the CSP no-drift contract test.** Add `CONTENT_SECURITY_POLICY` to `schema/constants.ts`
  and create `schema/csp-contract.test.ts`. It is picked up by the existing
  `schema/**/*.test.ts` vitest include, so `npm test` and CI run it with no config change. The
  regex below was verified against the §13.2.3 file:

  ```ts
  /**
   * §13.9 W6-5 — the CSP the app is tested under and the CSP CloudFront serves must be the same
   * string. Same no-drift pattern as the normalizeId test (§7.2 #10).
   */
  import { readFileSync } from 'node:fs';
  import path from 'node:path';
  import { describe, expect, it } from 'vitest';
  import { CONTENT_SECURITY_POLICY } from './constants';

  const ROOT = path.join(__dirname, '..');

  describe('CSP no-drift', () => {
    it('infra/variables.tf ships exactly CONTENT_SECURITY_POLICY', () => {
      const tf = readFileSync(path.join(ROOT, 'infra/variables.tf'), 'utf8');
      const block = tf
        .split(/^variable /m)
        .find((b) => b.startsWith('"content_security_policy"'));
      expect(block, 'variable "content_security_policy" missing from infra/variables.tf').toBeDefined();
      const match = /^\s*default\s*=\s*"([^"]*)"\s*$/m.exec(block as string);
      expect(match, 'no default = "…" inside the content_security_policy variable').not.toBeNull();
      expect((match as RegExpExecArray)[1]).toBe(CONTENT_SECURITY_POLICY);
    });
  });
  ```

- **W6-6 — `README.md` `## Deploying`.** Short — a pointer, not a copy. It must say: the site is S3 +
  CloudFront at `https://playmotodle.com`; infrastructure is `infra/` (Terraform, HCP state, workspace
  `motodle`, **local** execution); deploys are automatic on a green CI run on `main` via
  `.github/workflows/deploy.yml`; the three repository variables and where they come from; and
  "full runbook and verification commands: `docs/PLAN.md` §13.6–§13.7". Do not restate the HCL or the
  curl matrix in the README.

#### Definition of done

| # | Check | Command |
|---|---|---|
| 1 | Terraform is formatted | `terraform fmt -check -recursive infra/` → no output, exit 0 |
| 2 | Terraform is valid | `cd infra && terraform init -backend=false && terraform validate` → *"Success! The configuration is valid."* |
| 3 | `deploy.yml` parses, **and the deploy gate survives** | `python3 -c "import yaml; g=yaml.safe_load(open('.github/workflows/deploy.yml'))['jobs']['deploy']['if']; assert all(s in g for s in ['workflow_dispatch', \"conclusion == 'success'\", \"event == 'push'\", \"head_branch == 'main'\", \"vars.AWS_DEPLOY_ROLE_ARN != ''\"])"` — parsing alone doesn't prove the four-condition `if:` (§13.4 item 1) survived an edit; this asserts all five substrings are still present in whatever the parser hands back, the pre-provisioning guard included |
| 4 | The 404 page ships | `npm run build && test -f dist/404.html` |
| 5 | The app works under the production CSP | `npm run test:e2e` (with W6-4 applied) — 9 spec files green (the pre-existing 8 plus `e2e/csp.spec.ts`), and **zero** `securitypolicyviolation` / console errors in the run |
| 6 | CSP cannot drift | `npm test` — `schema/csp-contract.test.ts` green |
| 7 | Existing gates still green | `npx svelte-check --tsconfig ./tsconfig.json`, `npx tsc --noEmit`, `npm run build` (budgets) |
| 8 | README section added | `grep -q '^## Deploying' README.md` |

Checks 1–8 are all runnable by an agent with no AWS session and no network beyond the Terraform
registry.

#### What only the operator can do

Agents cannot and must not attempt any of these — the SSO session is expired, and every one of them
is a write to something outside the repo:

1. `aws sso login` and anything requiring AWS credentials, read or write.
2. `terraform login`, and the two HCP API `curl`s that create the workspace with **local** execution
   (§13.6 steps 3–5). **Nothing works until the workspace exists in `local` mode** (D9).
3. `terraform init` (real), `terraform plan`, `terraform apply` — and only the operator will ever see
   whether the `cloud {}` block is right (D10).
4. `gh variable set` ×3 — the workflow fails its first step until all three exist.
5. Triggering the first deploy and running the §13.7 verification matrix. **V9a (the bucket policy
   actually grants `s3:ListBucket`) and V9b (a missing puzzle returns `404` client-side) are both
   the release gate — V9b alone cannot prove V9a, because the `403 → 404` custom error response
   makes it pass either way.**
6. Deciding whether the 60 s negative-cache TTL (D3) stays, once real traffic exists.
