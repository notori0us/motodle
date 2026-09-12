# Catalog expansion — plan (2026-09-12)

> Status: APPROVED 2026-09-12 (operator: no new makes; ~850-model tiering as in §3). Execution
> is an Opus run (authoring + review); see §7 for the model split and §8 for the gates. Nothing
> in this file has been applied yet.

## 1. Problem

`public/catalog.json` is the allowed-guess list (PLAN §3.2). It has 55 makes / 333 models, but
the depth is badly skewed: 31 makes have ≤ 2 models and 40 have ≤ 4. A player whose bike is a
Norton Atlas, a KTM 990 SMT, a Honda CBR600RR, an MV Agusta Brutale 800 or a Husqvarna 701 cannot
enter it at all. Wordle's allowed-guess list is far broader than its answer list; ours should be
too.

Per-make counts today (models):

| ≤ 2 | 3 | 4 | 8–10 | 17–18 | 23–37 |
|---|---|---|---|---|---|
| Sunbeam 1; Ariel, Vincent, Matchless, Velocette, Laverda, Beta, Zündapp, NSU, DKW, Maico, MZ, Zero, Puch, ČZ, CFMoto, Kymco, SYM, Hyosung, Bajaj, TVS, Hero, Derbi, Gas Gas, Bultaco, Montesa, Ossa, Sherco, Peugeot, Ural, Dnepr | Benelli, Bimota, Cagiva, Piaggio, Victory, Buell, Husqvarna, Jawa | Norton, BSA, MV Agusta, Indian | Aprilia 8, Moto Guzzi 9, Royal Enfield 10, KTM 10 | BMW 17, Harley-Davidson 17, Triumph 18 | Kawasaki 23, Ducati 23, Suzuki 26, Yamaha 34, Honda 37 |

## 2. Findings that shape the approach

- **Hand-authoring is the only source of `years`.** PLAN C7/§6.10 already establish that neither
  Wikidata nor Commons carries production ranges, and `years` is load-bearing (RULE B model
  yellow). Anything scraped lands as `years: null`, which never yields a hint.
