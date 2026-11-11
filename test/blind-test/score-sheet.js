// 纸面盲测计分器：node test/blind-test/score-sheet.js <编号> "<带阶段标签的答案>"
// 用法（按卷面段内编号报即可）：
//   node test/blind-test/score-sheet.js 01 "自然：1 A/D 2 C/A … 工作：1 A 2 B … 压力：1 A 2 C …"
// 也兼容全局编号（工作 25~36、压力 37~45）。
// 计分口径与 web/assets/js/score.js 一致：自然段「最像 +2 / 最不像 −1」，工作与压力段只「最像 +2」。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '../..');
const raw = fs.readFileSync(path.join(__dirname, 'answer-key.csv'), 'utf8').replace(/^\uFEFF/, '');
const key = { natural: {}, work: {}, stress: {} };
for (const line of raw.split(/\r?\n/).slice(1)) {
  if (!line.trim()) continue;
  const c = line.split(',');
  key[c[1].trim()][c[0].trim()] = { A: c[2].trim(), B: c[3].trim(), C: c[4].trim(), D: c[5].trim() };
}

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'web/assets/js/content.js'), 'utf8'), sandbox);
const TYPES = sandbox.window.WP_CONTENT.TYPE_NAMES;

const no = process.argv[2];
const text = process.argv.slice(3).join(' ');
if (!no || !text) {
  console.log('用法：node test/blind-test/score-sheet.js 01 "自然：1 A/D 2 C/A … 工作：1 A … 压力：1 A …"');
  process.exit(1);
}

const SIZE = { natural: 24, work: 12, stress: 9 };
const OFFSET = { natural: 0, work: 24, stress: 36 };
const ZH = { 自然: 'natural', 工作: 'work', 压力: 'stress' };

const picks = { natural: {}, work: {}, stress: {} };
const blocks = text.split(/(自然|工作|压力)\s*[:：]/);
for (let i = 1; i < blocks.length; i += 2) {
  const stage = ZH[blocks[i]];
  const body = blocks[i + 1] || '';
  const re = /(\d{1,2})\s*([A-Da-d])\s*(?:\/\s*([A-Da-d]))?/g;
  let m;
  while ((m = re.exec(body))) {
    let q = Number(m[1]);
    if (q > SIZE[stage]) q -= OFFSET[stage];
    picks[stage][q] = { like: m[2].toUpperCase(), unlike: m[3] ? m[3].toUpperCase() : null };
  }
}

const dims = ['D', 'I', 'S', 'C'];
const score = { natural: { D: 0, I: 0, S: 0, C: 0 }, work: { D: 0, I: 0, S: 0, C: 0 }, stress: { D: 0, I: 0, S: 0, C: 0 } };
const missing = [];
for (const stage of ['natural', 'work', 'stress']) {
  for (let q = 1; q <= SIZE[stage]; q += 1) {
    const info = key[stage][q];
    const a = picks[stage][q];
    if (!a || !info) { missing.push(`${stage}${q}`); continue; }
    if (info[a.like]) score[stage][info[a.like]] += 2;
    if (stage === 'natural' && a.unlike) {
      const un = info[a.unlike];
      if (un && un !== info[a.like]) score[stage][un] -= 1;
    }
  }
}

const norm = (stage, v) => Math.round({
  natural: (x) => (x + 24) / 72 * 100,
  work: (x) => x / 24 * 100,
  stress: (x) => x / 18 * 100
}[stage](v));

const result = {};
for (const stage of ['natural', 'work', 'stress']) {
  const rows = dims.map((d) => ({ d, n: norm(stage, score[stage][d]) })).sort((a, b) => b.n - a.n);
  result[stage] = { main: rows[0].d, second: rows[1].d, scores: rows.map((r) => `${r.d}${r.n}`).join(' ') };
}
const code = result.natural.main + result.natural.second;
const type = TYPES[code] || { name: '?', line: '' };

console.log(`编号 ${no}${missing.length ? `  ⚠ 缺 ${missing.length} 题：${missing.join(',')}` : ''}`);
for (const stage of ['natural', 'work', 'stress']) {
  const r = result[stage];
  const label = { natural: '自然', work: '工作', stress: '压力' }[stage];
  console.log(`  ${label}  ${r.scores}  → 主 ${r.main} / 次 ${r.second}`);
}
console.log(`  整体 ${code} ${type.name}（${type.line}）`);
console.log(`CSV  ${no},,,"${result.natural.main}","${result.natural.second}","${result.work.main}","${result.work.second}","${result.stress.main}","${result.stress.second}",${code},,,,`);
