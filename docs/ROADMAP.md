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

**Shipped 2026-09-04 (commit a9fb64f), decision D6.** "Something wrong? Report it"
(`#mtd-report-link`) on the result screen opens a prefilled GitHub issue form
(`.github/ISSUE_TEMPLATE/inaccuracy.yml`, label `inaccuracy`): puzzle number, date and answer in
the `puzzle` field, the answer kept out of the title, kind as a dropdown, free-text details. The
URL is built by `src/lib/report.ts`. It shows only after the round ends, so it never leaks the
answer. The link 404s for anonymous visitors until the repo is public (LAUNCH.md B6).

**Dropped.** The one-click count tier (an image request per report, tallied in the access log)
depended on the analytics beacon, and decision D1 (2026-09-04) is logs only, no beacon. If
report volume ever justifies it, the beacon design in LAUNCH.md A.5 still applies.

**How a report gets acted on.** The puzzle JSON is served with a 5-minute TTL, so a wrong year
is a one-line edit to `docs/content-review/<batch>.json` (`operator.year`), then
`npm run schedule -- --review … --start <date>` and a push. Images live at immutable paths, so
a re-crop of an already-played day needs the `-b` republish prefix from PLAN §9.5, which is not
implemented yet (see 5).

## 2. Launch plumbing (docs/LAUNCH.md)

**Done 2026-09-04 (commit 3bf1cd1):** B1 deploy plumbing + `/*` invalidation, B2 OG card + head
metadata, B3 robots/sitemap, B4 About page (privacy text is the logs-only variant — update it in
the same push as A.3), B5 README, B9 runway alert (`runway.yml`, verified green on dispatch), K3
pinned by e2e. **Done 2026-09-04 evening, decisions D1/D2/D6/D7:** A.3 CloudFront access logs v2 → S3
(`infra/logs.tf`, no client IPs, 90-day expiry; HCP run `run-JR8MowCdPArS7dD9` applied after
plan review), About page privacy text updated in the same push, `.claude/` untracked, the
inaccuracy report link (§1), and the repository transferred `reenchree` → `notori0us` with the
deploy role trusting both owners through the move. **Still open:** A.6 Athena table + Step 0
(create after the first log objects land, ~4 h after the apply; the primary workgroup has no
results location, so pass one per query), B7 error visibility is BUILT (`infra/alarms.tf`, `GetInvalidation` on the deploy role, the
`assets/*` reaper exclusion and the post-deploy smoke test in `deploy.yml`); its infra half
applies with the next HCP run and the email subscription appears once the operator sets the
sensitive workspace variable `alert_email` in HCP (the tree must never carry the address); the
history rewrite (commit email → GitHub noreply address, `.claude/` purged from history) is
operator-run — commands in the 2026-09-04 session report; the HCP workspace VCS re-point (blocked on adding `motodle` to the GitHub App
installation on `notori0us` in the browser — exact steps in `docs/HCP-REMOTE-RUNS.md`, last
section), then the pushed infra run (owner flip + B7: expect the deploy role's trust and policy updated,
the SNS topic and two alarms created, nothing destroyed), B6 the public
flip (operator: `gh repo edit notori0us/motodle --visibility public
--accept-visibility-change-consequences`). OG card has no wordmark yet (text rendering is not
byte-deterministic across machines) — a hand-made card or a bundled font is a small follow-up.

In order: B1 deploy plumbing → B8 done (budget lives in terraform-core) → B2 OG image and head
metadata → B3 robots/sitemap → B4 About page and contact → B9 runway alert → B7 error
visibility → A.3/A.6 logs and Athena → A.5 beacon (operator decision) → B5/B6 README and the
public flip. Community drafts are in section C; posting is operator-only.

## 3. Manual add without AI, then the review desk (operator tooling)

**Requirement (operator, 2026-09-04): new puzzles must be addable without any AI in the loop,
straightforwardly.** Step 1 below shipped 2026-09-04 as `npm run add` (docs/CONTENT-RUNBOOK.md,
"Manual path"). Step 2 is the review desk.

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

**Done 2026-09-04 (commit 0505226):** the eight gates (27/79 rejects caught, 0/46 passes lost), ranking signals, `prop=categories`, the capture-date and SDC `.statements` bugs, `npm run check:content` (OCR; faces deferred pending the YuNet licence check and a 300 MB onnxruntime install), `npm run add` (Commons file or own photo, preview page, refuses personality-restricted files). Open: Ural/Dnepr sidecar-native models vs gate 5 (0 candidates today); `--force`/strict flag parsing and a catalog-year sanity check on `--year` in add.ts; the "Source on Commons" label is wrong for own photos.

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

- **Yellow-tile explainer for new players (operator request 2026-09-04).** The first time a yellow
  tile appears in a category, show a one-line hint under the scoreboard: year → "Yellow: within 10
  years"; make → "Yellow: same country as the answer"; model → "Yellow: that model was on sale in
  the answer's year". Once per category per device (a small `motodle:hints` localStorage key,
  schema-versioned like the rest of storage), dismissible, never shown in practice mode after the
  first real-day appearance. Copy lives with the help-modal rules so the two can't drift; the
  hint must not leak the answer (no numbers, no country name).
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
