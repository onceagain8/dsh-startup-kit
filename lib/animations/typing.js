/**
 * @title 终端打字
 * @description 逐字打出一段启动日志，带闪烁光标。中等复杂度：大量细粒度 DOM 更新。
 * @duration 4200
 * @complexity medium
 *
 * 这一支演示：
 *   · 用 setup 建结构、run 推进（结构与演出分离）
 *   · 用 dispose 清掉自己开的定时器
 *   · 逐字更新只改 textContent，不重建节点 —— 文字类动画的性能关键
 */

const LOG = [
  '> dsh boot --profile desktop',
  '  resolving plugins ...... ok',
  '  mounting web facade .... ok',
  '  restoring session ...... ok',
  '  starting agent loop .... ok',
  '',
  '  ready.'
]

export const meta = {
  id: 'typing',
  title: '终端打字',
  description: '逐字打出启动日志，演示 setup/run/dispose 三段式',
  duration: 4200,
  complexity: 'medium',
  tags: ['text', 'terminal']
}

/** setup 建的节点，留给 run 用（模块级，不往 api 上挂东西） */
let node = null

/** 建结构（不计时） */
export async function setup(api) {
  api.addStyle(`
    .demo-typing{width:min(560px,72vw);padding:22px 24px;border-radius:10px;
      background:rgba(10,12,18,.72);border:1px solid rgba(233,237,246,.08);
      box-shadow:0 20px 60px rgba(0,0,0,.5);
      font:13px/1.9 ui-monospace,SFMono-Regular,Consolas,monospace;color:#cfd8e8}
    .demo-typing .bar{display:flex;gap:6px;margin-bottom:14px}
    .demo-typing .bar i{width:9px;height:9px;border-radius:50%;background:rgba(233,237,246,.16)}
    .demo-typing .bar i:first-child{background:rgba(255,117,0,.6)}
    .demo-typing .line{white-space:pre-wrap;min-height:1.9em}
    .demo-typing .cursor{display:inline-block;width:7px;height:14px;margin-left:2px;
      background:#ff7500;vertical-align:-2px;animation:dsk-blink 1s steps(2) infinite}
    @keyframes dsk-blink{0%,49%{opacity:1}50%,100%{opacity:0}}
  `)

  const box = document.createElement('div')
  box.className = 'demo-typing'
  box.innerHTML = '<div class="bar"><i></i><i></i><i></i></div>'

  const lines = []
  for (let i = 0; i < LOG.length; i++) {
    const el = document.createElement('div')
    el.className = 'line'
    box.appendChild(el)
    lines.push(el)
  }
  const cursor = document.createElement('i')
  cursor.className = 'cursor'
  lines[lines.length - 1].appendChild(cursor)

  api.stage.appendChild(box)
  node = { box, lines, cursor }
}

/** 演出 */
export async function run(api) {
  if (!node) return
  const { lines, cursor } = node

  api.setProgress(0.1)

  for (let i = 0; i < LOG.length; i++) {
    const el = lines[i]
    const text = LOG[i]

    // 空行只是停顿
    if (text === '') {
      await api.wait(180)
      continue
    }

    for (let c = 0; c < text.length; c++) {
      el.textContent = text.slice(0, c + 1)
      // 行首缩进的字符快一点，看着像扫描
      await api.wait(text[c] === ' ' ? 8 : 16)
      if (api.isSkipped()) return
    }

    // 把光标移到当前行末尾
    if (cursor.parentNode !== el) {
      el.appendChild(cursor)
    }
    api.setProgress(0.1 + ((i + 1) / LOG.length) * 0.8)

    // 每一行之间留一点"处理"时间
    await api.wait(220)
  }

  api.setProgress(1)
  await api.wait(500)
}

/** 清理：节点随黑幕一起移除，这里只放开引用，避免下次重播拿到旧节点 */
export function dispose() {
  node = null
}
