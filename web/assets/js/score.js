// 纯计分模块：不依赖 DOM，可在浏览器与 Node 中单独校验。
// 规则见 plan/RPD_需求文档.md §3.3。
(function (global) {
  'use strict';

  var DIMS = ['D', 'I', 'S', 'C'];
  var STAGE_ORDER = ['natural', 'work', 'stress'];
  var STAGE_LIMIT = { natural: 72, work: 24, stress: 18 };
  var STAGE_OFFSET = { natural: 24, work: 0, stress: 0 };

  function blank() {
    return { D: 0, I: 0, S: 0, C: 0 };
  }

  function rankScores(score) {
    return DIMS.slice().sort(function (a, b) {
      var diff = score[b] - score[a];
      if (diff !== 0) return diff;
      return DIMS.indexOf(a) - DIMS.indexOf(b);
    });
  }

  // 单段计分：natural 为「最像 +2 / 最不像 −1」，work、stress 为「最像 +2」。
  function computeStage(stage, questions, answers) {
    var raw = blank();
    var answered = 0;
    var total = 0;

    questions.forEach(function (q) {
      if (q.stage !== stage) return;
      total += 1;
      var a = answers[q.id];
      if (!a || !a.most) return;

      if (stage === 'natural') {
        if (!a.least || a.least === a.most) return;
        raw[a.most] += 2;
        raw[a.least] -= 1;
      } else {
        raw[a.most] += 2;
      }
      answered += 1;
    });

    var score = {};
    DIMS.forEach(function (d) {
      var value = (raw[d] + STAGE_OFFSET[stage]) / STAGE_LIMIT[stage] * 100;
      score[d] = Math.round(value);
    });

    var ranked = rankScores(score);
    return {
      raw: raw,
      score: score,
      main: ranked[0],
      secondary: ranked[1],
      answered: answered,
      total: total,
      complete: answered === total
    };
  }

  function computeShift(fromStage, toStage) {
    var dim = 'D';
    var max = -1;
    DIMS.forEach(function (d) {
      var delta = Math.abs(toStage.score[d] - fromStage.score[d]);
      if (delta > max) {
        max = delta;
        dim = d;
      }
    });
    var from = fromStage.score[dim];
    var to = toStage.score[dim];
    return {
      dim: dim,
      from: from,
      to: to,
      delta: to - from,
      absDelta: max,
      dir: to >= from ? 'up' : 'down'
    };
  }

  function scoreAll(questions, answers) {
    var byStage = {};
    STAGE_ORDER.forEach(function (stage) {
      byStage[stage] = computeStage(stage, questions, answers);
    });

    // 类型代码取自然状态；自然段异常不完整时退回工作状态。
    var basis = byStage.natural.complete ? byStage.natural : byStage.work;
    var main = basis.main;
    var secondary = basis.secondary;

    var low = DIMS.slice().sort(function (a, b) {
      return byStage.natural.score[a] - byStage.natural.score[b] || DIMS.indexOf(a) - DIMS.indexOf(b);
    })[0];

    return {
      byStage: byStage,
      main: main,
      secondary: secondary,
      code: main + secondary,
      low: low,
      shifts: {
        naturalWork: computeShift(byStage.natural, byStage.work),
        workStress: computeShift(byStage.work, byStage.stress)
      }
    };
  }

  global.WP_SCORE = {
    DIMS: DIMS,
    STAGE_ORDER: STAGE_ORDER,
    computeStage: computeStage,
    scoreAll: scoreAll
  };
})(typeof window !== 'undefined' ? window : globalThis);
