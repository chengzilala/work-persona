// 生成纸面盲测材料：form.html（可打印答题卷）与 answer-key.csv（主持人计分钥匙）
// 用法：node test/blind-test/build-form.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.resolve(__dirname, '../../web/assets/js');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(WEB, 'questions.js'), 'utf8'), sandbox);
const questions = sandbox.window.WP_QUESTIONS || [];

const STAGES = [
  { key: 'natural', label: '自然状态', hint: '每题勾 1 个「最像」和 1 个「最不像」', dual: true },
  { key: 'work', label: '工作状态', hint: '每题只勾 1 个「最像」', dual: false },
  { key: 'stress', label: '压力状态', hint: '每题只勾 1 个「最像」', dual: false }
];

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[ch]));

const byStage = (key) => questions.filter((item) => item.stage === key);
const letters = ['A', 'B', 'C', 'D'];

function gridDual(list) {
  const head = list.length
    ? `<tr><th class="no">题</th>${letters.map((l) => `<th>${l} 最像</th><th>${l} 最不像</th>`).join('')}</tr>`
    : '';
  const rows = list.map((q, index) => `
    <tr>
      <td class="no">${index + 1}</td>
      ${letters.map(() => '<td class="mark"></td><td class="mark"></td>').join('')}
    </tr>`).join('');
  return `<table class="grid-table"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
}

function gridSingle(list) {
  const rows = list.map((q, index) => `
    <tr>
      <td class="no">${index + 1}</td>
      ${letters.map(() => '<td class="mark"></td>').join('')}
    </tr>`).join('');
  return `<table class="grid-table"><thead><tr><th class="no">题</th>${letters.map((l) => `<th>${l}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
}

function questionList(list) {
  return list.map((q, index) => `
    <li class="q">
      <p class="q-text"><span class="q-no">${index + 1}.</span>${escapeHtml(q.text)}</p>
      <p class="q-opts">${q.options.map((opt, i) => `<span><b>${letters[i]}.</b> ${escapeHtml(opt.text)}</span>`).join('')}</p>
    </li>`).join('');
}

const natural = byStage('natural');
const work = byStage('work');
const stress = byStage('stress');
const TOTAL = questions.length;

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>三面 · 纸面盲测（${TOTAL} 题）</title>
<style>
  @page { size: A4; margin: 13mm 12mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 18px 16px 40px;
    color: #1f2329;
    background: #fff;
    font: 12px/1.55 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
    max-width: 760px;
    margin: 0 auto;
  }
  h1 { margin: 2px 0 6px; font-size: 20px; }
  h2 { margin: 18px 0 8px; font-size: 14px; }
  h3 { margin: 12px 0 6px; font-size: 13px; }
  .eyebrow { margin: 0; color: #2f6fed; font-size: 11px; letter-spacing: .04em; }
  .meta { display: flex; gap: 18px; flex-wrap: wrap; margin: 8px 0 12px; font-size: 12px; }
  .meta span { min-width: 150px; border-bottom: 1px solid #9aa1ad; padding-bottom: 2px; }
  .notice { border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px 14px; background: #fafbfd; }
  .notice ul { margin: 6px 0 0; padding-left: 18px; }
  .notice li { margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; }
  .grid-table th, .grid-table td { border: 1px solid #d9dde5; text-align: center; height: 20px; }
  .grid-table th { background: #f2f5fa; font-weight: 600; font-size: 10px; padding: 3px 2px; }
  .grid-table td.no { width: 34px; color: #6b7280; }
  .grid-table td.mark { width: 34px; }
  .side { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; page-break-inside: avoid; }
  .page-break { page-break-before: always; }
  .q { margin: 0 0 8px; page-break-inside: avoid; }
  .q-text { margin: 0; font-weight: 600; }
  .q-no { margin-right: 4px; color: #2f6fed; }
  .q-opts { margin: 2px 0 0; color: #3d4450; display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
  .q-opts span { display: block; }
  .review { border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px 14px; margin-top: 14px; page-break-inside: avoid; }
  .line { border-bottom: 1px solid #9aa1ad; display: inline-block; min-width: 70%; vertical-align: bottom; }
  .print-btn {
    position: fixed; right: 18px; bottom: 18px; padding: 10px 16px;
    border: 0; border-radius: 999px; background: #2f6fed; color: #fff;
    font-size: 13px; cursor: pointer; box-shadow: 0 6px 16px rgba(47, 111, 237, .3);
  }
  @media print {
    body { padding: 0; max-width: none; }
    .print-btn { display: none; }
  }
</style>
</head>
<body>
  <p class="eyebrow">三面 · 职业行为风格测评 · 纸面盲测</p>
  <h1>职业行为风格问卷（${TOTAL} 题）</h1>
  <div class="meta">
    <span>编号：01</span>
    <span>日期：&nbsp;&nbsp;&nbsp;年&nbsp;&nbsp;月&nbsp;&nbsp;日</span>
    <span>用时：&nbsp;&nbsp;分钟</span>
  </div>

  <section class="notice">
    <h2 style="margin-top:0">怎么填</h2>
    <ul>
      <li>没有对错，按第一反应选，不要反复权衡。</li>
      <li>先把答案勾在「答案格」里（每题一格），题目在后面几页。</li>
      <li>自然状态：每题勾 1 个「最像」+ 1 个「最不像」；工作 / 压力状态：每题只勾 1 个「最像」。</li>
      <li>请在安静环境独立完成，不要和别人讨论；约 10 分钟。</li>
      <li>本次匿名，只用于打磨题目，不用于考核，也不会公开。</li>
    </ul>
  </section>

  <section>
    <h2>答案格</h2>
    <h3>${STAGES[0].label}（${natural.length} 题）· ${STAGES[0].hint}</h3>
    ${gridDual(natural)}
    <div class="side">
      <div>
        <h3>${STAGES[1].label}（${work.length} 题）· ${STAGES[1].hint}</h3>
        ${gridSingle(work)}
      </div>
      <div>
        <h3>${STAGES[2].label}（${stress.length} 题）· ${STAGES[2].hint}</h3>
        ${gridSingle(stress)}
      </div>
    </div>
  </section>

  <div class="page-break"></div>

  <section>
    <h2>题目</h2>
    <h3>${STAGES[0].label}（${natural.length} 题）</h3>
    <ol class="q-list" style="list-style:none;margin:0;padding:0">
      ${questionList(natural)}
    </ol>

    <h3>${STAGES[1].label}（${work.length} 题）</h3>
    <ol class="q-list" style="list-style:none;margin:0;padding:0">
      ${questionList(work)}
    </ol>

    <h3>${STAGES[2].label}（${stress.length} 题）</h3>
    <ol class="q-list" style="list-style:none;margin:0;padding:0">
      ${questionList(stress)}
    </ol>
  </section>

  <div class="page-break"></div>

  <section class="review">
    <h2 style="margin-top:0">做完之后（等主持人给完结果再填）</h2>
    <p>1. 这份结果像你吗？&nbsp;&nbsp;□ 1 &nbsp;□ 2 &nbsp;□ 3 &nbsp;□ 4 &nbsp;□ 5 &nbsp;&nbsp;（5 = 非常像）</p>
    <p>2. 哪一句最像你：<span class="line"></span></p>
    <p>3. 哪一句最不像你：<span class="line"></span></p>
    <p style="color:#6b7280;margin-bottom:0">结果只作自我认知参考，不构成心理诊断或医疗建议。</p>
  </section>

  <button class="print-btn" type="button" onclick="window.print()">打印 / 存为 PDF</button>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'form.html'), html, 'utf8');

const keyRows = [['题号', '阶段', '选项A', '选项B', '选项C', '选项D']];
['natural', 'work', 'stress'].forEach((stage) => {
  byStage(stage).forEach((q, index) => {
    keyRows.push([index + 1, stage].concat(q.options.map((opt) => opt.dim)));
  });
});
fs.writeFileSync(
  path.join(__dirname, 'answer-key.csv'),
  '\ufeff' + keyRows.map((row) => row.join(',')).join('\n') + '\n',
  'utf8'
);

console.log(`已生成 form.html 与 answer-key.csv：自然 ${natural.length} / 工作 ${work.length} / 压力 ${stress.length} 题`);