- **The Commons walk in `tools/catalog.ts` is not usable as-is.** Live probe 2026-09-12: a brand
  category is flat and polluted (`Honda motorcycles` = 115 subcats incl. "Honda riders",
  "Honda scooters", "Honda motorcycles by decade", "Salon de la Moto … - Kawasaki", "Tamiya models
  of …"); `mergeCatalog` has no denylist and would import all of it; and the API rate-limited a
  bare curl loop within ~8 calls. `Models of <brand> motorcycles` is scale models. So Commons is
  at best a cross-check, not the source.
- **`aliases` are dead weight.** Nothing under `src/` reads them (the typeahead matcher was
  removed with the combobox). New entries ship `aliases: []`.
- **Ids are frozen by contract.** `schema/catalog-contracts.test.ts` asserts
  `id === normalizeId(make.name + " " + model.name)`, and 36 scheduled puzzles reference ids.
  Renaming an existing model is an id change and breaks puzzles + ATTRIBUTION.
- **Size is a non-issue.** 63 KB raw / 7.7 KB gzipped today against a 150 KB gzipped budget.
  ~900 models ≈ 20 KB gzipped.
- **Delivery is automatic.** `catalog.json` is synced with `max-age=300` and the deploy
  invalidates `/*`, so players get the new list on their next load after push.
- **Guess form is a native `<select>`.** A 70–80-option Honda list is usable (desktop
  type-to-jump, mobile picker), accepted as a trade-off; a typeahead goes on the ROADMAP if any
  make passes ~100.

## 3. Scope — recommended

**Models only; no new makes** (the complaint is depth, not breadth). Makes stay at 55.
Optional add-ons the operator may tick (cap is 60; IT/GB/SE are already in `COUNTRY_NAMES`, so
none of these needs a new country code): Gilera (IT), Moto Morini (IT), Brough Superior (GB),
AJS (GB), Husaberg (SE).

Targets, hand-authored from general knowledge in §6.10 style:

| Tier | Makes | Floor → target per make | Added (approx.) |
|---|---|---|---|
| Thin (≤ 2) | 31 makes | 6–8 (defunct marques with a short catalogue may stop at 5) | ~170 |
| Small (3–4) | 12 makes | 8–12 | ~85 |
| Mid (8–10) | Aprilia, Moto Guzzi, Royal Enfield, KTM | 18–22 | ~45 |
| Large (17–18) | BMW, Harley-Davidson, Triumph | 28–32 | ~35 |
| Big five | Kawasaki, Ducati, Suzuki, Yamaha, Honda | 45–70 (Honda/Yamaha at the top) | ~150 |

Result ≈ 800–850 models. Contract bound becomes **300–1,200** so the next expansion does not need
another test change; §6.10 target text updated to match; PLAN §11 gets "Revision 11 — catalog
expansion 2026-09-12".

Coverage rule per make: the bikes a rider would actually try to guess — every decade the marque
sold in, its flagship/iconic models, its current line-up, and the well-known variants a player
names as a separate bike (GSX-R600/750/1000 are three entries; Monster family + Monster 900 stay
both, per D4). Do not pad with trim levels, colour editions or one-year specials.

Fold in the gaps already on the ROADMAP: a vintage Indian Scout as a separately named entry
(existing `indian-scout` is the 2015+ bike, e.g. `Scout 101` 1928–1931 and `Sport Scout`
1934–1942), NSU Sportmax, Triumph TR6 Trophy.

## 4. Authoring rules (binding on the executor)

1. **Never rename or remove an existing entry.** Existing 333 ids stay byte-identical. A wrong
   existing year range may be corrected; a wrong name may not (add a new entry instead).
2. **House style for `name`:** make not repeated; code or nickname in parentheses when both are
   commonly used (`CB77 (Super Hawk)`, `Hayabusa (GSX1300R)`); displacement families collapsed
   when they are one bike to a rider (`Intruder (VS700/750/800)`); ids opaque, never "fixed" for
   prettiness (`bmwr755` is fine).
3. **Duplicate check before adding:** `normalizeId(make + ' ' + name)` must not collide with an
   existing id, and near-duplicates by different naming (`Ninja ZX-6R` vs `ZX-6R`) are forbidden.
4. **`years`:** `[from, to]` model years, `to = null` if on sale in 2026, **`null` when unsure**
   (§6.10: a wrong range is a misleading yellow, `null` is an honest red). Registration years,
   race seasons and concept reveals are not model years. Bound: `1885 ≤ from ≤ to ≤ 2027`.
5. **`aliases: []`**, `source: "seed"`, `generatedAt: "2026-09-12"`.
6. Keep `KTM 990 Adventure` absent (C9). Other KTM 990s are fine.
7. Sort order in the file is irrelevant to the app but append new models grouped by make so the
   diff reviews cleanly.

## 5. Independent review pass

Years and countries are evaluation inputs, so authoring and checking are split:

- Author pass emits, per new entry, `confidence: high | medium` in a throwaway side file in the
  session scratchpad — never in `catalog.json` (schema has `additionalProperties: false`), and
  not under `data/review/` (that directory is for photo-review batches).
- Review pass (separate agent, fresh context, sees the entry, not the author's reasoning) checks
  **every** range and name. Disagreement or `medium` that the reviewer cannot confirm → `null`.
  Reviewer also flags near-duplicates and style drift.
- Both passes batched by make group, ~60 entries per agent: ~8 author batches + ~8 review
  batches, run 2-wide (this box caps a Workflow at 2 concurrent agents).

## 6. Downstream edits in the same change

1. `schema/catalog-contracts.test.ts`: `has 300-500 models` → `300-1200`; make bound unchanged
   (or 40–80 if makes are added).
2. `docs/PLAN.md` §6.10 target size + a §11 revision entry (what changed and why).
3. `npm run catalog -- --review-only` to regenerate `docs/CATALOG-REVIEW.md` (there is a
   byte-equality test; skipping this fails `npm test`).
4. `PRODUCT.md:120` "55-make / 333-model" → new counts.
5. **`acceptModelIds` on future puzzles (2026-09-13 → 2026-10-07):** every puzzle currently
   accepts exactly one id. For each future puzzle, if the expansion adds a D4-style variant or
   family of the answer (e.g. a `Monster 1200 S` next to `ducati-monster-1200`, a `Commando 850`
   is NOT a variant of `commando-750`), append it. Played dates (≤ 2026-09-12) untouched.
6. `docs/ROADMAP.md`: strike the catalog-gap bullet, add "typeahead if any make > ~100 models".
7. `docs/CONTENT-RUNBOOK.md`: note that `npm run fetch` over all model ids now walks ~850
   categories (~20 min serial) and that many new entries have no Commons category — that is
   expected for a guess-list entry and is not a bug.

## 7. Execution shape (for the Opus run)

Read `../claude-workflow-playbook.md` first. Model assignment per the user's ask: **Opus
authors, Opus reviews** (not the opusplan Sonnet-implements default). The Workflow tool needs the
user's explicit opt-in in their own words ("use a workflow"); without it, run the phases as plain
Agent calls. ~8 author + ~8 review + 2 singleton agents is above the 15-agent size guideline, so
say so when asking. Neither `npm test` nor `e2e/` counts `<option>`s or depends on the model list
being short (e2e selects by id), so nothing in CI resists the growth. Suggested phases:

1. **Inventory** (1 agent): dump current per-make lists + ids; produce the per-make target sheet
   from §3; no writes.
2. **Author** (parallel, 2-wide): per make group, write additions as JSON fragments to the
   scratchpad + confidence side file.
3. **Merge** (script, deterministic): append fragments to `public/catalog.json`, run the
   duplicate/normalizeId check, fail loudly on any collision.
4. **Review** (parallel, 2-wide, fresh agents): §5. Apply verdicts (null-out or drop).
5. **Downstream** (1 agent): §6 items 1–7.
6. **Gates + ship**: §8.

## 8. Gates

```
npm test                                # contracts: ids, countries, year bounds, new count bound, review-file byte equality
npm run check                           # svelte-check + tsc
npm run build                           # budgets incl. catalog gz
git commit && git push                  # push = deploy (ci.yml → deploy.yml, e2e is the gate)
curl -s https://playmotodle.com/catalog.json | jq '.models | length'   # ≥ 800 after invalidation
```

Spot-check in the live UI: pick three thin makes (e.g. Norton, Husqvarna, MV Agusta) and confirm
the model `<select>` shows the new entries; make one guess with a new model to confirm no
`evaluateGuess` throw.

## 9. Operator decisions

Decided 2026-09-12: **no new makes** (stay at 55; the optional list in §3 is off the table), and
the ~850-model tiering in §3 stands. Make bound in the contract test is unchanged.
