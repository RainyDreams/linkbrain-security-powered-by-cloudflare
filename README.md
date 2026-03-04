# Zero Ben Backend / Frontend

一个基于 Cloudflare Workers + D1 + Vue3 的 A 股自动交易演示系统，包含：
- 管理端：下单、撤单、持仓、风控、审计、AI 决策室
- 访客端：公开资产看板、成交播报、评论区、AI 自动交易讨论摘要
- 后端：撮合引擎、T+1 结算、审计日志、AI 委员会（多角色辩论与执行）

## 1. 技术栈

- Backend: Cloudflare Workers (ESM), D1 (SQLite), Cron Triggers
- Frontend: Vue 3 + Vite + Pinia + Vue Router + ECharts
- AI: Gemini（多模型候选，预算与节流控制）

## 2. 目录结构

```text
src/                    后端业务代码（路由、交易、AI、审计、定时任务）
migrations/             D1 迁移脚本
scripts/                压测/测试脚本
frontend/src/           前端代码（visitor + admin）
schema.sql              数据库结构快照
wrangler.toml           后端 Workers 配置
frontend/wrangler.toml  前端 Pages 配置
```

## 3. 核心能力

- 交易链路：下单 -> 挂单 -> 撮合 -> 成交 -> 审计
- 账户与持仓：可用资金、冻结资金、持仓数量、可卖数量
- T+1：当日买入不可当日卖出，卖出依赖 `available_qty`
- AI 委员会：
  - 角色：总裁、经理、经济学家 1/2
  - 输出：风险约束、执行计划、讨论摘要
  - 策略层次：长期 / 中期 / 短期 / 做T
  - 原子化执行：任一关键环节失败则整轮不执行下单
  - 降级与重试：429/限流时延迟重试（分钟级退避），避免请求循环
- 审计中心：技术审计 + 财务审计双轨检索
- 访客页：公开展示 AI 最近一次讨论与执行结论，突出自动交易能力

## 4. 本地开发

### 4.1 后端

```bash
npm install
npx wrangler dev
```

说明：
- 默认入口：`src/index.js`
- D1 绑定名：`DB`
- 定时任务：`wrangler.toml` 中的 cron 每分钟触发，内部按时段执行

### 4.2 前端

```bash
cd frontend
npm install
npm run dev
```

构建：

```bash
cd frontend
npm run build
```

## 5. 部署

### 5.1 后端 Workers

```bash
npm run deploy
```

### 5.2 前端 Pages

```bash
cd frontend
npm run deploy
```

## 6. 配置与密钥

`wrangler.toml` 中包含基础变量；生产建议使用 secret 管理敏感项：
- `JWT_SECRET`
- AI Key（如 `GEMINI_API_KEY` / `GOOGLE_API_KEY`）

建议：
- 不在仓库明文提交真实生产密钥
- 为不同环境（dev/staging/prod）使用不同变量集合

可用 Gemini 模型（已内置白名单）：
- `gemini-3-flash-preview`
- `gemini-flash-latest`
- `gemini-flash-lite-latest`
- `gemini-2.5-flash`
- `gemini-2.5-flash-lite`

## 7. 主要 API（示例）

- 公开接口
  - `GET /api/public/overview`：资产、持仓、成交、曲线、AI 讨论摘要
  - `GET /api/public/quote`：行情
  - `GET/POST /api/public/comments`：评论
- 管理接口（需登录）
  - `POST /api/auth/login`
  - `GET /api/admin/dashboard`
  - `POST /api/admin/trade`
  - `POST /api/admin/cancel`
  - `POST /api/admin/match`
  - `GET /api/admin/ai/*`
  - `GET /api/admin/audit`

## 8. 移动端与弹窗体验

已针对移动端做适配优化：
- 全局字号收敛，提升小屏信息密度
- 关键弹窗使用 Teleport 到 `body`，避免被父容器层级遮挡
- 弹窗打开时锁定背景滚动，减少误触和穿透感
- 管理端底部导航与访客页栅格在窄屏下自适应

## 9. 性能与加载体验

已做前端动态加载与动画衔接优化：
- 路由级懒加载：访客访问 `/` 时不会预加载 admin 页面模块
- 代码分包：`admin-pages` / `visitor-pages` / `vendor` / `echarts` 独立 chunk
- ECharts 按需加载：进入访客看板后再异步拉取图表库
- 全局路由加载动画：顶部进度条 + 轻量浮层提示，页面切换更平滑
- 页面过渡动画：路由切换使用短时 fade/slide 过渡

## 10. 测试与排查

可用脚本：

```bash
npm run stress:trade
npm run test:ai:strict
```

常见问题：
- 行情缺失：检查外部行情接口可达性
- AI 无输出：检查 API Key、模型限额、`/api/admin/ai/state` 配额
- 下单失败：优先查看审计中心中的技术/财务日志

## 11. 免责声明

本项目用于策略与流程演示，不构成任何投资建议。
