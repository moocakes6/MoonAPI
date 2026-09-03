# MoonAPI 项目总纲（agent.md）

> 本文件是项目的唯一规划基准。所有后续开发必须对照本文件执行，不允许偏离最初规划。
> 创建时间：2026-09-01 ｜ 维护方式：每个阶段完成后更新「进度记录」章节。

---

## 一、项目目标

打造一个 **API 接口后端 + 完善的后台管理系统**，整体部署在 **Cloudflare Pages** 上：

1. **API 服务**：对外提供需要 API Key 认证的接口，数据存储在自建存储（R2 + KV）中。
   - 第一个接口：**每日知识卡片**（`GET /api/v1/daily-card`）。
2. **管理后台**：访问 `https://api.lunor.top/admin` 即为完整的后台管理系统，支持
   数据的添加、编辑、删除、批量管理、API Key 管理、每日卡片排期。
3. **接口文档**：全套 API 文档放在 `https://lunor.top/docs`（同仓库 `/docs` 路径）。
4. **后期增强**：将接口能力扩展为「第三方自定义接口」——由本项目请求
   `https://api.yujin.cn/` 下的接口并做二创转发（Phase 2 实现）。

## 二、域名与访问入口

| 入口 | 地址 | 说明 |
| --- | --- | --- |
| API 接口 | `https://api.lunor.top/api/v1/...` | 需 API Key 认证 |
| 管理后台 | `https://api.lunor.top/admin` | 管理员令牌登录 |
| 接口文档 | `https://lunor.top/docs`（及 `api.lunor.top/docs`） | 公开文档 |
| 健康检查 | `https://api.lunor.top/api/health` | 公开，检测 KV/R2 绑定 |

域名 `lunor.top` 已托管在 Cloudflare，通过 Pages「自定义域」添加 `api.lunor.top`；
如需 `lunor.top/docs`，再为同一 Pages 项目追加根域 `lunor.top` 自定义域即可（两者可并存）。

## 三、Cloudflare 资源清单（已创建）

| 资源 | 名称 | 关键信息 |
| --- | --- | --- |
| 账户 | — | 账户 ID：`9df528fa134ca4e7a584b8d8a58474d5` |
| 区域 | lunor.top | 区域 ID：`51801436dfc0db5f885d7db6aa00a7d5` |
| KV 命名空间 | `moonapi` | ID：`927c0c7c5d84473ba2a2b906db97dbf6` |
| R2 存储桶 | `moonapi` | 位置：APAC；S3 端点：`https://9df528fa134ca4e7a584b8d8a58474d5.r2.cloudflarestorage.com/moonapi` |
| API 令牌 | Cloudflare API Token | `cfut_****`（已在 2026-09-01 会话中提供并验证可读取 KV/R2；令牌本体不入库——GitHub push protection 会拦截，需要时由用户在会话中重新提供） |

## 四、Cloudflare Pages 部署配置（网页版手动操作，不用 wrangler）

仓库：`https://github.com/moocakes6/MoonAPI`（main 分支）

在 Pages 控制台创建项目并连接 GitHub 后，**构建设置必须填写**：

| 配置项 | 值 |
| --- | --- |
| 框架预设（Framework preset） | `None` |
| 构建命令（Build command） | **留空**（本项目无需构建） |
| 构建输出目录（Build output directory） | `public` |
| 根目录（Root directory） | **留空**（使用仓库根目录） |

部署后必须配置的 **绑定（项目设置 → Functions → 绑定，Production 与 Preview 都要加）**：

| 绑定类型 | 变量名（必须一致） | 指向资源 |
| --- | --- | --- |
| KV 命名空间 | `MOONAPI_KV` | `moonapi`（927c0c7c5d84473ba2a2b906db97dbf6） |
| R2 存储桶 | `MOONAPI_R2` | `moonapi` |

> 绑定变量名是代码约定，改名会导致接口 500。配置后访问
> `https://<项目域名>/api/health` 应返回 `kv:true, r2:true`。

自定义域：项目 → 自定义域 → 添加 `api.lunor.top`（可选再加 `lunor.top`）。

## 五、技术架构

纯 **Cloudflare Pages（静态资源 + Pages Functions）**，零构建、零依赖：

