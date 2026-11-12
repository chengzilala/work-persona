# Running · 本地运行与验证

> 面向零基础：照着做就能看到页面。

## 1. 看页面（最简单）

在 Finder 里双击 `work-persona/web/index.html`，浏览器会直接打开。

## 2. 起本地服务（推荐，手机也能看）

```bash
cd /Users/Admin/Knowledge/Coding/work-persona/web
python3 -m http.server 8930
```

- 电脑打开：http://localhost:8930
- 手机（同一 Wi-Fi）打开：`http://<电脑局域网 IP>:8930`

按 `Ctrl + C` 停止服务。

> 右上角「登录」依赖本机账户中心：页面 `:18830`、接口 `:8942`（见 `account-center/usage/Running.md`）。两个都起来后，点「登录」会在 18830 登录，登完带票回到本站。

## 3. 用真实 Chrome 看效果

```bash
open -a "Google Chrome" "http://localhost:8930"
```

## 4. 改哪里看哪里

| 想看什么 | 改哪个文件 |
|---|---|
| 页面结构 | `web/index.html` |
| 样式（配色 / 间距） | `web/assets/css/style.css` |
| 题库 | `web/assets/js/questions.js` |
| 报告文案 | `web/assets/js/content.js` |
| 计分规则（纯函数，无页面依赖） | `web/assets/js/score.js` |
| 答题 / 报告逻辑 | `web/assets/js/app.js` |
| 16 型页面结构 | `web/oejts.html` |
| 16 型题库（32 题） | `web/assets/js/oejts-questions.js` |
| 16 型计分（纯函数） | `web/assets/js/oejts-score.js` |
| 16 型文案（16 型 + 四维说明） | `web/assets/js/oejts-content.js` |
| 16 型页面逻辑 | `web/assets/js/oejts-app.js` |
| 阅读人格页面结构 | `web/reading.html` |
| 阅读人格四维 / 16 型命名 | `web/assets/js/reading-content.js` |
| 阅读人格录入逻辑（粘贴解析 / 手填） | `web/assets/js/reading.js` |
| 人格档案页结构 | `web/profile.html` |
| 人格档案页逻辑（三份并排） | `web/assets/js/profile.js` |
| 登录入口（统一账户中心） | `web/assets/js/account.js` |

改完刷新浏览器即可，无需构建。

## 5. 走一遍验证（答题 → 报告）

1. 打开首页，填个昵称，点「开始测评」。
2. 自然段每题为每个选项点一次「最像」和「最不像」；工作 / 压力段整卡单选，答完自动跳下一题。
3. 每段答完会出现「已完成 N/3」的过渡页，点「进入下一段」。
4. 45 题答完自动出报告：类型代码 + 类型名、综合特征（末尾一条「这套风格要留意的代价」）、三状态画像、状态位移。
5. 中途关掉页面再打开，首页顶部会出现「继续上次（已答 N/45 题）」，点它能接着答。
6. 想重测：首页点「重新开始」（会二次确认）。

## 5.1 走一遍 16 型人格（OEJTS，32 题）

1. 首页点「16 型人格（OEJTS）」入口卡，或直接打开 `http://localhost:8930/oejts.html`。
2. 每题上下两句话分别在一左一右，下面 5 个数字：1 更靠左、3 差不多、5 更靠右。
3. 选完约 0.3 秒自动跳下一题；点「← 上一题」可以回去改。
4. 32 题答完直接出结果：四位代码（如 `INFP`）+ 类型名 + 摘要 + 「要留意的代价」+ 四条维度条。
5. 中途退出，首页会出现「接着答（已答 N/32 题）」；结果存下来后首页多一张「上次结果」卡片。
6. 数据键与主测评分开：`wp_oejts_draft`（草稿）、`wp_oejts_result`（最近一次结果）；登录后会一起同步到云端。

## 5.2 走一遍阅读人格与人格档案

1. 首页点「我的人格档案」入口卡，或直接打开 `http://localhost:8930/profile.html`。
2. 空档案显示「已完成 0/3」，三块各给一个入口；点「录入阅读人格」进 `reading.html`。
3. 「粘贴导入」：把微信读书插件里的结果整段粘进去（含 `DFLP` 这类四位代码即可，带「深潜 78%」会一起存）。
4. 「手填四组」：四条滑杆拖到更像你的位置，左端依次是 D / F / L / P，点「保存这四组」。
5. 保存后出结果卡：四位代码 + 主称号 + 一句定调 + 四条维度条；点「重新录入」会沿用上次方式并带回数值。
6. 回「人格档案」，已完成的块显示代码与类型名，缺的块仍有入口；三份齐了顶部是「已完成 3/3」。
7. 数据键 `wp_reading_result`（阅读人格）；登录后随主测评一起同步。清空走首页「数据与隐私」的一键清除（会连云端档案一起删）。

