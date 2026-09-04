# Content runbook

How a batch of puzzles gets made, written so a future session (human or agent) can repeat it
without this conversation. Two paths: the **batch path** (AI vision review, ~30 puzzles per
evening) and the **manual path** (no AI, one puzzle at a time). Both end in the same files and
the same `npm run schedule`, so they can be mixed freely.

Rules that never change: the answer is verified before it ships; the operator can veto any
future date; nothing here posts anywhere or touches AWS.

## Files

| File | Role |
|---|---|
| `data/review/<batch>.json` | The working "database" for a batch: one `ReviewCandidate` per photo, `decision` + `operator.*` are the only human-edited fields (PLAN §3.4). Git-ignored. |
| `docs/content-review/<batch>.json` | Tracked copy of the finished batch, the durable record (verdict reasons, holds, focus/crops). |
| `.cache/wikimedia/` | Response + original-image cache, 7-day TTL. `schedule` reads originals from here and never downloads. |
| `public/puzzles/YYYY-MM-DD.json`, `public/puzzles/img/NNNN/` | Output. Committed. Push = deploy. |
| `tools/batch/` | The helper scripts used in the 2026-09-03 batch, and the two Workflow scripts. |

## Batch path (AI vision review)

Runs from the repo root. Numbers are from the first batch (2026-09-03): 330 models → 1,041
candidates → 182 eligible → 125 reviewed → 46 approved → 33 shipped.

1. **Fetch.** Pick model ids (all of them is fine; misses are cheap) and run the Commons walk:
   ```sh
   node -e 'const c=require("./public/catalog.json");console.log(c.models.map(m=>m.id).join("\n"))' > /tmp/models.txt
   npm run fetch -- --models-file /tmp/models.txt --out data/review/$(date -u +%F)-batch01.json --per-model 8
   ```
   Serial, rate-limited, ~8 minutes. Categories are guessed as `Category:<Make> <Model>`;
   about 40 % of hits are the wrong bike or an unusable composition, which is what the review
   is for. Re-runs replay from the cache. `fetch` also auto-`reject`s EIGHT deterministic hard
   gates before anything reaches a human (CONTENT-WITHOUT-AI.md §5; measured 27/79 rejects
   caught, 0/46 passes lost on the 2026-09-03 batch) — each pushes its own `warnings[]` string:
   not a photograph (wrong mime or poster/scale-model wording), the proposed year outside
   `catalog.models[].years` ±1, the proposed year matching only the capture date, a second
   catalog make in the filename, sidecar wording in the filename, production-span prose in the
   description, a detail token in the filename (never front/rear/left/right), and an event token
   in the filename. It also writes ranking-only `signals` (museum wording, a trailing series
   marker, portrait aspect, description-only year, absent model name, SDC P180 presence/match,
   uploader) — shown to the operator, never auto-decided.
2. **Triage** into a pool (usable 4:3 width ≥ 2182 px, year confidence high/medium, ≤ 2 per
   model, balanced by make; skip models already scheduled):
   ```sh
   node tools/batch/triage.js data/review/<batch>.json /tmp/pool.json 90
   ```
   Then attach the cached Commons descriptions (the same script's sibling logic lives at the
   bottom of `triage.js` in comments; the first batch did it inline) and download thumbnails:
   ```sh
   IDS=$(node -e 'console.log(require("/tmp/pool.json").map(x=>x.candidateId).join(","))')
   npm run prefetch -- --review data/review/<batch>.json --ids "$IDS" --thumbs /tmp/thumbs
   ```
3. **Verify** with the Workflow tool (user opt-in required — "use a workflow"). Script:
   `tools/batch/workflows/content-verify.js`. Args: `{ ids: [...], thumbsDir, poolPath, today, start }`.
   Stage 1 identifies each photo BLIND (no metadata, only the image + catalog); stage 2
   adjudicates against Commons text + catalog years + the blind result and proposes
   focus/sourceCrop. Both Opus. Batches of 8 per agent. On a 4-core box the per-workflow cap is
   2 concurrent agents, so split 90 ids across 2–3 workflow runs. Save each run's `rows` to
   `/tmp/verdicts-N.json`.
4. **Apply** verdicts, cache originals, order for variety, dry-run:
   ```sh
   node tools/batch/apply-verdicts.js data/review/<batch>.json /tmp/verdicts-1.json /tmp/pool.json   # once per run
   npm run prefetch -- --review data/review/<batch>.json --decisions approve --originals
   node tools/batch/order.js data/review/<batch>.json /tmp/pool.json /tmp/pool.json <heldIds,comma>
   npm run schedule -- --review data/review/<batch>.json --start <first free date> --dry-run
   ```
   `order.js` keeps one photo per model and alternates era and make across consecutive days.
5. **Schedule.** `npm run schedule` (no `--dry-run`) crops every approved candidate. If it throws
   `crop.ts: no WebP quality … fits budget`, the candidate right after the last written date is
   too detailed for the byte budgets: set it to `pending` with a `HELD:` note and re-run;
   earlier dates are idempotent. Then `npm run generate` (must leave `git status` clean),
   `npm run build`, `npm test`.
6. **Crop check** with the Workflow tool: `tools/batch/workflows/crop-check.js`, args
   `{ puzzles: [{number, date}, …] }`. Views l1/l2/l4/full per puzzle for legible years,
   faces, placards, blank first clues. Apply any `fix` (focus/sourceCrop into `operator.*`),
   re-run schedule, re-check the changed puzzles by eye.
7. **Review page** for the operator: `NODE_PATH=$PWD/node_modules node tools/batch/mkreview.js
   /tmp/review.html data/review/<batch>.json /tmp/pool.json /tmp/verdicts-1.json,… <fromDate>`
   and publish it as an artifact. The operator spot-checks and can veto any future date.