```
MoonAPI/
├── agent.md                  # 本文件：项目总纲
├── README.md                 # 部署与使用指南
├── functions/                # Pages Functions（后端 API）
│   ├── _utils/               # 共享工具（下划线开头不会成为路由）
│   │   ├── http.js           # 响应封装、CORS
│   │   ├── auth.js           # 管理员/API Key 认证、SHA-256
│   │   └── cards.js          # 卡片索引读写、每日卡片选取
│   └── api/
│       ├── health.js             # GET /api/health（公开，自检绑定）
│       ├── v1/daily-card.js      # GET /api/v1/daily-card（API Key 认证）
│       └── admin/                # 管理接口（管理员令牌认证）
│           ├── setup.js          # POST 初始化管理员令牌（仅一次）
│           ├── login.js          # POST 校验管理员令牌
│           ├── cards.js          # GET 列表 / POST 新增（含批量）
│           ├── cards/[id].js     # GET/PUT/DELETE 单卡
│           ├── cards/batch-delete.js  # POST 批量删除
│           ├── daily.js          # GET/POST 每日排期（指定日期置顶卡片）
│           └── keys.js           # GET/POST API Key 列表/创建/吊销
├── public/                   # Pages 构建输出目录（静态资源）
│   ├── index.html            # 首页（服务概览）
│   ├── admin/                # 管理后台 SPA（原生 HTML/JS，无框架）
│   ├── docs/                 # API 接口文档站
│   └── data/seed-cards.json  # 示例卡片数据包（后台一键导入）
└── （预留）Phase 2 第三方代理接口
```

### 数据存储约定（2026-09-01 修订：全部迁移至 R2）

> 修订原因：KV 为最终一致（写入后最长 60 秒才可读），曾导致「初始化管理员后立即登录被判定未初始化」的
> 回弹 bug。现所有需要写后即读的数据一律存 R2（强一致），KV 绑定保留，供未来计数/缓存类场景使用。

**R2（绑定名 `MOONAPI_R2`）对象设计：**

| 对象键 | 内容 |
| --- | --- |
| `cards/{id}.json` | 卡片全文：`{id,title,category,content,source,tags,createdAt,updatedAt}` |
| `meta/cards-index.json` | 卡片索引数组：`[{id,title,category,updatedAt},...]`（列表页数据源） |
| `meta/admin-token.json` | 管理员令牌 SHA-256 哈希（首次 `POST /api/admin/setup` 写入） |
| `meta/api-keys.json` | API Key 表：`{ "mk_live_…": {name,status,createdAt,dailyQuota} }` |
| `meta/daily-pins.json` | 每日排期表：`{ "YYYY-MM-DD": 卡片id }` |
| `meta/proxy-services.json` | 代理服务注册表（覆盖内置默认，后台可增删改，无需重新部署） |
| `meta/media-index.json` | 媒体文件索引：`[{id,name,contentType,size,createdAt},...]` |
| `media/{id}` | 媒体文件本体（≤5MB/件，经 `/api/v1/media/{id}` 分发） |
| `stats/{YYYY-MM-DD}.json` | 当日用量：`{total, byKey, byEndpoint}`（waitUntil 异步写入） |
| `logs/{YYYY-MM-DD}/{HHmmss}-{ms}-{rand4}.json` | 单次调用明细（权威记录）：请求参数（敏感项掩码）、调用方、服务端分阶段计时、上游摘要、响应摘要。保留 30 天，2% 概率触发过期清理 |
| `meta/call-log-index/{date}.json` | 当日调用日志索引：`[{key,ts,route,slug,endpoint,status,code,ms,cache,caller},...]`（列表读路径，≤1200 条/日） |

**KV（绑定名 `MOONAPI_KV`）用途**：仅用于代理响应的带 TTL 缓存（`proxy:{slug}:{query}`，
`expirationTtl` ≥ 60s）。免费额度：10 万次读/天、1000 次写/天，故缓存默认关闭，按需为单个代理服务开启。

### 每日卡片选取逻辑

1. 若当日有排期（`daily:{date}`）→ 返回指定卡片；
2. 否则按日期哈希从全部卡片中确定性选取（同一天内结果稳定）；
3. 无任何卡片时返回内置兜底卡片。
4. 支持 `?date=YYYY-MM-DD` 查询指定日期；日期按北京时间（UTC+8）计算。

