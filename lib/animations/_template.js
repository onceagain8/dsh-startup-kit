/**
 * @title 动画模板
 * @description 复制本文件开始写自己的动画。下划线开头不会出现在列表里。
 * @duration 2000
 * @complexity simple
 *
 * ── 三分钟上手 ────────────────────────────────────────────────────────
 *
 * 1. 复制本文件为 lib/animations/my-animation.js（去掉下划线前缀）
 * 2. 改 meta 里的 id / title，以及文件头部的 @title / @duration
 * 3. 刷新预览页（或 DSH），下拉里就多一项
 *
 * ── 契约 ──────────────────────────────────────────────────────────────
 *
 * 一个动画就是一个 ES 模块，导出：
 *
 *   export const meta = {
 *     id: 'my-animation',
 *     title: '我的动画',
 *     description: '一句话说明，出现在预览页和面板里',
 *     duration: 2000,              // 自报时长(ms)。壳据此布防看门狗
 *     complexity: 'simple',        // simple | medium | heavy，仅作提示
 *     tags: ['text']
 *   }
 *
 *   export async function setup(api) {}   // 可选：建 DOM，不计时
 *   export async function run(api) {}     // 必须：演出
 *   export function dispose(api) {}       // 可选：清理（rAF、监听、音频）
 *
 * 壳的调用顺序：setup → run → dispose。run resolve 即"演完了"，由壳负责
 * 淡出、移除节点、解锁滚动。**不要自己拆黑幕**。
 *
 * ── 时长约定 ──────────────────────────────────────────────────────────
 *
 * meta.duration 是"你打算演多久"，壳用它算看门狗：
 *
 *   看门狗 = duration / speed + 4000ms
 *
 * 所以：
 *   · 演得比 duration 长不会被打断（还有 4s 余量），但兜底会来得晚
 *   · 演得比 duration 短没关系，只是兜底来得晚一点
 *   · 不写 duration → 用配置里的 watchdogMs（默认 15s）
 *
 * 想按时长调节奏，用 api.remaining() 而不是自己记时间：
 *
 *   while (api.remaining() > 400) { ...; await api.wait(40) }
 *
 * ── api ───────────────────────────────────────────────────────────────
 *
 *   api.stage          HTMLElement   舞台，往这里 appendChild
 *   api.root           HTMLElement   全屏容器（一般不用碰）
 *   api.config         object        只读配置（含 speed）
 *   api.meta           object        你导出的 meta 副本
 *   api.duration       number        你自报的时长；没报是 0
 *   api.elapsed()      number        从开场到现在过了多少 ms
 *   api.remaining()    number        还剩多少 ms；没报时长是 Infinity
 *   api.wait(ms)       Promise       可被跳过的等待，内部已按 speed 缩放
 *   api.frame()        Promise       等一帧
 *   api.skip()         void          请求跳过
 *   api.onSkip(fn)     void          注册清理回调（rAF、定时器、音频）
 *   api.setProgress(p) void          0..1，驱动底部进度条
 *   api.addStyle(css)  () => void    注入样式，返回移除函数
 *   api.isSkipped()    boolean       已经跳过/收场了吗
 *   api.log(...)       void          带前缀日志
 *
 * ── 四条经验 ──────────────────────────────────────────────────────────
 *
 * 1. 用 api.wait，不要用 setTimeout：跳过时前者会被统一释放，后者还在跑。
 * 2. 循环动画（rAF / CSS animation）要挂 api.onSkip 停掉；CSS 动画随节点
 *    移除会自然结束，rAF 不会。
 * 3. 切 class 触发 transition 前先 `void el.offsetWidth`，否则浏览器会合并
 *    两次样式计算，动画不触发。
 * 4. 逐字 / 逐帧更新只改 textContent 或重绘 canvas，不要重建节点 ——
 *    这是文字类和 canvas 类动画的性能分水岭。
 */

export const meta = {
  id: 'template',
  title: '动画模板',
  description: '复制这个文件开始写自己的动画',
  duration: 2000,
  complexity: 'simple',
  tags: ['starter']
}

export async function setup(api) {
  api.addStyle(`
    .my-anim{opacity:0;transform:translateY(12px);
      transition:opacity .7s cubic-bezier(.4,0,.2,1),transform .7s cubic-bezier(.4,0,.2,1)}
    .my-anim.on{opacity:1;transform:none}
  `)

  const box = document.createElement('div')
  box.className = 'my-anim'
  box.textContent = 'HELLO'
  api.stage.appendChild(box)
}

export async function run(api) {
  const box = api.stage.querySelector('.my-anim')
  if (!box) return

  void box.offsetWidth
  box.classList.add('on')

  api.setProgress(0.3)
  await api.wait(api.duration ? Math.max(200, api.duration - 600) : 1400)
  api.setProgress(1)
  await api.wait(400)
}

export function dispose() {
  /* 节点随黑幕一起移除；自建的定时器 / 监听在这里清 */
}
