# 三面 · 职业行为风格测评（work-persona）

团队内部用的职业行为风格测评（DISC 四维：支配 D / 影响 I / 稳健 S / 谨慎 C），输出**自然 / 工作 / 压力**三种状态下的个人报告。

> 产品名「三面」，上线子域 `persona.chesterlee.cn`；英文项目名仍为 `work-persona`。
> 一期只做个人报告，纯静态 H5；二期加团队合拍；三期并入阅读人格与 16 型人格。

## 现在是什么状态

- **M0（题库与规则）已完成**：45 题原创题库（自然 24 / 工作 12 / 压力 9，v0.23 起）、12 组类型名、分段归一化计分规则；**真人纸面盲测尚未做**。
- **M1（最小闭环）已完成**：首页 → 三段答题 → 阶段反馈 → 计分 → 报告，含答题草稿续答。
- **报告可视化已完成**（v0.12）：三状态折线图、类型简笔画头像与「职场熟面孔」联想、四维释义卡片。
- **历史记录已完成**（v0.15）：完成即存（唯一 id / 50 条上限 / 写失败保留草稿并可重试）、首页与报告页入口、列表与详情复看、与上一条对比。
- **数据管理已完成**（v0.15）：首页 / 历史页「数据与隐私」入口，导出导入 JSON、两次确认一键清除、隐私说明。
- **分享图已完成**（v0.16）：报告页一键生成 1080×1920 竖版图（类型 + 三状态曲线 + 3 条特征 + 站点名），手机长按保存。
- **维度说明与关于页已完成**（v0.17）：报告四维可展开看生活表现、DISC 来源与公开链接；首页底部「关于三面」含定位、用法、数据说明与固定声明。
- **参考知识库已完成**（v0.19）：新增站内知识库 `web/kb.html`，报告来源全部改成中文条目、点开就在站内读、不外跳；知识库界面可「加入参考来源」，条目存本机、可删除。
- **已上线**：<https://persona.chesterlee.cn>（2026-11-10，腾讯云轻量 + Caddy 自动证书，登录走统一账户中心）。
- **纸面盲测材料已就绪**（v0.20，v0.23 重新生成）：`test/blind-test/` 下 `form.pdf`（7 页 A4）+ `form.html`（打印卷源文件）+ `answer-key.csv`（计分钥匙）+ `guide.md`（流程与话术）+ `record.csv`（回收表）+ `score-sheet.js`（计分器），由 `node test/blind-test/build-form.js` 从题库生成；**等 3~5 人实答**。
- **云同步已上线**（v0.22）：`server/wp-sync.js`（零依赖 Node + SQLite，systemd 常驻）+ `web/assets/js/sync.js`；**登录后自动同步**（每台设备首次登录即拉取合并，主动关闭后不再自动开启），数据页可立即同步 / 关闭 / 删除云端档案，首页品牌下方显示同步状态，冲突按 `updatedAt` 与历史 `id` 合并；线上 `https://persona.chesterlee.cn/wp-sync/*` 由 Caddy 反代到本机 8944。
- **16 型人格已上线**（v0.24，三期首块）：独立页 `web/oejts.html`，32 题 OEJTS 中文版（五点量表、四维得分条、16 型原创文案、代价提示），结果存 `wp_oejts_result`、草稿存 `wp_oejts_draft`，与主测评完全分开并已并入云同步；首页新增入口卡。题目依 CC BY-NC-SA 4.0 使用（Eric Jorgenson，2015），与 MBTI® 无关。
- **阅读人格与人格档案已上线**（v0.25）：`web/reading.html` 录入阅读人格（粘贴插件结果或手填四组滑杆，存 `wp_reading_result` 并并入云同步）；`web/profile.html` 把三面 / 16 型 / 阅读人格三份结果并排展示，缺哪份给出口，不自动生成跨测评结论。站内不采集微信读书数据。
- 后续（未做）：S5c 跨设备验收（手机 + 电脑交叉验证历史 / 草稿 / 设置）、按盲测结果校准题库与计分、AI 润色文案（S8）。
- **代码仓库**（v0.23 首次入库）：[GitHub](https://github.com/chengzilala/work-persona) ｜ [Gitee](https://gitee.com/chengzila/work-persona)，双远程各推一份。
- 需求见 [plan/RPD_需求文档.md](plan/RPD_需求文档.md)，可行性见 [Idea/可行性分析_职业人格测评复刻.md](../Idea/可行性分析_职业人格测评复刻.md)。

## 目录结构

```
work-persona/
├── .trae/                 # 规则 + 技能（独立工作区用）
├── plan/                  # 需求文档（唯一需求源）
├── dev/                   # 开发日志、工作法
├── test/                  # 验收清单、纸面盲测材料
├── server/                # 同步服务（零依赖 Node + SQLite）
├── usage/                 # 零基础运行说明
├── screenshots/           # 效果图
├── inbox/                 # 临时待归类
└── web/                   # 站点源码（纯静态，无构建）
    ├── index.html         #   测评本体（首页 / 答题 / 报告 / 历史）
    ├── oejts.html         #   16 型人格（OEJTS 32 题，独立页）
    ├── reading.html       #   阅读人格录入（粘贴 / 手填）
    ├── profile.html       #   人格档案（三份结果并排）
    ├── kb.html            #   参考知识库（中文来源条目，可在界面加入来源）
    └── assets/{css,js,img}
```

## 怎么跑

双击 `web/index.html`，或在项目根起静态服务：

```bash
cd web && python3 -m http.server 8930
```

然后打开 http://localhost:8930 。

### 账户入口（接入统一账户中心）

- 线上作品已登记：`https://persona.chesterlee.cn`，配色 `light #2F6FED`；账户中心 `ALLOWED_ORIGINS` 已含该域名，登录方式含手机号 / 邮箱 / GitHub / Gitee。
- 本机联调需同时起账户中心：页面 `:18830`、接口 `:8942`（见 `account-center/usage/Running.md`）。
- 账户中心数据读进内存，**登记后要重启本机接口进程**才会生效。
- 账户入口需通过 http(s) 打开；`file://` 双击方式无法跨域换票，入口会自动隐藏。
- 本机页面与接口分端口（18830 / 8942），接口不托管页面，故**本机禁用 SDK 静默登录**，只走手动点「登录」；线上不受影响。
- 本机另有一份登记：`http://localhost:8930`（页面 `:8930`、接口 `:8942`），只用于本地联调。

### 同步服务（本机联调，可选）

不同步也能完整答题；只有要验证跨设备才需要起。

```bash
PORT=8944 DB_FILE=/tmp/wp-sync.db ACCOUNT_CENTER=http://127.0.0.1:8942 node server/wp-sync.js
```

- 页面同源时默认请求 `http://127.0.0.1:8944`（可用 `window.WP_SYNC_BASE` 覆盖）。
- `ALLOWED_ORIGINS` 默认含 `https://persona.chesterlee.cn`、`http://localhost:8930`、`http://127.0.0.1:8930`。
- 上线形态：Caddy 在 `persona.chesterlee.cn` 加 `handle /wp-sync/*` 反代 `127.0.0.1:8944`，用 systemd 常驻（详见 `usage/Running.md`）。

## 边界（很重要）

- 只复刻**信息结构与体验**，题目、报告文案全部原创；不使用「甄有才 / BEST / HRforce / MBTI」名号。
- 16 型人格的 32 道题来自 OEJTS 1.2（Eric Jorgenson，2015），依 **CC BY-NC-SA 4.0** 使用：需署名、非商业、相同方式共享；页面已写明，与 MBTI® 无关。
- 不写「精准度超 90%」这类无依据表述。
- 结果只作自我认知与团队沟通参考，**不作为招聘、晋升、淘汰的依据**；页面须写明「不构成心理诊断或医疗建议」。
- 一期数据只存本机（`localStorage`），提供导出/导入与一键清除。
