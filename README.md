# MoonAPI — 每日知识卡片 API 服务

一个部署在 **Cloudflare Pages** 上的 API 接口后端 + 管理后台。数据存储在自建的 R2 与 KV 中，对外提供需要 API Key 认证的「每日知识卡片」接口，并配有完整的后台管理系统与接口文档站。

## 线上入口

| 入口 | 地址 |
| --- | --- |
| 首页 | `https://api.lunor.top/` |
| 管理后台 | `https://api.lunor.top/admin` |
| 接口文档 | `https://lunor.top/docs`（与 `https://api.lunor.top/docs` 相同） |
| 每日知识卡片接口 | `GET https://api.lunor.top/api/v1/daily-card` |
| 健康检查 | `GET https://api.lunor.top/api/health` |

## 目录结构

```
├── agent.md                     # 项目总纲（规划基准，必读）
├── functions/                   # Pages Functions（后端 API）
│   ├── _utils/                  #   共享工具（认证、响应封装、卡片存储）
│   └── api/                     #   /api/* 路由
├── public/                      # 静态资源（Pages 构建输出目录）
│   ├── index.html               #   首页
│   ├── admin/                   #   管理后台（原生 JS，无框架）
│   ├── docs/                    #   接口文档站
│   └── data/seed-cards.json     #   示例卡片数据包（后台可一键导入）
└── README.md
```

## 部署（Cloudflare Pages 网页版，手动操作）

1. Cloudflare 控制台 → Workers 和 Pages → 创建 → Pages → 连接到 Git，选择本仓库 `main` 分支。
2. 构建设置：
   - 框架预设：**None**
   - 构建命令：**留空**
   - 构建输出目录：**`public`**
   - 根目录：**留空**
3. 部署成功后，在 项目 → 设置 → Functions → 绑定 中添加（Production 与 Preview 都加）：
   - KV 命名空间：变量名 `MOONAPI_KV` → `moonapi`
   - R2 存储桶：变量名 `MOONAPI_R2` → `moonapi`
4. 自定义域：项目 → 自定义域 → 添加 `api.lunor.top`（如需 `lunor.top/docs` 再追加根域 `lunor.top`）。
5. 访问 `/api/health` 验证：应返回 `bindings: { kv: true, r2: true }`。

## 首次使用

1. 打开 `/admin`，按提示初始化管理员令牌（仅一次）。
2. 在「知识卡片」页点击「批量导入 → 加载示例数据包」导入示例卡片。
3. 在「API 密钥」页创建密钥，然后调用：

```bash
curl -H "Authorization: Bearer <你的API_KEY>" https://api.lunor.top/api/v1/daily-card
```

完整接口说明、参数、错误码见 `/docs` 文档站。

## 开发约定

- 后端为 Pages Functions（ESM，`onRequestGet` / `onRequestPost` / `onRequest` 导出），不使用构建工具。
- 绑定变量名固定：`MOONAPI_KV`、`MOONAPI_R2`，改名会导致接口 500。
- 界面设计遵循用户指定的 frontend-design skill 原则，拒绝模板化默认脸。
- 每次接口变动需同步更新 `public/docs/` 与 `agent.md`。