## 6. 数据在哪

浏览器开发者工具 → Application → Local Storage → 当前地址。
清除数据走首页底部「关于三面 · 数据与隐私」（导出 JSON / 导入 / 两次确认一键清除）。

## 7. 纸面盲测材料（改题库后重跑一次）

```bash
cd /Users/Admin/Knowledge/Coding/work-persona
node test/blind-test/build-form.js
```

- 生成 `test/blind-test/form.html`（A4 打印卷：答案格 + 45 题（自然 24 / 工作 12 / 压力 9）+ 自评页）与 `answer-key.csv`（主持人计分钥匙，Excel 可直接打开）。
- 生成 PDF：`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="test/blind-test/form.pdf" "file://$PWD/test/blind-test/form.html"`（预期 7 页）。
- 打卷：真实 Chrome 打开 `form.html` → 右下角「打印 / 存为 PDF」。
- 流程与计分公式见 `test/blind-test/guide.md`，回收用 `record.csv`。

## 8. 云同步服务（可选，本机联调用）

不同步也能完整答题；只有验证「换设备能看到同一份历史」才需要起。

```bash
cd /Users/Admin/Knowledge/Coding/work-persona
PORT=8944 DB_FILE=/tmp/wp-sync.db ACCOUNT_CENTER=http://127.0.0.1:8942 node server/wp-sync.js
```

- 依赖：Node ≥ 22（用到内置 `node:sqlite`），零 npm 安装。
- 页面在同一台机器打开时默认请求 `http://127.0.0.1:8944`；要指到别处就在页面里先设 `window.WP_SYNC_BASE`。
- 验证：数据与隐私页 → 登录（登录后自动开启同步，无需再点「开启同步」）；首页品牌下方会出现「已同步 · HH:MM」，点一下可手动同步。主动「关闭同步」后，该设备不再自动开启。
- 自检接口：`curl -s http://127.0.0.1:8944/wp-sync/healthz`。

**线上现状（2026-11-10 已完成，改代码时照此更新）**

1. systemd 单元 `/etc/systemd/system/wp-sync.service`（已 enabled + running）：
   `WorkingDirectory=/srv/chesterlee/wp-sync`，`PORT=8944 HOST=127.0.0.1 DB_FILE=/srv/chesterlee/wp-sync/data/wp-sync.db ACCOUNT_CENTER=https://account.chesterlee.cn ALLOWED_ORIGINS=https://persona.chesterlee.cn`
2. Caddy 在 `persona.chesterlee.cn` 内已有 `reverse_proxy /wp-sync/* 127.0.0.1:8944`（在静态 `root` 之前生效）。
3. 账户中心已登记作品子域 `https://persona.chesterlee.cn`。

更新同步服务（改了 `server/wp-sync.js` 才需要）：

```bash
rsync -az -e "ssh -i ~/.ssh/chesterlee_web" \
  server/wp-sync.js ubuntu@43.136.92.125:/srv/chesterlee/wp-sync/server/
ssh -i ~/.ssh/chesterlee_web ubuntu@43.136.92.125 'sudo systemctl restart wp-sync.service && curl -s http://127.0.0.1:8944/wp-sync/healthz'
```

注意：`data/wp-sync.db*` 是真实档案，`rsync --delete` 同步 `web/` 时不要带上 `server/` 目录。

## 9. 线上部署（已上线）

- 地址：<https://persona.chesterlee.cn>（腾讯云轻量 `43.136.92.125`，Caddy 直读，证书自动续）
- 服务器目录：`/srv/chesterlee/persona`
- 更新方式（改完源文件执行一次）：

```bash
rsync -az --delete --exclude 'brand.html' -e "ssh -i ~/.ssh/chesterlee_web" \
  web/ ubuntu@43.136.92.125:/srv/chesterlee/persona/
```

静态文件直读，无需重启；页脚备案信息在主站台账 §2.3 有标准文案。
