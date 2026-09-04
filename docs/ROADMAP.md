# Motodle roadmap

What we could do next, in rough priority order. Each item says what it is, why, and what it
costs. The launch checklist itself lives in `docs/LAUNCH.md` (sections A–C) and is not repeated
here beyond a pointer. Status as of 2026-09-04: live at https://playmotodle.com with puzzles
scheduled through 2026-10-07; the 2026-09-03 batch was spot-checked and signed off by the operator.

## 1. Report an inaccuracy (player-facing, first)

**What.** A "Something wrong?" link on the result screen so a player can flag a wrong make,
model or year, a bad crop, or a spoiler in the photo. This is the one feedback loop the game
lacks: every answer is verified by two vision passes and one human skim, but real riders will
still know things the reviewers did not (a 1996 vs 1997 fairing, a model sold under another name
in their market).

**Design, no backend.** Two tiers, both free:

1. *One-click count.* The link fires the same first-party image request the analytics beacon
   uses (`/assets/mtd.gif?e=r&n=<puzzle>&k=<kind>`), where `kind` is one of `make`, `model`,
   `year`, `photo`. It lands in the CloudFront access log; an Athena query lists puzzles by
   report count per kind. No free text, no PII, no CSP change, and it works even before the
   repo is public. Requires LAUNCH.md A.3 (logs) and the beacon plumbing from A.5.
2. *Tell us more.* Under the buttons, a link to a prefilled GitHub issue
   (`.github/ISSUE_TEMPLATE/inaccuracy.yml`: puzzle number, what is wrong, source). Only live
   once the repo is public (LAUNCH.md B6). Until then, the About page's contact link.

**What it costs.** ~40 lines of Svelte in `ResultModal`, one issue template, one Athena query.
Show the control only after the round ends, so it never leaks the answer.

**How a report gets acted on.** The puzzle JSON is served with a 5-minute TTL, so a wrong year
is a one-line edit to `docs/content-review/<batch>.json` (`operator.year`), then
`npm run schedule -- --review … --start <date>` and a push. Images live at immutable paths, so
a re-crop of an already-played day needs the `-b` republish prefix from PLAN §9.5, which is not
implemented yet (see 5).

## 2. Launch plumbing (docs/LAUNCH.md)

In order: B1 deploy plumbing → B8 done (budget lives in terraform-core) → B2 OG image and head
metadata → B3 robots/sitemap → B4 About page and contact → B9 runway alert → B7 error
visibility → A.3/A.6 logs and Athena → A.5 beacon (operator decision) → B5/B6 README and the
public flip. Community drafts are in section C; posting is operator-only.

## 3. Manual add without AI, then the review desk (operator tooling)

**Requirement (operator, 2026-09-04): new puzzles must be addable without any AI in the loop,
straightforwardly.** Today that is possible but takes three commands and a JSON edit
(docs/CONTENT-RUNBOOK.md, "Manual path"). Two steps close the gap:

1. `npm run add -- --commons "File:…" --model <catalogId> --year <yyyy> --date <yyyy-mm-dd>
   [--focus x,y] [--crop x,y,w,h]` — fetches the file's metadata through the existing client,
   runs the same licence/author/width gates, downloads the original, crops, writes a one-page
   preview of the five levels + full reveal to open in a browser, and schedules the date.
   Also accepts `--file <local photo>` with `--author` for your own photographs.
2. The review desk below, which is the same thing with a UI and a queue.

The AI batch path (docs/CONTENT-RUNBOOK.md, "Batch path", scripts in `tools/batch/`) stays as
the volume accelerator — a future agent can run a year's worth from those instructions — but
nothing in the pipeline depends on it.

### Review desk

`npm run review` serving a local page: candidate queue with thumbnail, Commons text and both
AI verdicts; approve / hold / reject; year override; click-to-set focus with a live preview of
all five levels; drag box for `sourceCrop`; "add photo" by Commons URL or own upload; schedule
button that assigns dates and shows the runway. Writes the same `data/review/*.json` and runs
the same tools, so nothing downstream changes. Also the natural place to re-try the 13 held
candidates from the first batch, nine of which only need a tighter crop to fit the byte budgets.

## 4. Content

**Pipeline direction (measured, see docs/CONTENT-WITHOUT-AI.md):** eight deterministic gates in
`tools/fetch.ts` (mime, catalog-year window, capture-date year, second make in title, sidecar in
title, production-span prose, detail and event tokens in the filename) remove 35 % of bad candidates
at 93 % precision for free; a new `tools/check.ts` (tesseract OCR for year text on every rendered
level, YuNet face detection, optional COCO detector for sole-subject) turns the placard and faces
rules into build-time tests; then ONE identity-only vision pass over the ~half nothing flags; then
the operator's skim. Wrong-bike (21 % of reviewed candidates) has no metadata or classic-CV handle,
so a fully model-free batch is possible only at ~80 operator-minutes per 125 candidates. Also: fix
`dateTimeOriginalYear()` (reads only a leading token; Commons returns free-text HTML), add
`prop=categories` to the fetch query, use `filew:>2182` in searches, and fetch
`Category:Motorcycles on white background` (299 files, 5/5 passed) as the first tier.


- Next batch by ~2026-09-25 so the runway never drops under two weeks (fetch → blind ID →
  adjudication → crop check, ~1 evening of agent time per 30 puzzles).
- Catalog gaps the first batch exposed: a vintage Indian Scout (the current entry is the 2015+
  model), Indian Sport Scout, Norton Manx, NSU Sportmax, Triumph TR6 Trophy; more variant
  entries where Commons categories are per variant.
- Consider raising `CROP_BUDGET_BYTES` / `FULL_BUDGET_BYTES` or adding a pre-downscale step:
  7 of 40 approved photos failed the byte budgets only because they were large, grainy scans.
- Puzzles #1–#3 are 800–960 px dev fixtures and look soft; replace their photos once a
  re-crop path for played days exists (5), or accept them as history.

## 5. Corrections for already-played days

PLAN §9.5's `-b` republish prefix (`/puzzles/img/NNNN-b/`) is designed but not implemented;
`srcPrefix` is hard-coded in `tools/generate.ts` and `tools/schedule.ts`. Without it, fixing a
bad crop on a day people have already loaded means their browser keeps the old immutable image
for a year. Small change; needed the first time item 1 produces a real photo problem.

## 6. Player features (from community expectations, LAUNCH.md C)

- Hard mode (no yellow hints). Revisit if completion rate from Athena Q3 is above ~70 %.
- Result modal that can be reopened (`openResult()` currently has no caller, so closing it
  loses the answer photo and credits for the session).
- Cross-device stats sync (PLAN §9.1): storage schema v2 with per-puzzle completion rows, then
  a remote backend. This is the first item that needs a server.
- Photo submissions from players (PLAN §9.2): an ingest that writes a `ReviewCandidate`; the
  review desk (3) is the approval side.

## 7. Operations

- Prometheus/blackbox probe of the public site from sea-k3s as a second runway detector,
  once the GitHub Actions one has run for a while.
- Drop the `www_to_apex` CloudFront Function from `/assets/*` and `/puzzles/img/*` if sustained
  traffic approaches ~5,000 visits/day: it is the binding free-tier limit (2M invocations).
- terraform-core's `GitHubOIDCECRPushRole` trust still lists only the legacy subject form;
  add `repo:reenchree@213154582/*:*` before the next new repo needs it.
