export const meta = {
  name: 'motodle-content-verify',
  description: 'Verify fetched Commons motorbike candidates: blind vision identification, then evidence-based adjudication with crop guidance',
  phases: [
    { title: 'Blind ID', detail: 'identify make/model/era from the photo alone', model: 'opus' },
    { title: 'Adjudicate', detail: 'compare blind ID vs Commons claim, decide, propose focus/sourceCrop', model: 'opus' },
  ],
}

const REPO = '.' // agents run with the repository root as their working directory
const thumbsDir = args.thumbsDir
const poolPath = args.poolPath
const ids = args.ids
const BATCH = 8
const batches = []
for (let i = 0; i < ids.length; i += BATCH) batches.push(ids.slice(i, i + BATCH))
log(`${ids.length} candidates in ${batches.length} batches of ${BATCH}`)

const BLIND_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          candidateId: { type: 'string' },
          make: { type: 'string', description: 'Manufacturer as you identify it from the photo; "" if unidentifiable' },
          model: { type: 'string', description: 'Model / family / variant as specific as the photo supports; "" if unidentifiable' },
          modelId: { type: 'string', description: 'Exact `id` of the best-matching entry in public/catalog.json models, or "" if no catalog entry fits' },
          yearFrom: { type: 'string', description: 'Earliest model year consistent with what is visible (4 digits), "" if unknown' },
          yearTo: { type: 'string', description: 'Latest model year consistent with what is visible (4 digits), "" if unknown' },
          confidence: { type: 'string', description: 'high | medium | low' },
          yearTextVisible: { type: 'string', description: 'yes if ANY legible 4-digit year appears anywhere in the image (placard, sign, plate, banner, poster), else no' },
          people: { type: 'string', description: 'yes if any identifiable person (face) is visible, else no' },
          composition: { type: 'string', description: 'sole-subject | multiple-bikes | detail-only | partial | crowded ; plus a few words' },
          notes: { type: 'string', description: 'Visible badges/wordmarks/text and where they sit (left/right/top/bottom fractions), condition, anything odd. "" if nothing' },
        },
        required: ['candidateId', 'make', 'model', 'modelId', 'yearFrom', 'yearTo', 'confidence', 'yearTextVisible', 'people', 'composition', 'notes'],
      },
    },
  },
  required: ['results'],
}

const ADJ_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          candidateId: { type: 'string' },
          decision: { type: 'string', description: 'approve | reject' },
          year: { type: 'string', description: 'The single model year to publish as the answer (4 digits) when approving; "" when rejecting' },
          yearBasis: { type: 'string', description: 'Which evidence fixes the year and whether it is fetcher-proposed or an operator override; "" if rejecting' },
          focusX: { type: 'string', description: 'Focus point x as a fraction 0..1 of the (source-cropped) image, e.g. "0.42"; "" for default 0.5' },
          focusY: { type: 'string', description: 'Focus point y as a fraction 0..1; "" for default 0.5' },
          sourceCrop: { type: 'string', description: 'Optional "x,y,w,h" fractions of the ORIGINAL image to keep (all four in 0..1), e.g. "0.05,0.00,0.80,0.85"; "" for none' },
          reasons: { type: 'string', description: 'Why approve/reject, citing the blind ID, the Commons text and what you saw' },
          risks: { type: 'string', description: 'Residual doubts for the operator (variant naming, year ±1, badge visible early, quality). "" if none' },
        },
        required: ['candidateId', 'decision', 'year', 'reasons'],
      },
    },
  },
  required: ['results'],
}

const RAILS = `RAILS: you modify nothing — no edits anywhere in the repository, no git, no downloads of originals, no network except where this prompt explicitly allows. Return raw structured data only.`

const blindPrompt = (batch, idx) => `You are an expert motorcycle identifier doing a BLIND identification pass for a daily guessing game (players must name make, model and year from a zooming crop of the photo).
${RAILS}
You have NO context about these photos on purpose: identify each one from the pixels alone. Do NOT read any JSON, log or text file describing them; do not search the web for the photo. The ONLY files you may open are the image files listed below and ${REPO}/public/catalog.json (the game's make/model list, to map your identification to a catalog id).
Batch ${idx + 1}: for each candidate id, Read the image at ${thumbsDir}/<id>.jpg (a few may be .png — try .jpg first, then .png). Look carefully at tank shape, frame, engine cases, exhaust, wheels, bodywork, badges and decals.
Ids: ${batch.join(', ')}
For EACH image report, per the schema: make; model (as specific as the evidence allows — "CB750 Four K1" beats "CB750"); the catalog modelId that best matches (open catalog.json, find the entry under the same makeId; use its exact id; "" if the bike is not in the catalog or you cannot tell); yearFrom/yearTo = the model-year range of the generation/variant you see (be honest — a bare "1970s UJM" is yearFrom 1970 yearTo 1979); confidence high/medium/low in the make+model call; whether any legible 4-digit YEAR text appears anywhere (museum placards, show cards, number plates with a year, banners, posters, dated signage) — this matters more than anything else, be strict; whether an identifiable person (a face) is visible; composition (sole-subject / multiple-bikes / detail-only such as a dashboard or engine close-up / partial / crowded); notes on where badges and wordmarks sit in the frame (as rough fractions from the left/top) so a later step can avoid them in the tightest crop.
If two entries in the catalog could both fit (family vs variant, e.g. "Monster" vs "Monster 900"), pick the more specific one that the photo supports and mention the other in notes.`

