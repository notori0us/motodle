# Can motodle batches be built without AI vision?

*Analysis 2026-09-04, measured on the first live batch (`docs/content-review/2026-09-03-batch01.json`: 125 reviewed of 1,041 fetched), the cached Commons API bodies, and 20 read-only Commons API calls.*

**Short answer: the composition/placard/faces review can be automated; the wrong-bike review cannot.** Deterministic metadata rules kill 35 % of the bad candidates for free, classic CV (OCR + face detection) pre-annotates most of the rest, but *wrong bike* — 26 of 125 — is a pixel fact with no metadata shadow and no classic-CV handle. Recommended: **deterministic gates → `tools/check.ts` (OCR/faces/detector) → one identity-only vision pass over the ~half that nothing flags → the operator's skim.** A zero-model path is viable at ~80 operator-minutes per 125 candidates, with wrong-bike detection entirely on the human.

---

## 1. The labelled set

125 candidates = 124 with an `operator.note` + 1 approve without. **Positive = passed vision review** (33 `approve` + 13 `pending` held for byte budget / duplicate model — both decided deterministically by `crop.ts` / `schedule.ts`, so scoring them as failures would flatter every signal). **Negative = the 79 `rejected by review 2026-09-03:` notes.** Base rate 46 pass / 79 reject (36.8 %); shipped-only 33/125 = 26.4 %.

Failure classes parsed from the notes (multi-label; a note averages 1.3 blockers):

| class | n | first catchable at |
|---|---:|---|
| placard / legible year in frame | 28 | **OCR** (19 printed Latin) or LLM/human (9 handwritten, CJK, floor paint) |
| wrong bike / mislabel / race special / namesake | 26 | **LLM vision or human** (4 by catalog-year gate) |
| year unsupportable (span, launch, event, capture) | 19 | **metadata** (10 of 19) then human |
| multiple bikes / not sole subject | 11 | **object detector** or LLM |
| faces | 7 | **face detector** |
| detail-only / dashboard / engine | 7 | **filename tokens** (4) + detector (3) |
| geometry / subject invisible | 3 | detector |
| not a photograph (die-cast, scanned poster) | 2 | **metadata** (2/2) |

The 125 span the whole 322-candidate pool (82 of 118 models), but 52 models were only partly reviewed, so 36.8 % is probably a mild over-estimate for the unreviewed 197. n = 125 across 8 classes means several cells hold 2–7 files: **treat every per-class rate as a direction, not a coefficient.**

---

## 2. Per-signal measurements (n = 125, base P(reject) = 0.63)

`prop=categories` is **not** in `tools/fetch.ts`'s query (fetched live for this analysis). SDC uses `props=claims`, so the cache already holds every property: P180 on 169/1041 files, P4082 on 495, P31 on 665.

### Signals that work as hard gates (near-zero cost in passes)

| gate | n hit | rejects | passes lost |
|---|---:|---:|---:|
| `mime != image/jpeg` OR poster/scale-model words | 2 | 2 | 0 |
| `yearProposed` outside `catalog.models[].years` ±1 | 4 | 4 | 0 |
| `yearProposed == DateTimeOriginal` year | 2 | 2 | 0 |
| a *second* catalog make name in the title | 1 | 1 | 0 |
| `sidecar\|Gespann\|Seitenwagen` in title/desc | 9 | 8 | 1 |
| production-span prose near the year (`Bauzeit`, `between X and Y`, `introduced in`) | 7 | 6 | 1 |
| detail token in **filename** (`engine`, `(Motor)`, `dashboard`, `cockpit`, `Heck`, `Tableau de bord`) | 4 | 4 | 0 |
| event token in **filename** (`Salon`, `Bonhams`, `concours`, `festival`, `Olympia`, `Wiki Loves`) | 4 | 4 | 0 |
| **union** | **30** | **28** | **2** |

Confusion matrix of the hard-gate union:

```
                 predicted reject   predicted keep
actual reject           28                51
actual pass              2                44
```

Pool purity 0.368 → **0.463**. Precision on reject 0.93, recall on reject 0.35. The two lost passes are rule bugs, not information loss: match `sidecar` in the **title** only (the description named a *neighbouring* bike), and require production-period *prose*, not a bare `YYYY–YYYY`.

### Signals that only rank (do NOT gate on these)

