// Build the operator review page: one row per scheduled puzzle with l1 / l4 / full previews, the answer, and both verifier verdicts.
// Usage: node mkreview.js <out.html> <review.json> <pool.json,pool2.json> <verdicts-A.json,verdicts-B.json,...> <fromDate>
const fs = require('fs'); const path = require('path'); const sharp = require('sharp');
const [,, outPath, reviewPath, poolsArg, verdictsArg, fromDate] = process.argv;
const review = JSON.parse(fs.readFileSync(reviewPath));
const cands = Object.fromEntries(review.candidates.map(c => [c.candidateId, c]));
const pool = Object.fromEntries(poolsArg.split(',').flatMap(f => JSON.parse(fs.readFileSync(f))).map(p => [p.candidateId, p]));
const verdicts = Object.fromEntries(verdictsArg.split(',').flatMap(f => JSON.parse(fs.readFileSync(f))).map(r => [r.candidateId, r]));
const PUZ = 'public/puzzles';
const puzzles = fs.readdirSync(PUZ).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map(f => JSON.parse(fs.readFileSync(path.join(PUZ, f)))).filter(p => p.date >= fromDate).sort((a, b) => a.number - b.number);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
(async () => {
  const rows = [];
  for (const p of puzzles) {
    const dir = path.join(PUZ, 'img', String(p.number).padStart(4, '0'));
    const uri = async (file, width) => { let img = sharp(path.join(dir, file)); if (width) img = img.resize({ width, withoutEnlargement: true }); const buf = await img.webp({ quality: 70 }).toBuffer(); return `data:image/webp;base64,${buf.toString('base64')}`; };
    const l1 = await uri('l1.webp', 240), l4 = await uri('l4.webp', 420), full = await uri('full.webp', 720);
    const cid = Object.values(cands).find(c => c.fileTitle === p.credit.fileTitle)?.candidateId;
    const v = verdicts[cid] || {}; const pc = pool[cid] || {}; const c = cands[cid] || {};
    const b = v.blind || {}, a = v.adj || {};
    rows.push(`<article class="row" id="p${p.number}">
  <header><span class="num">#${p.number}</span><time>${p.date}</time><h2>${esc(p.answer.year)} ${esc(p.answer.make)} ${esc(p.answer.model)}</h2><span class="lic">${esc(p.credit.license.id)}</span></header>
  <div class="imgs"><figure><img src="${l1}" alt="level 1 crop"><figcaption>Level 1 (first clue)</figcaption></figure><figure><img src="${l4}" alt="level 4 crop"><figcaption>Level 4</figcaption></figure><figure class="wide"><img src="${full}" alt="full reveal"><figcaption>Full reveal · <a href="${esc(p.credit.descriptionUrl)}" target="_blank" rel="noopener">Commons page</a> · ${esc(p.credit.author)}</figcaption></figure></div>
  <dl>
    <dt>Commons says</dt><dd>${esc(pc.fileTitle)} — “${esc((pc.commons || {}).description || '')}”</dd>
    <dt>Blind ID (photo only)</dt><dd><b>${esc(b.make)} ${esc(b.model)}</b>, ${esc(b.yearFrom)}–${esc(b.yearTo)}, ${esc(b.confidence)} confidence · year text ${esc(b.yearTextVisible)} · people ${esc(b.people)} · ${esc(b.composition)}</dd>
    <dt>Year basis</dt><dd>${esc(a.yearBasis)}${c.operator && c.operator.year !== null && c.operator.year !== undefined ? ' <span class="pill warn">operator override</span>' : ''}</dd>
    <dt>Adjudicator</dt><dd>${esc(a.reasons)}</dd>
    ${a.risks ? `<dt>Watch</dt><dd class="risk">${esc(a.risks)}</dd>` : ''}
    ${c.operator && c.operator.sourceCrop ? `<dt>Source crop</dt><dd>${esc(JSON.stringify(c.operator.sourceCrop))}</dd>` : ''}
  </dl>
</article>`);
  }
  const html = `<title>Motodle Puzzle Review</title>
<style>
:root{--ink:#18181b;--paper:#fff;--surface:#f4f4f5;--muted:#6b6b70;--border:#d9d9de;--accent:#2563eb;--warn:#946c0a;--good:#3b7d22;--bad:#b32222}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--ink:#f2f2f4;--paper:#121214;--surface:#1c1c1f;--muted:#a3a3a9;--border:#3a3a40;--accent:#6d9bff;--warn:#d9a441;--good:#7bc46a;--bad:#ff8a8a}}
:root[data-theme="dark"]{--ink:#f2f2f4;--paper:#121214;--surface:#1c1c1f;--muted:#a3a3a9;--border:#3a3a40;--accent:#6d9bff;--warn:#d9a441;--good:#7bc46a;--bad:#ff8a8a}
body{background:var(--paper);color:var(--ink);font:15px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;margin:0;padding:24px;font-variant-numeric:tabular-nums}
h1{font-size:1.5rem;margin:0 0 4px;text-wrap:balance}.lead{color:var(--muted);max-width:70ch;margin:0 0 20px}
.toc{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 24px}.toc a{font-size:.8rem;padding:3px 8px;border:1px solid var(--border);border-radius:999px;color:var(--ink);text-decoration:none;background:var(--surface)}
.row{border-top:1px solid var(--border);padding:20px 0;display:grid;gap:12px}
header{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}.num{font-weight:700;color:var(--muted)}time{color:var(--muted);font-size:.85rem}h2{font-size:1.15rem;margin:0}
.lic{font-size:.7rem;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);border:1px solid var(--border);padding:1px 6px;border-radius:4px}
.imgs{display:grid;grid-template-columns:240px 420px minmax(320px,720px);gap:12px;align-items:start;overflow-x:auto}
@media (max-width:1100px){.imgs{grid-template-columns:1fr 1fr}.imgs .wide{grid-column:1/-1}}
figure{margin:0;background:var(--surface);border-radius:6px;padding:6px}figure img{display:block;width:100%;height:auto;border-radius:4px}figcaption{font-size:.75rem;color:var(--muted);padding:6px 2px 0}
dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 14px;margin:0;max-width:120ch}dt{font-size:.72rem;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);padding-top:2px}dd{margin:0}
.risk{color:var(--warn)}.pill{font-size:.7rem;padding:1px 6px;border-radius:999px;border:1px solid currentColor}.pill.warn{color:var(--warn)}
a{color:var(--accent)}
</style>
<h1>Motodle puzzle review — ${esc(fromDate)} onward</h1>
<p class="lead">${rows.length} scheduled puzzles. Each was identified blind from the photo by one reviewer, then adjudicated against the Commons title, description and catalog by a second. Check three things per row: the answer matches the full reveal, level 1 is a fair first clue, and no level shows a legible year.</p>
<nav class="toc">${puzzles.map(p => `<a href="#p${p.number}">#${p.number} ${esc(p.answer.make)} ${esc(p.answer.model)}</a>`).join('')}</nav>
${rows.join('\n')}`;
  fs.writeFileSync(outPath, html); console.log('wrote', outPath, (fs.statSync(outPath).size / 1e6).toFixed(1), 'MB', rows.length, 'rows');
})();