### 认证约定

- **对外接口**：请求头 `Authorization: Bearer <API_KEY>` 或 `X-API-Key: <API_KEY>`。
  API Key 形如 `mk_live_xxxx`，在后台创建。每日卡片与代理接口同时接受管理员令牌回退认证
  （便于后台「试调用」页直接联调），管理员测试不计入密钥配额。
- **管理接口**：请求头 `Authorization: Bearer <管理员令牌>`；令牌只存哈希。
- 所有接口返回统一信封：`{code, message, data, requestId}`；全部允许 CORS。

## 六、阶段计划

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| Phase 0 | 仓库底座：agent.md、README、Pages 部署配置 | ✅ 2026-09-01 |
| Phase 1 | 每日知识卡片接口 + 管理后台（卡片/密钥/排期）+ /docs 文档站 | ✅ 2026-09-01（待部署验证） |
| Phase 2 | 第三方接口代理框架（后台可配置上游、统一信封二创、KV 缓存）+ 媒体托管 + 用量统计与密钥配额 | ✅ 2026-09-01 |
| Phase 3 | 能力增强：后台「试调用」页（可视化调用过程 + R2 调用日志系统）✅ 2026-09-03；其余（更多内置上游、图片处理等）按需求再定 | 🔶 |

## 七、硬性约束（时刻谨记）

1. **部署方式**：只用 Cloudflare Pages 网页版手动配置，不使用 wrangler CLI 部署；
   构建命令留空、输出目录 `public`、绑定变量名固定为 `MOONAPI_KV` / `MOONAPI_R2`。
2. **UI 设计**：一切前端界面遵循用户指定的 frontend-design skill 原则
   （https://github.com/anthropics/claude-code/blob/main/plugins/frontend-design/skills/frontend-design/SKILL.md）：
   有辨识度的设计（拒绝模板化默认脸）、贴合主题的配色与字体、结构清晰、响应式、可访问。
3. **数据主权**：接口结果必须来自自建存储（R2 / KV），不依赖第三方。
4. **文档同步**：接口有变动必须同步更新 `public/docs/` 文档站与本文件。
5. **提交规范**：分阶段提交到 GitHub main 分支（文档 / 后端 / 前端 / 文档站分开提交）。
6. **管理员令牌**：首次部署后在 `/admin` 页面完成初始化；令牌只存哈希，
   忘记令牌需删除 KV 中 `admin:token` 后重新初始化。

## 八、进度记录

- 2026-09-01：项目立项。仓库克隆确认，Cloudflare 令牌验证通过（可读 KV 与 R2），
  KV 命名空间 `moonapi`、R2 桶 `moonapi` 已存在。Phase 0 + Phase 1 代码完成，待部署验证。
- 2026-09-01（晚）：Pages 部署成功（/api/health 返回 kv、r2 均 true），自定义域 api.lunor.top 生效。
  修复管理后台两个 bug：① 登录屏与主界面叠层显示（CSS `hidden` 被显式 `display` 覆盖）；
  ② 初始化管理员后被弹回认证屏（KV 最终一致性导致写后即读失败）——认证、密钥、卡片索引、
  排期全部迁移至 R2 强一致对象存储。注意：旧版本写入 KV 的管理员令牌不再使用，需重新初始化。
- 2026-09-01（深夜）：Phase 2 完成。新增：代理服务框架（/api/v1/proxy/{slug}，上游后台可配置、
  统一信封二创、KV 可选缓存、管理员令牌可直接测试）；媒体托管（/api/v1/media/{id} + 后台上传）；
  用量统计（/api/admin/stats，R2 异步记录）；密钥每日配额限流（42901）。
  备注：开发环境无法直连 api.yujin.cn（连接被重置），默认内置其首页探测服务，
  部署到 Cloudflare 边缘后由用户在后台「测试」验证连通性并按需增删上游。