const adjPrompt = (batch, idx, blind) => `You are the adjudicator for a daily motorbike guessing game's content pipeline. A candidate photo becomes a puzzle only if the answer (make, model, year) is RIGHT and the photo makes a fair, spoiler-free puzzle.
${RAILS}
Read ${poolPath} (a JSON array) and take the entries whose candidateId is in: ${batch.join(', ')}. Each entry carries the Commons CLAIM (claim.make/model/catalogYears — the category the file was found in, which is NOT a safe label), the file title, the Commons description text and capture date, the fetcher's year proposal + confidence + year tokens, licence, author, image dimensions and warnings.
A separate blind-identification agent looked at the same images with NO metadata. Its results for this batch:
${JSON.stringify(blind, null, 1)}
Also Read each image yourself at ${thumbsDir}/<candidateId>.jpg (or .png) — you must look, not just reason from text. You MAY WebFetch a candidate's descriptionUrl (Commons file page) at most once per candidate if the description in the pool is insufficient (e.g. to read categories or a longer description); load WebFetch via ToolSearch "select:WebFetch" if needed. No other network.
Decide per candidate:
1. IDENTITY: approve only if the blind ID and the claim agree on make and on the catalog modelId (or the blind ID names a more specific variant of the claimed family and the claimed modelId is the family entry — say so in risks). If the blind ID disagrees, is low confidence, or says detail-only / multiple-bikes / partial, REJECT unless you can see clearly that the claim is right and the composition is fine — explain what you saw.
2. YEAR: the published year must be supported by the Commons title/description (the fetcher's yearProposed and its tokens) AND fall inside the blind ID's generation range (allow ±1) AND inside claim.catalogYears (allow ±1; "unknown" catalog years impose nothing). A capture year that merely equals the photo date is not a model year. Event years in titles ("Greenwich 2026", "Bonhams 2019") are not model years. If the only supportable year differs from yearProposed, set year to the supported one (that becomes an operator override) and say why in yearBasis; if no single year is supportable, REJECT. Never guess a year from styling alone.
3. SPOILERS & FAIRNESS: reject if any legible 4-digit year is visible and cannot be removed with a sourceCrop that keeps the whole bike; reject if a face is identifiable; reject if the bike is not the clear sole subject, is tiny in frame, blurry, a dashboard/engine-only detail, a toy/model/drawing, a race-only special the catalog name does not cover, or heavily customized so the model is unrecognizable. Brand and model badging on the bodywork is FINE (players are meant to read it eventually).
4. CROP GUIDANCE for approvals. The game shows five zoom levels: level 1 is a 4:3 window 11% of the base width centred on the focus point, then ~19%, 32%, 55%, 95%; the full photo is shown at the end. focusX/focusY are fractions of the image AFTER sourceCrop. Put the focus on a distinctive mechanical region (engine cases, exhaust, rear shock/swingarm, forks/brake) that is NOT a wordmark or model badge and NOT plain background, so level 1 is a real clue but not the answer; describe it in reasons. Use sourceCrop (x,y,w,h fractions of the ORIGINAL) only to remove a placard/sign/year text, a second bike, or dead space; keep it generous (never cut the bike), keep w and h within 0..1 with x+w<=1 and y+h<=1, and remember the source-cropped 4:3 base width must stay >= 2182 px (usableWidth is in the pool entry; multiply by w).
5. risks: name anything the operator should glance at (variant naming, year ±1, wordmark near the focus, share-alike licence is fine, low contrast).
Be decisive and strict: a wrong answer published is far worse than a rejected photo. Return one result per candidate id.`

phase('Blind ID')
const results = await pipeline(
  batches,
  (batch, _item, idx) => agent(blindPrompt(batch, idx), { label: `blind:b${idx + 1}`, phase: 'Blind ID', model: 'opus', effort: 'high', schema: BLIND_SCHEMA }),
  (blind, batch, idx) => {
    if (!blind || !Array.isArray(blind.results)) { log(`blind:b${idx + 1} FAILED — adjudicating without blind data`) }
    const blindResults = (blind && blind.results) || []
    return agent(adjPrompt(batch, idx, blindResults.length ? blindResults : 'BLIND AGENT FAILED — no data; be extra strict'), { label: `adjudicate:b${idx + 1}`, phase: 'Adjudicate', model: 'opus', effort: 'high', schema: ADJ_SCHEMA })
      .then(adj => ({ batch, blind: blindResults, adj: (adj && adj.results) || [] }))
  },
)

const rows = []
let approved = 0, rejected = 0, missing = 0
results.forEach((r, idx) => {
  if (!r) { log(`batch ${idx + 1} produced nothing`); missing += batches[idx].length; return }
  for (const id of r.batch) {
    const b = r.blind.find(x => x.candidateId === id) || null
    const a = r.adj.find(x => x.candidateId === id) || null
    if (!a) missing++
    else if (a.decision === 'approve') approved++
    else rejected++
    rows.push({ candidateId: id, blind: b, adj: a })
  }
})
log(`done: ${approved} approve, ${rejected} reject, ${missing} missing`)
return { rows, approved, rejected, missing }