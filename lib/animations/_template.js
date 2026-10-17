/**
 * @title 我的动画（模板）
 *
 * ── 怎么用它 ────────────────────────────────────────────────────────────
 * 复制本文件为 lib/animations/my-animation.js（去掉下划线前缀），
 * 改 id / title，刷新预览页 → 下拉里就多了一项。
 *
 * 下划线开头的文件不会出现在动画列表里，所以这个模板可以一直留着。
 *
 * ── 契约 ────────────────────────────────────────────────────────────────
 * 一支动画就是一个 ES 模块，导出：
 *
 *   export const id     // 可选，默认取文件名
 *   export const title  // 显示在预览页下拉里
 *   export async function run(api)
 *
 * run() 里你只需要"演"：
 *   · resolve → 演完了，壳负责收场（淡出 + 移除 + 解锁）
 *   · 抛异常  → 壳立刻揭幕，绝不锁屏
 *   · 不要自己删 #dsk-root、不要自己解 dsk-lock —— 那是壳的事
 *
 * ── api ─────────────────────────────────────────────────────────────────
 *   api.stage            HTMLElement   舞台，往这里 appendChild
 *   api.root             HTMLElement   全屏容器（一般不用碰）
 *   api.config           object        只读配置（speed / mode / ...）
 *   api.wait(ms)         Promise       可被跳过的等待，内部已按 speed 缩放
 *   api.frame()          Promise       等一帧
 *   api.skip()           void          请求跳过
 *   api.onSkip(fn)       void          注册清理回调（定时器、音效、rAF）
 *   api.setProgress(p)   void          0..1，驱动底部进度条
 *   api.addStyle(css)    () => void    注入样式，返回移除函数
 *   api.isSkipped()      boolean       已经跳过/收场了吗
 *
 * ── 三条经验 ────────────────────────────────────────────────────────────
 * 1. 用 api.wait 而不是 setTimeout/setInterval —— 否则"跳过"时你的定时器
 *    还在跑，动画会继续在后台改 DOM。
 * 2. 循环动画（CSS keyframes / rAF）要挂 api.onSkip 去停掉。
 * 3. 切 class 触发 transition 之前，先 void el.offsetWidth 强制一次布局。
 */

export const id = 'template'
export const title = '我的动画（模板）'

export async function run(api) {
  const dispose = api.addStyle(`
    .my-anim{opacity:0;transform:translateY(12px);
      transition:opacity .7s cubic-bezier(.4,0,.2,1),transform .7s cubic-bezier(.4,0,.2,1)}
    .my-anim.on{opacity:1;transform:none}
  `)

  const box = document.createElement('div')
  box.className = 'my-anim'
  box.textContent = 'HELLO'
  api.stage.appendChild(box)

  void box.offsetWidth
  box.classList.add('on')

  api.setProgress(0.5)
  await api.wait(1200)
  api.setProgress(1)

  dispose()
}
