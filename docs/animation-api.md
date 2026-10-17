# 动画开发文档

给 `dsh-startup-kit` 写一支开场动画需要的东西，这一页全都有。

---

## 1. 最小可运行

```js
/** @title 我的动画 */
export const meta = {
  id: 'my-animation',
  title: '我的动画',
  description: '一句话说明',
  duration: 2000,
  complexity: 'simple'
}

export async function run(api) {
  const box = document.createElement('div')
  box.textContent = 'HELLO'
  api.stage.appendChild(box)
  await api.wait(1500)
}
```

把文件放进 `lib/animations/my-animation.js`，刷新预览页，下拉里就多一项。

---

## 2. 模块契约

| 导出 | 必需 | 作用 |
|---|---|---|
| `meta` | ✅ | 元信息。壳用它布防看门狗，清单用它显示提示 |
| `run(api)` | ✅ | 演出主体。**resolve 即演完**，之后由壳收场 |
| `setup(api)` | 可选 | 建 DOM / 载资源。在 `run` 之前，**不计时** |
| `dispose(api)` | 可选 | 清理。收场时调用，无论正常结束、跳过还是抛错 |

壳的调用顺序永远是 `setup → run → dispose`。

```js
export const meta = {
  id: 'my-animation',        // 必须等于文件名
  title: '我的动画',          // 下拉里显示
  description: '一句话说明',   // 面板里的 tooltip
  duration: 2000,            // 自报时长(ms)，决定看门狗
  complexity: 'simple',      // simple | medium | heavy，仅作提示
  tags: ['text']             // 自由标签，可选
}
```

### 两处元信息必须一致

文件头注释和 `meta` 是**两份**元信息，各有各的读者：

```js
/**
 * @title 我的动画
 * @description 一句话说明
 * @duration 2000
 * @complexity simple
 */
export const meta = { /* 同上 */ }
```

- **注释**：`/startup-kit/animations` 列表读它。清单每次请求都要列一遍，逐个 `import` 动画模块代价太大（还会提前执行模块副作用），所以用正则读文本。
- **`meta`**：壳在动画加载后读它。

写岔了不会报错，只会"列表显示 4.2s、看门狗按 2s 算"。`test/animations.mjs` 会拦这个。

---

## 3. 时长与看门狗

```
看门狗 = meta.duration / speed + 4000ms      （夹在 500ms ~ 120s 之间）
没写 duration → 用配置里的 watchdogMs（默认 15000）
```

含义：

- 演得比 `duration` 长**不会被打断**，只是兜底来得晚；
- 演得比 `duration` 短也没关系，兜底本来就只是保险；
- `duration` 是你对壳的承诺，尽量写准。

想按时长自己调节奏，用 `api.remaining()`：

```js
while (api.remaining() > 400) {
  // 做一点事
  await api.wait(40)
}
```

---

## 4. api 参考

| 成员 | 类型 | 说明 |
|---|---|---|
| `api.stage` | `HTMLElement` | 舞台，往这里 `appendChild` |
| `api.root` | `HTMLElement` | 全屏容器（一般不用碰） |
| `api.config` | `object` | 只读配置（含 `speed`） |
| `api.meta` | `object` | 你导出的 `meta` 副本 |
| `api.duration` | `number` | 你自报的时长；没报是 `0` |
| `api.elapsed()` | `number` | 从开场到现在过了多少 ms |
| `api.remaining()` | `number` | 还剩多少 ms；没报时长是 `Infinity` |
| `api.wait(ms)` | `Promise` | **可被跳过的等待**，内部已按 `speed` 缩放 |
| `api.frame()` | `Promise` | 等一帧 |
| `api.skip()` | `void` | 请求跳过 |
| `api.onSkip(fn)` | `void` | 注册清理回调（rAF / 定时器 / 音频） |
| `api.setProgress(p)` | `void` | `0..1`，驱动底部进度条 |
| `api.addStyle(css)` | `() => void` | 注入样式，返回移除函数 |
| `api.isSkipped()` | `boolean` | 已经跳过 / 收场了吗 |
| `api.log(...)` | `void` | 带 `[startup-kit]` 前缀的日志 |

---

## 5. 性能

### 四条硬规矩

1. **用 `api.wait`，别用 `setTimeout`。** 跳过时壳会统一释放所有 wait，你手写的定时器还在跑，会在收场之后继续改 DOM。
2. **`rAF` 必须挂 `api.onSkip` 停掉。** CSS `animation` 随节点移除会自动结束，`requestAnimationFrame` 不会。
3. **切 class 触发 transition 前先 `void el.offsetWidth`。** 否则浏览器会合并两次样式计算，动画不触发。
4. **逐字 / 逐帧只改 `textContent` 或重绘 canvas，不要重建节点。** 这是文字类和 canvas 类动画的性能分水岭。

### 三档复杂度的参考数字

| 档位 | 典型实现 | 参考帧率 | 例子 |
|---|---|---|---|
| `simple` | DOM + transition、CSS keyframes | 60 | `fade`、`pulse` |
| `medium` | 大量细粒度文本更新 | 55–60 | `typing` |
| `heavy` | canvas 逐帧重绘、O(n²) 计算 | 40–60（看机器） | `parts` |

预览页底部有个**帧率表**，低于 45fps 会变成橙色。重型动画的调参就靠它：

```
粒子数 240 → 约 67k 次距离判断/帧
降到 120   → 约 17k 次，弱机器上明显更稳
```

### 几条容易踩的

- **不要在 `run` 里同步跑重活**：`setup` 才是建 DOM、算初始位置的地方，它不计时。
- **`canvas` 记得按 `devicePixelRatio` 缩放**，否则高分屏上是糊的（`parts.js` 有现成写法）。
- **别改 `api.stage` 的父节点**：壳用它做收场动画。

---

## 6. 自检清单

提交一支动画前，逐条过：

- [ ] `meta.id` 等于文件名，`@title/@duration/@complexity` 与 `meta` 一致
- [ ] `run()` 一定会 resolve（不留悬空的 `await`）
- [ ] 所有 `rAF` / 定时器都挂了 `api.onSkip` 或在 `dispose` 里清
- [ ] 按过 `Esc`，屏幕正常还回去，后台没有残留循环
- [ ] 预览页帧率 ≥ 50（重型动画在你的目标机器上）
- [ ] `node test/animations.mjs` 通过

---

## 7. 现成的四支，从简到繁

| id | 名字 | 时长 | 复杂度 | 看它学什么 |
|---|---|---|---|---|
| `fade` | 淡入 | 3.6s | simple | 时序驱动：`await api.wait()` 就是分镜 |
| `pulse` | 呼吸圆环 | 3.0s | simple | CSS 驱动：循环交给 keyframes，JS 只计时 |
| `typing` | 终端打字 | 4.2s | medium | `setup / run / dispose` 三段式；细粒度文本更新 |
| `parts` | 粒子星云 | 5.0s | heavy | canvas + `rAF`；性能成本在哪、怎么收手 |

`lib/animations/_template.js` 是可以直接复制的骨架，下划线开头不会出现在列表里。