| signal | n | P(reject \| signal) |
|---|---:|---:|
| museum/show word in title, description **or category** | 52 | 0.67 |
| trailing `(2)` / `(3)` series marker in filename | 23 | 0.78 |
| portrait, h > 1.15·w | 10 | 0.90 |
| year from description only (no title token) | 41 | 0.71 |
| catalog model name absent from title+description | 18 | 0.56 |
| `Commons Quality images` badge | 4 | **1.00** |
| `Valued images` badge | 3 | 0.67 |
| `Motorcycles on white background` category | 5 | **0.00** |
| SDC `P180` present at all | 15 | 0.67 |
| SDC `P4082` (camera) present | 70 | 0.61 |
| geo-coordinates present | 48 | 0.71 |

Three results worth stating plainly:

- **"Museum" is not a reject signal.** 15 of the 46 *passes* are museum shots (Petersen, Barber, Gaydon are where good sole-subject motorbike photos live). Museum words recall only 17/28 placards while flagging a third of the good ones. Rank on it; never gate.
- **Commons quality badges are anti-correlated.** 0/4 `Quality images` passed, 1/6 across all badges. QI/VI/FP reward photographic craft (riders in motion, scooters, BMW Welt architecture), not "one whole bike, no text, no faces". Sourcing from them would *lower* yield.
- **SDC `P180` is not exact identity here.** Absent on 110/125; of the 5 present, 2 match the source category's Wikidata item, 2 are the generic `Q34493 motorcycle`, 1 is unrelated. A confirmation signal on a small minority, not a category replacement.
- Uploader concentration is real but tiny: 7 uploaders have ≥3 files of 77 total (Mr.choppers 8/10 pass, Vauxford 2/8, Cjp24 2/7, Rikki Mitterer 0/3). Worth *displaying* on the review page as a running score; far too little data to rule on.

### The ceiling: what no metadata can see

**28 of 79 rejects carry no reject-shaped token in title, description, EXIF, or SDC.** After the hard gates run, 51 rejects survive, and 18 of them fail *only* on semantic identity or year judgement — 16 wrong-bike, 1 year, 1 geometry. That 18 (14 % of the 125) is the irreducible "needs eyes or a model" floor. The other 33 survivors are placard / multi-bike / faces / detail — classic-CV territory.

---

## 3. Classic CV: what it can actually replace

| need | tool | status here | verdict |
|---|---|---|---|
| legible year text | **tesseract 5.5.0** (`apt install tesseract-ocr`, not installed; or `tesseract.js` WASM, Apache-2.0, zero system dep) | absent | **replaces the LLM for 19 of 28 placards** |
| faces | **YuNet** ONNX (~230 KB) via `onnxruntime-node`, or OpenCV `python3-opencv` 4.10 (both in apt) | absent | **replaces the LLM for all 7 face rejects** |
| sole subject / multi-bike / detail-only | COCO detector — `motorcycle` + `person` classes | — | needs a small model; see below |

**(a) OCR.** A new `tools/check.ts` that, for each approved candidate, runs tesseract over the *post-`sourceCrop`* full-resolution image and over each rendered level, `--psm 11`, regex `\b(18|19|20)\d\d\b`. Any hit → block the schedule and print the bbox as a fraction so the operator can set `sourceCrop` or reject. Precision does not matter (the operator skims anyway); recall does. ~19/28 placards are printed Latin text readable at 960 px — inside tesseract's envelope. The residual 9 are handwritten cards, Japanese (`1986年`), Czech spec tables, mirrored plinth text, painted floor timelines; `-l eng+deu+jpn+ces` closes some of that, not all. **This is the single highest-value new tool: it turns §6.6's "eyeball l4 and l5" DoD line into a test.**

**(b) Faces.** Only 7 rejects, 4 already failing on multi-bike or placard, so ~3 net decisions. Still worth it: deterministic, ~15 ms/image CPU, and the one class with legal weight — `Restrictions: personality` only catches files the *uploader* flagged, and zero of the 7 were. YuNet from `opencv_zoo` is the smallest option; **verify its licence in the zoo README before shipping.**

