// Apply workflow verdicts to the review file. Usage: node apply-verdicts.js <review.json> <verdicts.json> <pool.json>
// verdicts.json = the workflow's `rows` array: [{candidateId, blind, adj}]
const fs = require('fs');
const [,, reviewPath, verdictsPath, poolPath] = process.argv;
const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
const rows = JSON.parse(fs.readFileSync(verdictsPath, 'utf8'));
const pool = Object.fromEntries(JSON.parse(fs.readFileSync(poolPath, 'utf8')).map(p => [p.candidateId, p]));
const byId = Object.fromEntries(review.candidates.map(c => [c.candidateId, c]));
const num = s => { const n = Number(String(s ?? '').trim()); return Number.isFinite(n) && String(s).trim() !== '' ? n : null };
const approved = []; const rejected = []; const held = [];
for (const r of rows) {
  const c = byId[r.candidateId]; if (!c) { console.log('not in review file', r.candidateId); continue }
  const a = r.adj; const b = r.blind; const p = pool[r.candidateId];
  if (!a) { held.push({ id: r.candidateId, why: 'no adjudication' }); continue }
  if (a.decision !== 'approve') { c.decision = 'reject'; c.operator.note = `rejected by review 2026-09-03: ${a.reasons}`.slice(0, 500); rejected.push(r.candidateId); continue }
  // guard: blind ID must agree on make; model disagreement is held for the operator unless adjudicator explicitly accepted a variant
  const blindMakeOk = b && b.make && b.make.toLowerCase().replace(/[^a-z]/g, '').includes(p.claim.make.toLowerCase().replace(/[^a-z]/g, '').slice(0, 4));
  const blindModelOk = b && b.modelId === p.claim.modelId;
  const year = num(a.year);
  if (!year) { held.push({ id: r.candidateId, why: 'approve without year' }); continue }
  if (!blindMakeOk) { held.push({ id: r.candidateId, why: `blind make "${b && b.make}" != claim ${p.claim.make}` }); continue }
  const fx = num(a.focusX), fy = num(a.focusY);
  const sc = (a.sourceCrop || '').split(',').map(s => num(s));
  c.decision = 'approve';
  c.operator.year = year === c.yearProposed ? null : year;
  c.operator.focus = (fx !== null && fy !== null) ? { x: Math.min(0.98, Math.max(0.02, fx)), y: Math.min(0.98, Math.max(0.02, fy)) } : null;
  c.operator.sourceCrop = (sc.length === 4 && sc.every(v => v !== null)) ? { x: sc[0], y: sc[1], w: sc[2], h: sc[3] } : null;
  c.operator.note = `${a.yearBasis || ''} | blind: ${b ? `${b.make} ${b.model} ${b.yearFrom}-${b.yearTo} (${b.confidence})` : 'n/a'} | ${a.risks || ''}`.slice(0, 500);
  approved.push({ id: r.candidateId, make: p.claim.make, model: p.claim.model, year, modelAgree: blindModelOk, risks: a.risks || '' });
}
fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2) + '\n');
console.log('approved', approved.length, 'rejected', rejected.length, 'held', held.length);
for (const h of held) console.log('HELD', h.id, h.why);
for (const a of approved) console.log('APPROVE', a.id, a.make, a.model, a.year, a.modelAgree ? '' : '(blind modelId differs)', a.risks ? `risk: ${a.risks.slice(0, 120)}` : '');
