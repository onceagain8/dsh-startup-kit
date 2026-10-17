/**
 * @title 呼吸圆环（示例 · CSS 驱动）
 *
 * 和 fade.js 相反的另一种写法：视觉全部交给 CSS keyframes 自己跑，
 * JS 只负责"等够时间然后放手"。
 * 适合循环呼吸类、粒子类、纯视觉类的开场。
 */

export const id = 'pulse'
export const title = '呼吸圆环（示例）'

export async function run(api) {
  api.addStyle(`
    .demo-pulse{position:relative;display:flex;align-items:center;justify-content:center;
      width:100%;height:100%}
    .demo-pulse .ring{position:absolute;width:170px;height:170px;border-radius:50%;
      border:1px solid rgba(255,117,0,.5);animation:dsk-breathe 2.4s ease-in-out infinite}
    .demo-pulse .ring.two{width:250px;height:250px;border-color:rgba(233,237,246,.09);
      animation-duration:3.4s;animation-delay:-1.2s}
    .demo-pulse .core{width:9px;height:9px;border-radius:50%;background:#ff7500;
      box-shadow:0 0 24px rgba(255,117,0,.85);animation:dsk-core 1.2s ease-in-out infinite}
    .demo-pulse .label{position:absolute;top:calc(50% + 132px);left:0;right:0;text-align:center;
      font-size:11px;letter-spacing:.44em;color:rgba(233,237,246,.4)}
    .demo-pulse .label b{font-weight:400;animation:dsk-cut 1.4s steps(4) infinite}
    @keyframes dsk-breathe{
      0%,100%{transform:scale(.86);opacity:.22}
      50%{transform:scale(1);opacity:.9}
    }
    @keyframes dsk-core{
      0%,100%{transform:scale(.65);opacity:.5}
      50%{transform:scale(1);opacity:1}
    }
    @keyframes dsk-cut{
      0%{clip-path:inset(0 100% 0 0)}
      100%{clip-path:inset(0 0 0 0)}
    }
  `)

  const box = document.createElement('div')
  box.className = 'demo-pulse'
  box.innerHTML =
    '<i class="ring"></i><i class="ring two"></i><i class="core"></i>'
  const label = document.createElement('div')
  label.className = 'label'
  label.innerHTML = 'BOOTING<b>....</b>'
  box.appendChild(label)
  api.stage.appendChild(box)

  api.setProgress(0.18)
  await api.wait(900)
  api.setProgress(0.5)
  await api.wait(900)
  api.setProgress(0.82)
  await api.wait(700)
  api.setProgress(1)
  await api.wait(260)
}
