// 16 型人格计分：纯函数，不依赖 DOM，可在浏览器与 Node 中单独校验。
// 题目与两端描述见 oejts-questions.js；口径按 OEJTS 1.2 官方计分说明：
//   每维 8 题、作答 1~5，得分 = base + Σ(sign × 作答)，取值区间固定为 8~40，
//   > 24 取右端字母（E / N / T / P），否则取左端字母（I / S / F / J），等于 24 归左端。
(function (global) {
  'use strict';

  var DIMS = [
    { key: 'EI', base: 30, left: 'I', right: 'E', name: '精力方向', leftName: '内向', rightName: '外向' },
    { key: 'SN', base: 12, left: 'S', right: 'N', name: '接收信息', leftName: '实感', rightName: '直觉' },
    { key: 'TF', base: 30, left: 'F', right: 'T', name: '做决定', leftName: '情感', rightName: '思考' },
    { key: 'JP', base: 18, left: 'J', right: 'P', name: '生活节奏', leftName: '判断', rightName: '知觉' }
  ];

  var MID = 24;
  var LOW = 8;
  var SPAN = 32;
  var VALID = [1, 2, 3, 4, 5];

  function percentOf(score) {
    var value = (score - LOW) / SPAN * 100;
    return Math.round(Math.max(0, Math.min(100, value)));
  }

  // answers: { 题号: 1~5 }
  function computeDim(dim, questions, answers) {
    var total = 0;
    var answered = 0;
    var sum = 0;

    questions.forEach(function (q) {
      if (q.dim !== dim.key) return;
      total += 1;
      var value = Number(answers[q.id]);
      if (VALID.indexOf(value) === -1) return;
      sum += q.sign * value;
      answered += 1;
    });

    var complete = total > 0 && answered === total;
    var score = complete ? dim.base + sum : null;
    var right = complete && score > MID;

    return {
      key: dim.key,
      name: dim.name,
      leftName: dim.leftName,
      rightName: dim.rightName,
      score: score,
      percent: complete ? percentOf(score) : null,
      // 右端为外向 / 直觉 / 思考 / 知觉，左端为内向 / 实感 / 情感 / 判断。
      letter: complete ? (right ? dim.right : dim.left) : '',
      answered: answered,
      total: total,
      complete: complete
    };
  }

  function scoreAll(questions, answers) {
    var dims = {};
    var letters = '';
    var answered = 0;
    var total = 0;

    DIMS.forEach(function (dim) {
      var result = computeDim(dim, questions, answers);
      dims[dim.key] = result;
      letters += result.letter;
      answered += result.answered;
      total += result.total;
    });

    return {
      dims: dims,
      code: letters.length === 4 ? letters : '',
      answered: answered,
      total: total,
      complete: letters.length === 4
    };
  }

  global.WP_OEJTS_SCORE = {
    DIMS: DIMS,
    MID: MID,
    computeDim: computeDim,
    scoreAll: scoreAll
  };
})(typeof window !== 'undefined' ? window : globalThis);
