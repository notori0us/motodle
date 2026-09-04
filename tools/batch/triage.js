// Triage the fetched review file into a verification pool. Usage: node triage.js <review.json> <out pool.json> [cap]
const fs = require('fs');
const [,, reviewPath, outPath, capArg] = process.argv;
const CAP = Number(capArg || 90);
const MIN = 2182;
const r = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
const cat = JSON.parse(fs.readFileSync(require('path').join(__dirname, '../../public/catalog.json'), 'utf8'));
const models = Object.fromEntries(cat.models.map(m => [m.id, m]));
const makes = Object.fromEntries(cat.makes.map(m => [m.id, m]));
const usable = c => Math.min(c.width, Math.round(c.height * 4 / 3));
const c = r.candidates;
const stat = (k, f) => { const o = {}; for (const x of c) { const v = f(x); o[v] = (o[v] || 0) + 1 } console.log(k, JSON.stringify(o)) };
console.log('candidates', c.length);
stat('decision', x => x.decision); stat('yearConfidence', x => x.yearConfidence); stat('license', x => x.license.id);
stat('usable>=MIN', x => usable(x) >= MIN); stat('author present', x => !!x.author && x.author !== 'Unknown');
const warn = {}; for (const x of c) for (const w of x.warnings) warn[w] = (warn[w] || 0) + 1; console.log('warnings', JSON.stringify(warn));
const eligible = c.filter(x => x.decision === 'pending' && usable(x) >= MIN && ['high', 'medium'].includes(x.yearConfidence)
  && !x.restrictions.includes('personality') && x.author && x.author !== 'Unknown');
console.log('eligible', eligible.length, 'models', new Set(eligible.map(x => x.modelId)).size, 'makes', new Set(eligible.map(x => x.makeId)).size);
// rank within model: high conf first, then wider
eligible.sort((a, b) => (b.yearConfidence === 'high') - (a.yearConfidence === 'high') || usable(b) - usable(a));
// round-robin: 1 per model per pass, then makes balanced by taking models round-robin per make
const byMake = {};
for (const x of eligible) { (byMake[x.makeId] ||= {}); (byMake[x.makeId][x.modelId] ||= []).push(x) }
const pool = []; const perModel = {};
let progress = true;
while (pool.length < CAP && progress) {
  progress = false;
  for (const makeId of Object.keys(byMake)) {
    const modelsOf = byMake[makeId];
    // pick the model with the fewest picks so far that still has candidates
    const mids = Object.keys(modelsOf).filter(m => modelsOf[m].length > 0).sort((a, b) => (perModel[a] || 0) - (perModel[b] || 0));
    if (!mids.length) continue;
    const mid = mids[0];
    if ((perModel[mid] || 0) >= 2) continue; // at most 2 candidates per model in the pool
    const x = modelsOf[mid].shift(); perModel[mid] = (perModel[mid] || 0) + 1; pool.push(x); progress = true;
    if (pool.length >= CAP) break;
  }
}
const yrs = m => { const y = models[m]?.years; return y ? `${y[0]}–${y[1] ?? 'present'}` : 'unknown' };
const out = pool.map(x => ({
  candidateId: x.candidateId, thumb: `${x.candidateId}.${(/\.(jpe?g|png|webp|gif)(\?|$)/i.exec(x.thumbUrl)?.[1] || 'jpg').toLowerCase().replace('jpeg', 'jpg')}`,
  claim: { makeId: x.makeId, make: makes[x.makeId].name, country: makes[x.makeId].country, modelId: x.modelId, model: models[x.modelId].name, catalogYears: yrs(x.modelId) },
  fileTitle: x.fileTitle, descriptionUrl: x.descriptionUrl, sourceCategory: x.sourceCategory,
  width: x.width, height: x.height, usableWidth: usable(x), license: x.license.id, author: x.author, creditNote: x.creditNote,
  yearProposed: x.yearProposed, yearConfidence: x.yearConfidence,
  yearCandidates: x.yearCandidates.map(y => `${y.year}(${y.source}/${y.pattern}/${y.confidence})`).join(' '),
  warnings: x.warnings,
}));
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
const mk = {}; for (const x of out) mk[x.claim.make] = (mk[x.claim.make] || 0) + 1;
console.log('pool', out.length, JSON.stringify(mk));
const dec = {}; for (const x of out) { const d = x.yearProposed ? Math.floor(x.yearProposed / 10) * 10 : 'none'; dec[d] = (dec[d] || 0) + 1 } console.log('by decade', JSON.stringify(dec));
