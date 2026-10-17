/**
 * @title 粒子星云
 * @description Canvas 粒子 + 近邻连线，每帧 O(n²) 距离判断。重型动画，用来探性能上限。
 * @duration 5000
 * @complexity heavy
 *
 * 这一支演示：
 *   · setup 建 canvas 并做尺寸/DPR 处理（重活放在计时之外）
 *   · run 里用 requestAnimationFrame 自驱循环
 *   · 必须挂 api.onSkip 停掉 rAF，否则跳过之后它还在后台跑
 *
 * 性能提示：连接线的计算量是 n²。`COUNT` 是这支动画的主要成本旋钮，
 * 机器较弱时调到 120 左右会明显更稳。
 */

const COUNT = 240
const LINK_DIST = 128

export const meta = {
  id: 'parts',
  title: '粒子星云',
  description: 'Canvas 粒子 + 近邻连线，重型动画，用来探性能上限',
  duration: 5000,
  complexity: 'heavy',
  tags: ['canvas', 'particles', 'raf']
}

let state = null

/** 建画布（不计时） */
export async function setup(api) {
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'
  api.stage.appendChild(canvas)

  const dpr = Math.min(2, window.devicePixelRatio || 1)
  function resize() {
    const w = window.innerWidth
    const h = window.innerHeight
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    return { w, h }
  }
  let size = resize()

  const particles = []
  for (let i = 0; i < COUNT; i++) {
    particles.push({
      x: Math.random() * size.w,
      y: Math.random() * size.h,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      r: Math.random() * 1.6 + 0.6
    })
  }

  const onResize = () => {
    size = resize()
  }
  window.addEventListener('resize', onResize)

  state = {
    canvas,
    ctx: canvas.getContext('2d'),
    particles,
    get size() {
      return size
    },
    onResize,
    raf: 0
  }
}

/** 演出 */
export async function run(api) {
  if (!state) return
  const { ctx, particles } = state

  api.onSkip(() => stop())
  api.setProgress(0.15)

  let frame = 0
  const tick = () => {
    const { w, h } = state.size
    frame++

    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = 'rgba(5,6,10,0.35)'
    ctx.fillRect(0, 0, w, h)

    // 位移 + 边界回弹
    for (const p of particles) {
      p.x += p.vx
      p.y += p.vy
      if (p.x < 0 || p.x > w) p.vx *= -1
      if (p.y < 0 || p.y > h) p.vy *= -1
    }

    // 近邻连线：O(n²)，就是这支动画的性能成本所在
    ctx.lineWidth = 0.6
    for (let i = 0; i < particles.length; i++) {
      const a = particles[i]
      for (let j = i + 1; j < particles.length; j++) {
        const b = particles[j]
        const dx = a.x - b.x
        const dy = a.y - b.y
        const d2 = dx * dx + dy * dy
        if (d2 > LINK_DIST * LINK_DIST) continue
        const alpha = (1 - Math.sqrt(d2) / LINK_DIST) * 0.32
        ctx.strokeStyle = 'rgba(255,117,0,' + alpha.toFixed(3) + ')'
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
    }

    // 粒子本体
    ctx.fillStyle = 'rgba(233,237,246,0.72)'
    for (const p of particles) {
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
      ctx.fill()
    }

    if (frame % 12 === 0) api.setProgress(Math.min(0.95, 0.15 + frame / 320))
    state.raf = requestAnimationFrame(tick)
  }

  tick()
  await api.wait(meta.duration)
  stop()
}

function stop() {
  if (state && state.raf) {
    cancelAnimationFrame(state.raf)
    state.raf = 0
  }
}

/** 清理：rAF、resize 监听、canvas 节点 */
export function dispose() {
  if (!state) return
  stop()
  try {
    window.removeEventListener('resize', state.onResize)
    if (state.canvas.parentNode) state.canvas.parentNode.removeChild(state.canvas)
  } catch {
    /* noop */
  }
  state = null
}
