// 16 型人格题库：Open Extended Jungian Type Scales 1.2（OEJTS）32 题中文版。
// 原文作者 Eric Jorgenson（2015），题目依 CC BY-NC-SA 4.0 许可使用；
// 中文译文由本项目翻译，同样以 CC BY-NC-SA 4.0 提供。OEJTS 与 MBTI® 无任何关联。
// 每题两端各是一句描述，作答在 1~5 之间选位置；sign 与 DIMS.base 对齐官方计分公式（见 oejts-score.js）。
window.WP_OEJTS_QUESTIONS = [
  // 判断 / 知觉（JP）
  { id: 1, dim: 'JP', sign: 1, left: '习惯把事情列成清单', right: '靠脑子记，不太写下来' },
  { id: 5, dim: 'JP', sign: 1, left: '房间保持整洁', right: '东西随手放，用的时候再找' },
  { id: 9, dim: 'JP', sign: -1, left: '随性，走一步看一步', right: '有条理，按部就班' },
  { id: 13, dim: 'JP', sign: 1, left: '提前很久就开始规划', right: '到最后一刻才规划' },
  { id: 17, dim: 'JP', sign: -1, left: '保留选择，先不把话说死', right: '尽早定下来，不再改' },
  { id: 21, dim: 'JP', sign: 1, left: '事情来了立刻做完', right: '先放一放，拖到最后' },
  { id: 25, dim: 'JP', sign: -1, left: '边做边改，先跑起来', right: '先准备好，再动手' },
  { id: 29, dim: 'JP', sign: 1, left: '干活肯拼，先把事做完', right: '玩得尽兴，该玩就玩' },

  // 实感 / 直觉（SN）
  { id: 4, dim: 'SN', sign: 1, left: '接受事物本来的样子', right: '总觉得现状还能更好' },
  { id: 8, dim: 'SN', sign: 1, left: '更喜欢做选择题', right: '更喜欢写论述题' },
  { id: 12, dim: 'SN', sign: 1, left: '更关注当下', right: '更关注未来' },
  { id: 16, dim: 'SN', sign: 1, left: '更想融入人群', right: '更想显得突出' },
  { id: 20, dim: 'SN', sign: 1, left: '讲一件事，先讲发生了什么', right: '讲一件事，先讲它意味着什么' },
  { id: 24, dim: 'SN', sign: -1, left: '先要全局，再看细节', right: '先要细节，再拼全局' },
  { id: 28, dim: 'SN', sign: -1, left: '偏理论，喜欢推演', right: '偏实证，要看证据' },
  { id: 32, dim: 'SN', sign: 1, left: '更想知道「谁、什么、何时」', right: '更想知道「为什么」' },

  // 思考 / 情感（TF）
  { id: 2, dim: 'TF', sign: -1, left: '习惯先怀疑一下', right: '更愿意先相信' },
  { id: 6, dim: 'TF', sign: 1, left: '觉得「像台机器」是句贬义', right: '希望自己像机器一样冷静精确' },
  { id: 10, dim: 'TF', sign: 1, left: '比较容易被话伤到', right: '不太往心里去' },
  { id: 14, dim: 'TF', sign: -1, left: '更希望被人尊重', right: '更希望被人喜欢' },
  { id: 18, dim: 'TF', sign: -1, left: '更想擅长修好一件东西', right: '更想擅长帮一个人变好' },
  { id: 22, dim: 'TF', sign: 1, left: '跟着感觉走', right: '跟着道理走' },
  { id: 26, dim: 'TF', sign: -1, left: '讲对错，按原则来', right: '讲体谅，看具体情况' },
  { id: 30, dim: 'TF', sign: -1, left: '不太习惯谈情绪', right: '很看重情绪' },

  // 外向 / 内向（EI）
  { id: 3, dim: 'EI', sign: -1, left: '一个人待久了会闷', right: '需要独处时间回血' },
  { id: 7, dim: 'EI', sign: -1, left: '精力充沛，话多', right: '平和，话少' },
  { id: 11, dim: 'EI', sign: -1, left: '在人群里状态最好', right: '一个人时状态最好' },
  { id: 15, dim: 'EI', sign: 1, left: '聚会后更累', right: '聚会后更有劲' },
  { id: 19, dim: 'EI', sign: -1, left: '说得多', right: '听得多' },
  { id: 23, dim: 'EI', sign: 1, left: '更愿意待在家', right: '更愿意出门走走' },
  { id: 27, dim: 'EI', sign: 1, left: '很难大声喊人', right: '喊远处的人很自然' },
  { id: 31, dim: 'EI', sign: -1, left: '喜欢在人前表现', right: '回避公开发言' }
];
