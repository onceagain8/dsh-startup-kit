/**
 * @title 淡入（示例 · 时序驱动）
 *
 * 最小的一支动画：完全靠 api.wait 推进，一行 CSS 动画都没有。
 * 适合"跟着旁白走"的节奏型开场 —— 每一步什么时候发生，代码里读得出来。
 */

export const id = 'fade'
export const title = '淡入（示例）'

const WORD = 'DEEPSEEK HARNESS'

export async function run(api) {
  const dispose = api.addStyle(`
    .demo-fade{display:flex;flex-direction:column;align-items:center;gap:20px}
    .demo-fade h1{margin:0;display:flex;font-size:clamp(18px,3.2vw,38px);font-weight:400}
    .demo-fade h1 span{opacity:0;transform:translateY(10px);
      transition:opacity .5s cubic-bezier(.4,0,.2,1),transform .5s cubic-bezier(.4,0,.2,1)}
    .demo-fade.on h1 span{opacity:1;transform:none}
    .demo-fade .sub{margin:0;font-size:11px;letter-spacing:.34em;color:rgba(233,237,246,.38);
      opacity:0;transition:opacity .6s ease}
    .demo-fade.on .sub{opacity:1}
    .demo-fade .line{position:relative;width:min(260px,42vw);height:1px;background:rgba(233,237,246,.12)}
    .demo-fade .line i{position:absolute;left:0;top:0;bottom:0;width:0;background:#ff7500;
      transition:width .12s linear}
    .demo-fade .glow{position:absolute;width:420px;height:420px;border-radius:50%;
      background:radial-gradient(circle,rgba(255,117,0,.12),transparent 62%);pointer-events:none}
  `)

  const box = document.createElement('div')
  box.className = 'demo-fade'

  const glow = document.createElement('div')
  glow.className = 'glow'
  box.appendChild(glow)

  const h1 = document.createElement('h1')
  let n = 0
  for (const ch of WORD) {
    if (ch === ' ') {
      h1.appendChild(document.createTextNode('\u00a0'))
      continue
    }
    const span = document.createElement('span')
    span.textContent = ch
    span.style.transitionDelay = Math.round(n * 52) + 'ms'
    h1.appendChild(span)
    n++
  }

  const sub = document.createElement('p')
  sub.className = 'sub'
  sub.textContent = 'STARTING'

  const line = document.createElement('div')
  line.className = 'line'
  const fill = document.createElement('i')
  line.appendChild(fill)

  box.appendChild(h1)
  box.appendChild(sub)
  box.appendChild(line)
  api.stage.appendChild(box)

  api.setProgress(0.08)

  /* 先让它进过一次布局，再切 class —— 否则 transition 不会触发 */
  void box.offsetWidth
  box.classList.add('on')

  await api.wait(1100)
  api.setProgress(0.32)

  for (let step = 1; step <= 12; step++) {
    fill.style.width = Math.round((step / 12) * 100) + '%'
    api.setProgress(0.32 + step * 0.05)
    if (step === 6) sub.textContent = 'LOADING INTERFACE'
    await api.wait(120)
  }

  sub.textContent = 'READY'
  api.setProgress(0.96)
  await api.wait(420)

  /* 自己先淡掉再交还控制权，比硬切到壳的收场更顺 */
  box.style.transition = 'opacity .38s ease'
  box.style.opacity = '0'
  api.setProgress(1)
  await api.wait(420)

  dispose()
}
