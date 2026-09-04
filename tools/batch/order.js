// Reorder approved candidates in the review file for variety; drop duplicate models (keep the best); optional holds.
// Usage: node order.js <review.json> <pool.json> <pool2.json> [heldIds,comma]
const fs = require('fs');
const [,, reviewPath, poolA, poolB, heldArg] = process.argv;
const held = new Set((heldArg || '').split(',').filter(Boolean));
const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
const pool = Object.fromEntries([...JSON.parse(fs.readFileSync(poolA)), ...JSON.parse(fs.readFileSync(poolB))].map(p => [p.candidateId, p]));
const approved = review.candidates.filter(c => c.decision === 'approve');
// hold = demote to pending with a note (operator decides later)
for (const c of approved) if (held.has(c.candidateId)) { c.decision = 'pending'; c.operator.note = `HELD for operator: ${c.operator.note || ''}`.slice(0, 500); }
const live = approved.filter(c => !held.has(c.candidateId));
// dedupe by model: prefer no sourceCrop needed, then wider usable width
const usable = c => Math.min(c.width, Math.round(c.height * 4 / 3));
const byModel = {};
for (const c of live) (byModel[c.modelId] ||= []).push(c);
const keep = []; const dropped = [];
for (const [m, arr] of Object.entries(byModel)) {
  arr.sort((a, b) => (a.operator.sourceCrop ? 1 : 0) - (b.operator.sourceCrop ? 1 : 0) || usable(b) - usable(a));
  keep.push(arr[0]); for (const d of arr.slice(1)) { d.decision = 'pending'; d.operator.note = `DUPLICATE model (kept ${arr[0].candidateId}): ${d.operator.note || ''}`.slice(0, 500); dropped.push(d.candidateId); }
}
// order: round-robin over era buckets and makes so consecutive days differ in make and era
const era = c => { const y = c.operator.year ?? c.yearProposed; return y < 1960 ? 'vintage' : y < 1980 ? 'classic' : y < 2000 ? 'modern' : 'current'; };
const buckets = {}; for (const c of keep) (buckets[era(c)] ||= []).push(c);
for (const b of Object.values(buckets)) b.sort((a, c) => a.makeId.localeCompare(c.makeId));
const order = []; let lastMake = null;
const eras = ['current', 'classic', 'modern', 'vintage'];
while (order.length < keep.length) {
  let placed = false;
  for (const e of eras) {
    const b = buckets[e]; if (!b || !b.length) continue;
    let i = b.findIndex(c => c.makeId !== lastMake); if (i < 0) i = 0;
    const c = b.splice(i, 1)[0]; order.push(c); lastMake = c.makeId; placed = true;
  }
  if (!placed) break;
}
const ids = new Set(order.map(c => c.candidateId));
review.candidates = [...order, ...review.candidates.filter(c => !ids.has(c.candidateId))];
fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2) + '\n');
console.log('scheduled order', order.length, 'dropped dups', dropped.length, 'held', held.size);
order.forEach((c, i) => { const p = pool[c.candidateId]; console.log(String(i + 1).padStart(2), c.candidateId, `${p.claim.make} ${p.claim.model}`, c.operator.year ?? c.yearProposed, era(c)); });
