# dsh-startup-kit

可插拔的 **DeepSeek Harness 启动动画框架**。

一个稳定的启动壳 + 一组可替换的动画模块：壳负责所有危险的事（盖屏、锁滚动、跳过、看门狗、收场），动画只负责"演"。想换开场？丢一个 `.js` 进 `lib/animations/` 就行。

支持 **web profile** 与 **DeepSeek Harness 桌面端**（两者走不同的自举路径，见下）。

---

## 为什么这样拆

写启动动画最容易出的三种事故，全部由壳兜住：

| 事故 | 谁来兜 |
|---|---|
| 动画抛异常 → 用户永远卡在黑屏 | 壳立即揭幕，并解锁滚动 |
| 动画忘 `return` / 死循环 `await` | 看门狗 15s 强制收场 |
| 跳过时后台定时器还在改 DOM | `api.wait` 可被统一释放，`api.onSkip` 收尾 |

**动画作者不需要、也不允许自己拆黑幕。** 这条约束是整套设计的地基。

---

## 载体差异：两条自举路径（重要）

实测桌面端的窗口地址是 **`dsh-app://app/`** —— 一个自定义协议，**既不是 http 也不是 file**。

这一条决定了很多事：

| | web profile | 桌面端 |
|---|---|---|
| 窗口文档 | `http://127.0.0.1:<port>/` | `dsh-app://app/` |
| 首屏改写（`tapIndex`） | ✅ 生效 | ❌ **无效**（窗口不消费 HTTP 响应） |
| client 半边自举 | 备用 | ✅ **唯一可行路径** |
| 子资源请求（`/startup-kit/*`） | 直连 | 由 `dsh-app://` 代理到本地 HTTP 服务 ✅ |

所以本包有**两个半边**：

- **`lib/index.js`（Host）**：改写 index.html、注册 `/startup-kit/*` 路由、读写配置
- **`lib/client.js`（Client）**：在窗口里自举启动界面（桌面端靠它）

两者用 `window.__DSK_BOOT__` 握手：`'index'` 表示 Host 已经注入过，client 半边就什么都不做。

> 踩坑记录：早期只做了 Host 改写，桌面端完全没反应——`tapIndex` 明明命中了（日志有记录），
> 但窗口加载的是 `dsh-app://` 那份文档，注入永远到不了用户眼前。
> 判断方法：`~/.dsh/startup-kit-index.html` 有内容但浏览器零回传面包屑。

---

## 结构

```
dsh-startup-kit/
├── package.json
├── cordis.patch.yml          # bundle patch：挂一行宿主插件
├── install.cmd               # 桌面端一键安装（含运行中检测）
├── lib/
│   ├── index.js              # Host 半边：注入 + 路由 + 配置
│   ├── client.js             # Client 半边：自举 + 设置面板（loader 的 lazy-CJS 格式）
│   ├── service.js            # 与载体无关的 HTTP 服务（DSH 与预览服务器共用）
│   ├── shell.js              # 启动壳：时间线 / 跳过 / 看门狗 / 收场
│   ├── logger.js             # 落盘日志
│   ├── preview.html          # 预览页（选动画 / 调速 / 重播）
│   └── animations/
│       ├── fade.js           # 示例：时序驱动
│       ├── pulse.js          # 示例：CSS 驱动
│       └── _template.js      # 模板（下划线开头不进列表）
├── tools/
│   ├── preview.mjs           # 独立预览服务器
│   └── diagnose.mjs          # 诊断：把三份落盘证据拼成结论
└── test/                     # 12 项断言，全都不需要启动 DSH
```

---

## 两条使用路径

### 1. 先预览（5 秒见效）

```bash
node tools/preview.mjs
# → http://127.0.0.1:5599/startup-kit/preview
```

工具栏可以切动画、调速度、重播。改完动画文件按 `F5` 就行。

> 预览服务器和 DSH 里跑的是**同一份 `lib/service.js`**、同一个壳、同一批动画。预览里什么样，启动时就是什么样。

### 2. 装进 DSH

```bash
# web profile
dsh plugin --profile web add link:D:/path/to/dsh-startup-kit

# 桌面端：先【完全退出】桌面端（含托盘），再装，然后重新打开
dsh plugin --profile desktop add link:D:/path/to/dsh-startup-kit
```

Windows 上直接双击 **`install.cmd`** 更省事：它内置了 `dsh` 全路径调用、运行中检测和错误提示。

> **`dsh` 不在 PATH 里？** 桌面端自带启动器：
> `<安装目录>\resources\runtime\cli\bin\dsh.cmd`，用全路径调用即可。
> 想长期可用，把那个 `bin` 目录加进用户 PATH。

装完重启 DSH。**改动 `lib/*.js` 需要重启**（Host 代码与 client bundle 都在启动时加载）；
改 `startup-kit.json` 则刷新页面即可。

---

## 写一支自己的动画

复制 `lib/animations/_template.js` → 改成 `my-animation.js` → 刷新预览页 → 下拉里就多一项。

