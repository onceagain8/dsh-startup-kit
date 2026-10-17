# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 变更

- **设置页集成摘掉，回到"动画 + 面板"的稳定状态。**
  尝试过两条路，都不适合这一版 DSH：
  1. 导出 `Config` + `ctx.settings.register` —— 当前载体没有消费者，
     设置页不会渲染；且一次脏合并把 `enabled` 写成了 `false`。
  2. 注册 `settings.section` —— 需要 `inject: ['slots']` 与 React，
     注册失败会连累整个设置页，风险与收益不成比例。
  结论与后续做法记在 README 的「设置」一节。

### 修复

- `truthy()` 改为三态：无法识别的值退回默认，不再一律判成 `false`
  （否则一次脏写入就能静默关掉插件）。
- client bundle 不再声明 `inject`，开场动画不依赖任何客户端服务。

### 变更

- **设置入口不再常驻**：默认只在开场动画期间显示 `⚙`（右下角 `SKIP` 旁边），
  播完随黑幕一起消失；任何时候都可用 `Ctrl+Alt+S` 打开面板。
  原因：常驻按钮会挡住侧栏的「…」菜单。
- `panel` 配置从布尔改为三态 `"boot" | "always" | "never"`；
  旧的 `true` 映射为 `"boot"`、`false` 映射为 `"never"`，老配置无需迁移。
- `"always"` 的常驻按钮改为**可拖动**，位置记在 `localStorage`。
- 面板改为底部居中弹出，不再从角落展开。

### 新增

- `test/client.mjs` 增加入口策略断言（`boot` 不产生常驻按钮）。

## [0.1.0] - 2026-10-17

首个可用版本。

### 新增

- **启动壳**（`lib/shell.js`）：可中断时间线、`Esc` / 按钮跳过、看门狗、统一收场。
  动画作者只负责"演"，收场、解锁、异常兜底全部由壳负责。
- **动画接口**：`export async function run(api)`，提供 `api.wait / setProgress /
  addStyle / onSkip / skip / isStage` 等能力。丢一个 `.js` 进 `lib/animations/`
  即出现在选择列表里。
- **两支示例动画**：`fade`（时序驱动）、`pulse`（CSS 驱动），代表两种写法。
- **Host 半边**（`lib/index.js`）：改写 `index.html` 注入首屏黑幕（web 载体），
  注册 `/startup-kit/*` 路由。
- **Client 半边**（`lib/client.js`）：桌面端自举（窗口地址为 `dsh-app://app/`，
  收不到宿主注入的 HTML），并在 bundle 执行的第一刻铺黑幕以消除白闪。
- **设置面板**：左下角 `◆`，切动画 / 调速度 / 改播放策略 / 重播，即时生效。
- **预览服务器**（`tools/preview.mjs`）：不装 DSH 也能调动画，与真实启动共用路由逻辑。
- **诊断工具**（`tools/diagnose.mjs`）：读三份落盘证据并给出结论与下一步。
- **测试**：12 项断言，覆盖壳的四条承诺、注入转义与幂等、client bundle 注册契约。

### 已知边界

- 需要 HTTP 载体。没有 `webServer` 时本插件不生效。
- 设置项写在 `~/.dsh/startup-kit.json`，未接入 DSH 原生设置卡片
  （需要 `@deepseek-ai/dsh-settings` + schemastery + React，见 README）。