**(c) Sole subject.** A COCO detector gives: `count(motorcycle) > 1` → multi-bike; `max motorcycle bbox area < ~35 %` → not sole subject; `count(motorcycle) == 0` → detail-only / not-a-bike; any `person` box → route to human. Covers 11 multi + 7 detail + 3 geometry + the 7 faces ≈ 28 of 79 rejects. Cost: ~5–20 MB model, 0.3–1.5 s per image CPU at 640 px. **Two caveats.** YOLOv5/v8 are **AGPL-3.0**; Apache-2.0 alternatives are YOLOX, NanoDet, RT-DETR. And whether a frozen 20 MB ONNX detector counts as "AI" is the operator's call — not an LLM, local, deterministic, never sees the label, but a neural net. If the answer is "no neural nets at all", drop this row and multi/detail/geometry stay with the human.

**What classic CV cannot do at all: wrong bike.** No OCR, detector, or heuristic tells you that a de-badged parallel twin in `Category:Honda CB350` is a Yamaha XS650 custom, that `Category:Indian Scout` mixes a 1924 side-valve with a 2015+ namesake, or that an NSU **Sportmax** works racer is not the catalogue's road **Max**. That is 26 of 125 (21 %) and it is exactly what the blind-ID + adjudication workflow was built for.

---

## 4. Changing the source instead of the filter

Live volumes (`prop=categoryinfo`):