```js
/** @title 下拉里显示的名字 */
export const id = 'my-animation'
export const title = '我的动画'

export async function run(api) {
  const box = document.createElement('div')
  box.textContent = 'HELLO'
  api.stage.appendChild(box)

  await api.wait(1000)   // 可被跳过的等待
  api.setProgress(1)
}
```

- `run()` **resolve** → 演完了，壳负责淡出 + 移除 + 解锁
- `run()` **抛异常** → 壳立刻揭幕，绝不锁屏

### api 一览

| 成员 | 类型 | 说明 |
|---|---|---|
| `api.stage` | `HTMLElement` | 舞台，往这里 `appendChild` |
| `api.root` | `HTMLElement` | 全屏容器（一般不用碰） |
| `api.config` | `object` | 只读配置 |
| `api.wait(ms)` | `Promise` | 可被跳过的等待，内部已按 `speed` 缩放 |
| `api.frame()` | `Promise` | 等一帧 |
| `api.skip()` | `void` | 请求跳过 |
| `api.onSkip(fn)` | `void` | 注册清理回调（定时器 / 音效 / rAF） |
| `api.setProgress(p)` | `void` | `0..1`，驱动底部进度条 |
| `api.addStyle(css)` | `() => void` | 注入样式，返回移除函数 |
| `api.isSkipped()` | `boolean` | 已经跳过/收场了吗 |

### 三条经验

1. **用 `api.wait`，不要用 `setTimeout`。** 否则跳过之后你的定时器还在跑。
2. **循环动画要挂 `api.onSkip` 停掉**（CSS `animation` 会跟着节点移除自然停，rAF 不会）。
3. **切 class 触发 transition 前，先 `void el.offsetWidth`** 强制一次布局。

---

## 设置面板

左下角有个 **`◆`** 小按钮，点开可以：切动画、调速度、改播放策略、开关启用、重播开场。改完立即生效，写进 `~/.dsh/startup-kit.json`。

不想看到它：配置里 `"panel": false`。

> 为什么不用 DSH 的原生设置卡片：那条路要求 Host 侧用 `@deepseek-ai/dsh-settings`
> 注册命名空间、Client 侧用 React 注册进 `settings.plugin.item` 插槽，而且卡片
> 只有在 Host 服务了该命名空间时才渲染。对一个小插件来说依赖太重。

---

## 配置

`~/.dsh/startup-kit.json`：

```json
{
  "enabled": true,
  "mode": "session",
  "animation": "fade",
  "speed": 1,
  "allowSkip": true,
  "watchdogMs": 15000,
  "debug": false,
  "panel": true
}
```

| 字段 | 说明 |
|---|---|
| `enabled` | 总开关 |
| `mode` | `always` 每次刷新都播 · `session` 本会话一次 · `daily` 每天一次 |
| `animation` | 用哪支动画（`lib/animations/` 里的文件名，不含 `.js`） |
| `speed` | 全局倍率 `0.25 ~ 4`，只影响 `api.wait()` |
| `allowSkip` | 是否响应 `Esc` 和跳过按钮 |
| `watchdogMs` | 超过这个时间还没收场就强行揭幕，`2000 ~ 120000` |
| `debug` | 详细日志：连每个请求都记（平时关掉，免得把有用信息淹掉） |
| `panel` | 左下角设置面板 |

---

## 排查

```bash
node tools/diagnose.mjs
```

它读三份落盘证据并给结论：

| 文件 | 内容 |
|---|---|
| `~/.dsh/startup-kit.log` | 宿主：加载、注入、被栅栏拒绝的请求 |
| `~/.dsh/startup-kit-browser.log` | 浏览器：自举、壳挂载、动画加载、收场原因 |
| `~/.dsh/startup-kit-index.html` | 注入后的 index.html 原文 |

想强制每次都播：`node tools/diagnose.mjs --mode=always`。

---

## 事件与对外 API

```js
window.__DSH_STARTUP_KIT__ = { skip(), stop(), replay(), config }
```

| 事件 | 时机 | 用途 |
|---|---|---|
| `startup-kit:handoff` | 刚开始淡出 | 交叉叠化的钩子（此时你应已满不透明地等在下面） |
| `startup-kit:done` | 节点已移除、页面已解锁 | 启动结束 |

> 接第二幕要监听 `handoff` 而不是 `done`：淡出有 780ms，等 `done` 就会露出中间那段聊天窗口。

---

## 已知边界

- **需要 HTTP 载体。** 没有 `webServer` 时 Host 半边会打一条 warn 并跳过（不炸，但也没动画）。
- **桌面端会有一瞬底色切换。** client 半边在 bundle 执行的第一刻就铺黑幕，但应用首帧仍可能先画出来；这个空窗已压到接近 0。
- **只有一层。** 本包不提供"第二幕"（全屏视频 / 聊天底图），那是另一个插件的事。
- **预览页会写真实配置。** 「设为默认」写的是 `~/.dsh/startup-kit.json`。想隔离：`$env:DSH_HOME="D:\tmp\dsk"; node tools/preview.mjs`。