8. **Commit** `public/puzzles`, `docs/ATTRIBUTION.md`, a copy of the batch under
   `docs/content-review/`, and push. CI runs the generate idempotency gate and the e2e suite;
   deploy follows automatically.

Gotchas already hit: `formatversion=2` returns `imageinfo` as an array; PD files may have no
licence URL (schedule falls back to the file page); an adjudicator's empty focus can arrive as
`0` — treat `0,0` as unset; registration years and event years in titles are not model years;
`Category:Indian Scout` mixes 1920s and 2015+ bikes.

## Manual path (no AI)

**One command** (ROADMAP item 3), for a Commons photo:

```sh
npm run add -- --commons "File:Honda CB750 Four.jpg" --model honda-cb750 --year 1972 \
  --date 2026-11-02 [--focus x,y] [--crop x,y,w,h] [--note "…"] \
  [--review data/review/manual.json] [--dry-run]
```

or your own photograph:

```sh
npm run add -- --file ~/Pictures/my-cb750.jpg --author "Chris Wallace" [--license CC0|PD] \
  --model honda-cb750 --year 1972 --date 2026-11-02 [--focus x,y] [--crop x,y,w,h]
```

What it does, in order — every step through "pre-flight checks" runs whether or not you pass
`--dry-run`; only the schedule + preview write are skipped:

1. **`--commons`**: queries Commons for that ONE file title (same `iiprop`/`iiextmetadatafilter`
   recipe `tools/fetch.ts` uses, plus `wbgetentities` for SDC `P275`) and runs it through the same
   `buildReviewCandidate()` the batch path uses — same licence gate, same year-confidence scan,
   same eight hard gates (§6.5, §6.4, `docs/CONTENT-WITHOUT-AI.md` §5). **`--file`**: reads
   dimensions with `sharp`, builds a candidate by hand (a content-hash-derived `candidateId`,
   since there is no Commons M-id), and copies the file into the Wikimedia response cache under a
   synthetic URL so `schedule.ts`'s cache-only read finds it later — an own photo never touches
   the network at all.
2. Sets `decision: "approve"` and layers `--focus`/`--crop`/`--note` onto `operator.*`.
   `operator.year` is set explicitly whenever it wasn't already the fetcher's own high/medium-
   confidence proposal (own photos: always, since there is no fetcher proposal to defer to).
3. Validates the candidate against `schema/review.schema.json` and **upserts** it into
   `--review` (default `data/review/manual.json`, created if absent) — re-running `add` against
   the same Commons file or the same photo file replaces that one entry rather than duplicating
   it, so tightening a focus/crop is just re-running the same command.
4. Caches the original (`--commons`: `prefetch.ts`'s own logic, through the same client; `--file`:
   the synthetic cache entry from step 1), then runs `schedule.ts`'s own pre-flight asserts
   (`assertSourceWidthApprovable`, `assertAuthorPresent`, `needsYearRescue`) so a bad candidate
   fails here with the same messages `schedule` would give, before anything is scheduled.
5. Unless `--dry-run`: schedules **only this candidate** onto `--date` (never the rest of
   `--review`'s accumulated history — a scratch single-candidate file is what `scheduleApproved()`
   actually runs against, so a `data/review/manual.json` with several earlier approved photos in
   it is never re-dated by a later `add`), then writes `data/preview/<date>.html` — all five
   crop levels plus the full reveal, as data URIs — for you to open in a browser before
   committing anything.
6. Prints the preview path and the next commands: eyeball the preview, `npm run generate`,
   `npm test`, commit, push.

`add` never writes a `check` block (§6.6 legible-year), so `assertOcrResolved` passes silently —
the preview page from step 5 is where *you* look for legible year text on l4/l5 before shipping.
`data/review/manual.json` is `.gitignore`d; copy `data/review/manual.json` to
`docs/content-review/manual.json` in the same commit so a later wrong-year fix (ROADMAP item 1)
has a committed file to edit. Never run `npm run prefetch` over a manual review file — a `--file`
candidate's `thumbUrl`/`originalUrl` are the synthetic `motodle://local-upload/<sha>` scheme,
which goes to a real (and unsupported) `fetch()` once the 7-day cache entry `add` wrote has
expired.

An own photo needs the same ≥2182px usable-4:3-width source `schedule.ts` requires of a Commons
one — `npm run add` has no `--fractions` override, so a too-small photo fails
`assertSourceWidthApprovable` immediately rather than shipping a cropped-in level 1. The synthetic
cache entry a `--file` add writes carries the same 7-day TTL as every other cache entry; scheduling
that date again after the cache has aged out needs another `npm run add` (not `npm run fetch`,
which has nothing to fetch for a local file).

The old multi-command path still works — `npm run add` is a wrapper around exactly these steps,
not a replacement contract — and is the fallback if the wrapper itself is ever broken:

1. Find the Commons file and its M-id (the `pageid` on the file page's "Page information").
2. `npm run fetch -- --models <modelId> --out data/review/manual.json` (or hand-write the
   candidate block, PLAN §3.4 shape; `schema/review.schema.json` validates it).
3. Edit the candidate: `decision: "approve"`, `operator.year` if the title's year is not the
   model year, `operator.focus`, `operator.sourceCrop` if a placard or second bike must go.
4. `npm run prefetch -- --review data/review/manual.json --originals`, then
   `npm run schedule -- --review data/review/manual.json --start <date>`, then look at
   `public/puzzles/img/NNNN/l1.webp` … `full.webp` yourself, then `npm run generate`, `npm test`,
   commit, push.

Neither path needs AI; the AI review (the batch path above) is an accelerator for volume, never
a dependency.