| source | files | assessment |
|---|---:|---|
| `Category:Motorcycles on white background` | **299** | **Best find.** Background-removed studio cut-outs — no placard, no faces, no second bike, by construction. 43/50 sampled ≥ 2182 px. 5/5 of these in the labelled set passed. |
| `Category:Quality images of motorcycles` | 180 | Anti-correlated (0/4 passed). Scooters, riders in motion, BMW Welt interiors. |
| `Category:Valued images of motorcycles` | 22 | 1/3 passed; heterogeneous. |
| `Category:Featured pictures of motorcycles` | 10 | Too small to matter. |
| SDC `P180 = <model Q-id>` | 0–6 files/model (Super Cub is a 74-file outlier) | Too thin to be a source; `public/catalog.json` carries no Wikidata Q-id per model (resolvable via each category's `pageprops.wikibase_item`, 50 per call). |

Wikidata `P571` inception needs no extra call: `catalog.models[].years` already encodes the production window and is what gate 2 tests against.

`incategory:"<X>" filew:>2182` works in `list=search` and returns realistic counts (Sportster 134, Speed Triple 36, Super Cub 35). **Moving the width floor into the search query would have pre-empted 224 of the 1,041 auto-rejects** — a third of all wasted fetch work, for free.

Verdict on source change: **it removes the museum classes but not the wrong-bike class**, and it caps out (~500 curated files ≈ 1.4 years at 100 % yield; real yield lower — the white-background set is BMW/Audi-museum heavy and only 13/50 sampled titles carry a leading year). Use it as a **priority tier**, not a replacement: white-background first, then `incategory + filew`, then the plain category walk.

---

## 5. Recommended pipeline

**New gates in `tools/fetch.ts` (auto-`reject`):**

1. `mime != image/jpeg` → reject. Also `poster|Prospekt|Plakat|Modello in scala|scale model|die-cast|drawing` in title or description.
2. `yearProposed` outside `catalog.models[].years` widened by ±1 → reject. *(Catches the Indian Scout vintage/modern namesake class outright.)*
3. `yearProposed == year(extmetadata.DateTimeOriginal)` and the token is not title-leading → reject. **Already specified in PLAN §6.4 and implemented in `tools/lib/year.ts` (`discardYear`) — but it silently fails**: `dateTimeOriginalYear()` in `tools/fetch.ts` reads only a *leading* 4-digit token, while Commons returns free-text HTML (`"19 August 2024 (according to <span…>Exif</span> data)"`, `"July 1952<div…>"`). Both slipped through and both were rejected by review. Strip tags, then take any in-range 4-digit token.
4. A second catalog **make** name in the title → reject (`Kawasaki Z650 FOUR - Yamaha TX750`).
5. `sidecar|Gespann|Seitenwagen|side-car` in the **title** (not the description) → reject.
6. Production-span **prose** in the description — `Bauzeit`, `Produktionszeitraum`, `between YYYY and YYYY`, `introduced in`, `was made from`, `entre YYYY et YYYY` — and the year is not title-leading → reject. A bare `YYYY–YYYY` in a title is **not** this rule.
7. Detail token in the **filename**: `engine`, `(Motor)`, `dashboard`, `cockpit`, `Tableau de bord`, `Heck`, `detail`, `instrument`, `crankcase`, `close-up` → reject. Do **not** include `front`/`rear`/`left`/`right` — `…, front left` files are the best passes in the batch.
8. Event token in the filename: `Salon`, `Bonhams`, `concours`, `Wiki Loves`, `Olympia`, `Jahrestreffen`, `Festival`, `Parade`, `Pride` → reject.

**New ranking fields written into the review JSON (never gates):** museum-word hit (title/desc/category), trailing `(n)` marker, portrait flag, description-only year, catalog model name absent, uploader's running pass rate, `P180` present/matching.

**Fetch-query changes:** add `prop=categories&cllimit=max` to the existing `generator=categorymembers` call (rides the same request), keep `props=claims` on `wbgetentities`, and add `filew:>{MIN_SOURCE_WIDTH}` when walking via `list=search`.

**New `tools/check.ts`** (offline, between `prefetch` and `schedule`): tesseract OCR of the post-`sourceCrop` original and every rendered level → any `\b(18|19|20)\d\d\b` blocks the schedule with a bbox; YuNet face detection → any face blocks; optional COCO detector → motorcycle count, largest-bbox area fraction, person count, as advisory fields. `schedule.ts` refuses a candidate whose `check` block has an unresolved OCR year hit.

**Expected effect on the funnel** (denominator: the 322-candidate pool that survives today's gates):

| stage | today | proposed |
|---|---:|---:|
| files fetched to fill the pool | 1,041 | ~800 (`filew:` stops burning `gcmlimit` slots on files that can never ship) |
| pool after existing auto-gates | 322 | 322 |
| after the 8 new hard gates (flag rate 24 %) | — | **~245**, purity 0.37 → **0.46** |
| CV pre-flags, with reasons | — | ~33 of every 51 residual rejects |
| left indistinguishable without looking | 322 | **~155** (≈ 62 per 125: ~44 good, ~18 wrong-bike) |

**Residual classes that still need eyes:** wrong bike (26 of 125 — over a third of everything that would ship unreviewed), the 9 non-Latin/handwritten placards, and "is this year the *bike's* year". The ~18 wrong-bike files are not identifiable in advance — they hide among ~44 good ones, so whatever inspects them must inspect all ~62.

---

## 6. Cost per 30 shipped puzzles

| approach | spend | wall time |
|---|---|---|
| **Today** — 3 Opus verify runs, ~2.7 M tokens over 125 candidates | ≈ **$20** at a realistic input/output split | multi-hour agent run, plus the operator's skim |
| **No-LLM** — deterministic + tesseract + YuNet + detector, then human skim | **$0** in tokens; ~4 min CPU for 200 images | **~80 operator-minutes per 125**: ~2 min confirming the 30 hard-gate kills, ~20 min over the ~33 CV-flagged, ~60 min over the ~62 that nothing flags |
| **Hybrid (recommended)** — deterministic + CV, then **one** Opus vision pass over the ~62 unflagged | ≈ **$10** (half the candidates; composition/placard/faces already settled, so one stage replaces blind-ID + adjudication) | ~**20 operator-minutes** |

The LLM pass is not expensive in dollars; what it costs is a multi-hour agent run. The hybrid roughly halves it by dropping a review *stage*, not by guessing which candidates are contested — you cannot; that is the wrong-bike class.

## 7. Verdict

- **Drop AI entirely: not recommended.** 21 % of reviewed candidates are identity errors in the Commons metadata itself — over a third of everything that would ship unreviewed.
- **Drop it for the composition/placard/faces pass: yes, immediately.** Eight hard gates cost nothing, kill 28 of 79 rejects at 93 % precision, and OCR + face detection turn the two most-cited rejection reasons into a build-time test.
- **The right shape:** deterministic gates → `tools/check.ts` → a review page sorted by risk with every signal shown → **one** identity-only vision pass over ~half the pool → the operator's skim. Keeps the review desk, halves LLM spend and operator time together, and makes §6.6's placard rule enforceable by CI.
- **If the operator wants zero model calls**, that is viable: ~80 minutes per 125 candidates, wrong-bike detection entirely on them. The manual `npm run add` path (ROADMAP item 3) is the no-AI backup either way.