- 2026-09-01（Phase 2.5）：① 内置卡片资料库 342 条（反诈 111、校园安全 38、校园学习 45、
  法律 25、网络安全 24、科学 26、文史 26、健康 28、心理 19），存于 /data/seed-library.json，
  GET /api/admin/cards 首次空库时自动入库（防重标记 meta/seed-applied.json），后台亦有一键导入按钮。
  ② 代理引擎升级为浏览器化请求头（UA/Referer/Accept-Language），支持按服务自定义 headers；
  内置上游新增 hitokoto（文本示例）、bing-wallpaper（图片透传示例）。
  ③ 上游返回 4xx/5xx 时返回带响应预览的诊断 JSON（code 50202）；测试弹窗展示原始响应文本。
  ④ 用户实测 yujin-root 返回 HTTP 530（上游 Cloudflare 拦截/源站异常），非本项目代码问题；
  api.yujin.cn 恢复可用后在后台直接新增其具体接口即可。
- 2026-09-03：Phase 3（一）完成——后台新增「✦ 试调用」页面组（调用台 + 调用记录）与 R2 调用日志系统。
  ① 新增 `functions/_utils/logger.js`：调用明细双写（明细对象 `logs/…` + 当日索引 `meta/call-log-index/…`），
  waitUntil 异步写入不阻塞响应，保留 30 天（2% 概率触发过期清理，单次清理 ≤10 天防止超 Workers 50 子请求上限），
  敏感参数（key/token/secret/password/apikey/authorization/access_token）写入前掩码。
  ② 新增 `functions/api/admin/logs.js`：GET 列表（days/limit/route/slug/status/requestId 过滤 + success 汇总）、
  GET 单条（?key=）、POST clear（keepDays 0–365）。
  ③ `functions/api/v1/proxy/[slug].js` 与 `daily-card.js` 重写为全链路分阶段计时
  （认证→服务解析→配额检查→缓存→上游转发→响应封装），阶段轨迹随日志落盘；
  daily-card 新增管理员令牌回退认证（与 proxy 一致，管理员测试不计配额）。
  ④ 前端：`/admin` 导航新增「✦ 试调用」，调用台支持目标选择 / 参数编辑 / 三种认证 / cURL 复制 /
  Ctrl+⌘+Enter 发送，结果区展示真实响应 + 服务端阶段轨迹（requestId 轮询日志获取），
  图片响应直接预览；调用记录含汇总卡、多维过滤、明细弹窗、自动刷新与清理入口。
  ⑤ docs 与本文件同步更新。后续待办：wrangler 本地仿真回归 → 推送部署 → 生产真实调用压测。

- 2026-09-03：Phase 3（二）修复两处线上反馈问题。
  ① 修复内置资料库惰性导入永久失效：原触发条件「卡片库为空且未导入」在用户先建卡的时序下永不满足，
  且 342 条逐条写 R2（≈344 子请求）必然超出 Workers 单请求 50 子请求上限——两因叠加导致卡片库只剩
  自建卡、每日卡片轮换失效（任意日期返回同一张）。改为 seedBatch 分批导入（每批 30 条，约 39 子请求，
  进度 meta/seed-progress.json），触发条件只看 applied 标记；后台卡片页加载时前端自动连续推进
  （400ms 间隔重拉）直至完成，完成后轮换池恢复为 342 + 自建卡数。
  ② 试调用台「认证方式」分段控件文字整体右移：原生 radio 圆点未隐藏占位——改为透明覆盖层
  （absolute + opacity:0 覆盖整个选项），文字居中、整块可点击、:focus-within 键盘焦点样式保留。

- 2026-09-03：Phase 3（三）后台背景主题切换。
  ① 默认背景换为「月岩灰」（冷灰蓝调：--paper #e8eaef / --card #f8f9fb / --line #d4d8e2 / --muted #6a7180，
  呼应深空蓝×月光金）；原「宣纸米白」保留为第二主题。
  ② 硬编码颜色 token 化（--field 输入框底 / --sunken 下沉容器底），保证两主题下控件底色协调。
  ③ 侧边栏底部新增「背景 · 主题名」切换按钮，循环切换两主题，选择持久化 localStorage（moonapi_bg），
  启动时优先应用（避免闪烁），body 背景带 .25s 过渡。纯前端改动，无接口变化。
- [22:50] 热修复：applyBgTheme 启动即执行时引用未初始化的 `$`（TDZ ReferenceError），导致 admin 整页脚本崩溃白屏（两个 screen 容器默认 hidden）；改用 document.getElementById 规避依赖顺序。教训：启动期代码不得引用后置 const 工具函数，node --check 不查 TDZ。