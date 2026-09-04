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
   is for. Re-runs replay from the cache.
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

Adding one puzzle by hand, today:

1. Find the Commons file and its M-id (the `pageid` on the file page's "Page information").
2. Run the fetch for that one model so the file lands in a review JSON with licence, author
   and year tokens filled in (`npm run fetch -- --models <modelId> --out data/review/manual.json`),
   or hand-write the candidate block (PLAN §3.4 shape; `schema/review.schema.json` validates it).
3. Edit the candidate: `decision: "approve"`, `operator.year` if the title's year is not the
   model year, `operator.focus` (fractions of the image, where level 1 should look),
   `operator.sourceCrop` if a placard or second bike must go.
4. `npm run prefetch -- --review data/review/manual.json --originals`, then
   `npm run schedule -- --review data/review/manual.json --start <date>`, then look at
   `public/puzzles/img/NNNN/l1.webp` … `full.webp` yourself, then `npm run generate`, `npm test`,
   commit, push.

That works, and it is the backup if AI is ever unavailable, but it is not straightforward. The
requirement (ROADMAP item 3) is a one-command add — `npm run add -- --commons "File:…"
--model <id> --year 1996 --date 2026-11-02` that fetches, validates, crops with a default or
given focus, writes a preview page, and schedules — followed by the review desk UI. Neither
needs AI; the AI review is an accelerator for volume, never a dependency.
