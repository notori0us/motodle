export const meta = {
  name: 'motodle-crop-check',
  description: 'Vision check of every scheduled puzzle\'s rendered crops for spoilers, faces, blank first clues and bad crops',
  phases: [{ title: 'Crop check', detail: 'view l1/l2/l4/full per puzzle', model: 'opus' }],
}
const REPO = '/home/chris/workspace/motodle'
const puzzles = args.puzzles
const BATCH = 6
const batches = []
for (let i = 0; i < puzzles.length; i += BATCH) batches.push(puzzles.slice(i, i + BATCH))
const SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          number: { type: 'string', description: 'puzzle number as a string' },
          verdict: { type: 'string', description: 'ok | fix | block' },
          issues: { type: 'string', description: 'What is wrong, per level, precisely; "" if ok' },
          suggestedFocus: { type: 'string', description: '"x,y" fractions of the source-cropped image for a better focus point, or ""' },
          suggestedSourceCrop: { type: 'string', description: '"x,y,w,h" fractions of the ORIGINAL to remove a spoiler/second bike, or ""' },
          notes: { type: 'string', description: 'Anything the operator should glance at; "" if none' },
        },
        required: ['number', 'verdict', 'issues'],
      },
    },
  },
  required: ['results'],
}
phase('Crop check')
const results = await parallel(batches.map((batch, idx) => () => agent(`You are the final quality gate for a daily motorbike guessing game. Players see five zoom levels of one photo (level 1 tightest, level 5 nearly the whole photo), then the full photo with the answer. Brand/model badging on the bike is FINE and expected. What is NOT fine: any legible 4-digit year or a registration/plate that reveals a year, a museum/show placard naming the bike, an identifiable human face, a first clue (level 1) that is blank paint/background/blur with nothing mechanical to read, a crop that cut off most of the bike, a second bike that dominates the frame, or an image that does not match the answer.
RAILS: read-only. Do not modify any file, no git, no network.
For each puzzle below: Read ${REPO}/public/puzzles/<date>.json (fields answer.make/model/year, credit.fileTitle) and then Read these images in ${REPO}/public/puzzles/img/<NNNN>/ : l1.webp, l2.webp, l4.webp, full.webp (NNNN = the 4-digit zero-padded number). Look carefully; zoom mentally on any text.
Puzzles (number, date): ${batch.map(p => `${p.number} ${p.date}`).join('; ')}
Report per puzzle: verdict ok (ship as is), fix (ship after moving the focus or adding a sourceCrop — give the exact suggestion; focus fractions are of the source-cropped image, so if the puzzle JSON has a sourceCrop already, express the new focus within that crop), or block (do not ship: spoiler year/plate, face, wrong bike, unrecoverable composition). Be precise about which level shows the problem. Do not flag brand or model badging as a problem.`, { label: `check:b${idx + 1}`, phase: 'Crop check', model: 'opus', effort: 'high', schema: SCHEMA })))
const rows = []
results.forEach((r, i) => { if (!r) { log(`batch ${i + 1} FAILED`); return } rows.push(...r.results) })
const counts = { ok: 0, fix: 0, block: 0 }
for (const r of rows) counts[r.verdict] = (counts[r.verdict] || 0) + 1
log(`crop check: ${JSON.stringify(counts)} of ${puzzles.length}`)
return { rows, counts }