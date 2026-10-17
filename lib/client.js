/**
 * dsh-startup-kit — 浏览器半边（client bundle）
 * ----------------------------------------------------------------------------
 * 为什么需要它：桌面端的窗口地址是 `dsh-app://app/` —— 一个自定义协议。
 * 它既不从 HTTP 取首屏（宿主改写 index.html 影响不到它），也不走 file://。
 * 唯一能在窗口里执行代码的入口，就是 client bundle。
 *
 * 但 `dsh-app://` 会把子资源请求代理到本地 HTTP 服务，所以 bundle 能取到
 * /startup-kit/config 和 shell.js —— 这条链是通的。
 *
 * 时序（实测）：
 *   应用绘制            ~0ms
 *   bundle 顶层          ~0ms   ← 立刻铺黑幕（不等任何网络往返）
 *   取配置 + 装壳        ~240ms
 *   动画开始            ~300ms
 *
 * 打包格式：DSH 的 client bundle 是**经典脚本**，必须调用
 * `window.__ModuleLoader__.load({ id, factory })` 注册一个 CJS 工厂，
 * 工厂返回的导出对象由 Cordis 当插件消费（apply / inject）。
 * 格式照 packages/client/ui-brand-official/lib/client.js 抄的。
 */
;(function () {
  'use strict'

  var BASE = '/startup-kit'
  var ROOT_ID = 'dsk-root'
  var LAST_KEY = 'startup-kit:last'

  var preCovered = false

  /* ── 小工具 ──────────────────────────────────────────────────────────── */

  /** 诊断面包屑：img 通道，不受 CORS / 预检 / 自定义头限制。 */
  function crumb(name, extra) {
    try {
      var d = ''
      if (extra !== undefined && extra !== null) {
        d = typeof extra === 'string' ? extra : JSON.stringify(extra)
      }
      new Image().src =
        BASE +
        '/log?e=' +
        encodeURIComponent(name) +
        '&x=' +
        encodeURIComponent(String(d).slice(0, 400))
    } catch (e) {
      /* 诊断不影响演出 */
    }
  }

  function today() {
    try {
      return new Date().toISOString().slice(0, 10)
    } catch (e) {
      return ''
    }
  }

  /** 上次成功启动时的配置：用来在"还没拿到网络配置"时先做一次同步判断。 */
  function lastConfig() {
    try {
      return JSON.parse(localStorage.getItem(LAST_KEY) || 'null')
    } catch (e) {
      return null
    }
  }

  function remember(cfg) {
    try {
      localStorage.setItem(
        LAST_KEY,
        JSON.stringify({ enabled: cfg.enabled, mode: cfg.mode, animation: cfg.animation })
      )
    } catch (e) {
      /* 存不了就算了 */
    }
  }

  /** 同步判断：这一轮"大概率不该播"就先别铺，免得白黑一下。 */
  function likelySkip() {
    var cfg = lastConfig()
    if (!cfg) return false
    if (cfg.enabled === false) return true
    var mode = cfg.mode || 'session'
    try {
      if (mode === 'session' && sessionStorage.getItem('startup-kit:shown') === '1') return true
      if (mode === 'daily' && localStorage.getItem('startup-kit:day') === today()) return true
    } catch (e) {
      /* 存储不可用 → 当作该播 */
    }
    return false
  }

  function ensureRoot() {
    var root = document.getElementById(ROOT_ID)
    if (!root) {
      root = document.createElement('div')
      root.id = ROOT_ID
      document.body.appendChild(root)
    }
    root.className = 'dsk-root dsk-boot'
    root.style.cssText =
      'position:fixed;inset:0;z-index:2147483000;background:#05060a;cursor:progress'
    return root
  }

  function teardown() {
    try {
      var r = document.getElementById(ROOT_ID)
      if (r && r.parentNode) r.parentNode.removeChild(r)
      var p = document.getElementById('dsk-preflush')
      if (p && p.parentNode) p.parentNode.removeChild(p)
      document.documentElement.classList.remove('dsk-lock')
      document.documentElement.style.overflow = ''
      if (document.body) document.body.style.overflow = ''
    } catch (e) {
      /* 拆不掉也不能抛 */
    }
  }

  /* ── 顶层：脚本一执行就盖住 ──────────────────────────────────────────
   * 这是"消闪"的全部关键：不等配置、不等任何往返。实测应用画出来到
   * 黑幕盖上原本有 ~240ms 的空窗，现在这个空窗按 0 算。
   * 唯一例外是上次配置说"不必播"，那时就不盖，免得白黑一下。 */
  try {
    if (!window.__DSK_BOOT__ && !window.__DSK_LOADED__ && !likelySkip()) {
      ensureRoot()
      document.documentElement.classList.add('dsk-lock')
      preCovered = true
      // 顶层自己也要有退路：apply 从没被调用时，别把界面永久盖住
      setTimeout(function () {
        if (!window.__DSK_BOOT__ && !window.__DSK_LOADED__) {
          crumb('precover-watchdog', 'apply never ran')
          teardown()
        }
      }, 12000)
    }
  } catch (e) {
    /* 顶层不许抛 */
  }

  /* ── 设置面板 ──────────────────────────────────────────────────────────
   * 设置界面自带，直接读写 /startup-kit/config，零依赖、改完立即生效。
   *
   * 为什么不接进 DSH 设置页：见 README「设置」一节。简单说，这一版 DSH 的
   * 设置页只有一个只读的「插件」分区，没有可放第三方配置的插槽；能用的
   * `settings.section` 需要声明 inject 并渲染 React，风险面比收益大，
   * 所以先搁置，等主流程稳定后单独做。
   *
   * 面板层级低于黑幕（2147482900 < 2147483000），但打开时会盖在黑幕之上，
   * 因为它只有用户主动触发才显示。 */
  function saveConfig(patch, onDone) {
    try {
      fetch(BASE + '/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch)
      })
        .then(function (r) {
          return r.json()
        })
        .then(function (d) {
          if (onDone) onDone(d && d.ok, d)
        })
        .catch(function () {
          if (onDone) onDone(false)
        })
    } catch (e) {
      if (onDone) onDone(false)
    }
  }

  var panelApi = null

  function mountPanel(cfg, animations) {
    try {
      if (document.getElementById('dsk-panel')) return panelApi

      // 'boot' 只在开场期间由 SKIP 旁边的 ⚙ 打开；'always' 额外给一个可拖动的常驻按钮
      var mode = cfg.panel === 'always' || cfg.panel === 'never' ? cfg.panel : 'boot'

      var style = document.createElement('style')
      style.id = 'dsk-panel-style'
      style.textContent = [
        // 面板放在**底部居中**，不从角落弹出 —— 角落是侧栏「…」和发送按钮的地盘
        '#dsk-panel{position:fixed;left:50%;bottom:76px;transform:translateX(-50%);',
        // 层级要高过开场黑幕（2147483000）——它是"用户主动打开"的，必须能看见
        'z-index:2147483010;width:300px;padding:14px 16px 16px;border-radius:10px;',
        'background:rgba(16,19,26,.97);border:1px solid rgba(255,255,255,.1);color:#c9d2e3;',
        'font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;',
        'box-shadow:0 16px 48px rgba(0,0,0,.55);display:none}',
        '#dsk-panel.on{display:block}',
        '#dsk-panel .h{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;',
        'color:#fff;letter-spacing:.08em}',
        '#dsk-panel .h button{background:none;border:0;color:#7d879c;font-size:15px;cursor:pointer}',
        '#dsk-panel label{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:7px 0;color:#8b97ad}',
        '#dsk-panel select{font:inherit;background:#151a24;color:#c9d2e3;border:1px solid rgba(255,255,255,.12);',
        'border-radius:4px;padding:3px 6px;max-width:160px}',
        '#dsk-panel input[type=range]{width:120px;accent-color:#ff7500}',
        '#dsk-panel .row{display:flex;align-items:center;gap:10px;margin-top:12px}',
        '#dsk-panel .row button{font:inherit;background:#1b2130;color:#c9d2e3;border:1px solid rgba(255,255,255,.12);',
        'border-radius:4px;padding:5px 10px;cursor:pointer}',
        '#dsk-panel .row button:hover{border-color:rgba(255,117,0,.6);color:#fff}',
        '#dsk-panel .msg{color:#6ee7a8;font-size:11px}',
        '#dsk-panel .tip{margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,.07);',
        'color:#5f6a7e;font-size:11px}',
        '#dsk-fab{position:fixed;z-index:2147482900;width:30px;height:30px;border-radius:50%;',
        'border:1px solid rgba(255,255,255,.14);background:rgba(20,24,32,.72);color:#9aa6bd;',
        'font:13px/1 ui-monospace,monospace;cursor:grab;opacity:.4;transition:opacity .2s,color .2s;',
        'touch-action:none}',
        '#dsk-fab:hover{opacity:1;color:#fff}'
      ].join('')

      var panel = document.createElement('div')
      panel.id = 'dsk-panel'
      panel.innerHTML =
        '<div class="h"><span>启动动画</span><button type="button" data-close>×</button></div>' +
        '<label>动画<select data-anim></select></label>' +
        '<label>速度<input type="range" min="0.25" max="2" step="0.05" data-speed>' +
        '<b data-speedv>1.00×</b></label>' +
        '<label>播放<select data-mode>' +
        '<option value="always">每次刷新</option>' +
        '<option value="session">每会话一次</option>' +
        '<option value="daily">每天一次</option>' +
        '</select></label>' +
        '<label>启用<input type="checkbox" data-enabled></label>' +
        '<div class="row"><button type="button" data-replay>重播开场</button>' +
        '<span class="msg" data-msg></span></div>' +
        '<div class="tip">Ctrl+Alt+S 随时开关</div>'

      var selAnim = panel.querySelector('[data-anim]')
      var selMode = panel.querySelector('[data-mode]')
      var chk = panel.querySelector('[data-enabled]')
      var rng = panel.querySelector('[data-speed]')
      var speedv = panel.querySelector('[data-speedv]')
      var msg = panel.querySelector('[data-msg]')

      ;(animations || []).forEach(function (a) {
        var o = document.createElement('option')
        o.value = a.id
        o.textContent = a.title || a.id
        selAnim.appendChild(o)
      })
      selAnim.value = cfg.animation
      selMode.value = cfg.mode
      chk.checked = cfg.enabled !== false
      rng.value = cfg.speed
      speedv.textContent = Number(cfg.speed).toFixed(2) + '×'

      function note(text) {
        msg.textContent = text
        setTimeout(function () {
          if (msg.textContent === text) msg.textContent = ''
        }, 1800)
      }

      selAnim.addEventListener('change', function () {
        saveConfig({ animation: selAnim.value }, function (ok) {
          note(ok ? '已保存' : '保存失败')
        })
      })
      selMode.addEventListener('change', function () {
        saveConfig({ mode: selMode.value }, function (ok) {
          note(ok ? '已保存' : '保存失败')
        })
      })
      chk.addEventListener('change', function () {
        saveConfig({ enabled: chk.checked }, function (ok) {
          note(ok ? '已保存' : '保存失败')
        })
      })
      rng.addEventListener('input', function () {
        speedv.textContent = Number(rng.value).toFixed(2) + '×'
      })
      rng.addEventListener('change', function () {
        saveConfig({ speed: Number(rng.value) }, function (ok) {
          note(ok ? '已保存' : '保存失败')
        })
      })
      panel.querySelector('[data-replay]').addEventListener('click', function () {
        panel.classList.remove('on')
        var api = window.__DSH_STARTUP_KIT__
        if (api && typeof api.replay === 'function') api.replay()
        else note('暂不可重播')
      })
      panel.querySelector('[data-close]').addEventListener('click', function () {
        panel.classList.remove('on')
      })

      /* ── 开合 ────────────────────────────────────────────────────────── */
      var api = {
        open: function () {
          panel.classList.add('on')
        },
        close: function () {
          panel.classList.remove('on')
        },
        toggle: function () {
          panel.classList.toggle('on')
        }
      }

      document.addEventListener('keydown', function (e) {
        if (!(e.ctrlKey || e.metaKey) || !e.altKey) return
        if (e.key !== 's' && e.key !== 'S') return
        e.preventDefault()
        api.toggle()
      })
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && panel.classList.contains('on')) {
          panel.classList.remove('on')
          e.stopPropagation()
        }
      })

      document.body.appendChild(style)
      document.body.appendChild(panel)

      /* ── 可选：常驻悬浮按钮（可拖动，位置会记住） ─────────────────────── */
      if (mode === 'always') {
        var fab = document.createElement('button')
        fab.id = 'dsk-fab'
        fab.type = 'button'
        fab.title = '启动动画（可拖动）'
        fab.textContent = '◆'

        var pos = null
        try {
          pos = JSON.parse(localStorage.getItem('startup-kit:fab') || 'null')
        } catch (e) {
          pos = null
        }
        var left = pos && typeof pos.left === 'number' ? pos.left : 14
        var top = pos && typeof pos.top === 'number' ? pos.top : Math.max(14, window.innerHeight - 44)
        fab.style.left = left + 'px'
        fab.style.top = top + 'px'

        var drag = null

        fab.addEventListener('pointerdown', function (e) {
          drag = {
            px: e.clientX,
            py: e.clientY,
            left: parseFloat(fab.style.left) || 0,
            top: parseFloat(fab.style.top) || 0,
            moved: false
          }
          if (fab.setPointerCapture) fab.setPointerCapture(e.pointerId)
          e.preventDefault()
        })

        window.addEventListener('pointermove', function (e) {
          if (!drag) return
          var dx = e.clientX - drag.px
          var dy = e.clientY - drag.py
          if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return
          drag.moved = true
          var nl = Math.min(Math.max(4, drag.left + dx), window.innerWidth - 34)
          var nt = Math.min(Math.max(4, drag.top + dy), window.innerHeight - 34)
          fab.style.left = nl + 'px'
          fab.style.top = nt + 'px'
        })

        window.addEventListener('pointerup', function () {
          if (!drag) return
          var moved = drag.moved
          drag = null
          if (!moved) {
            api.toggle()
            return
          }
          try {
            localStorage.setItem(
              'startup-kit:fab',
              JSON.stringify({ left: parseFloat(fab.style.left), top: parseFloat(fab.style.top) })
            )
          } catch (e) {
            /* 存不了就算了 */
          }
        })

        document.body.appendChild(fab)
      }

      panelApi = api
      window.__DSH_STARTUP_KIT_PANEL__ = api
      return api
    } catch (e) {
      crumb('panel-error', String((e && e.message) || e))
      return null
    }
  }

  /* ── 插件本体 ────────────────────────────────────────────────────────── */

  if (window.__ModuleLoader__ && typeof window.__ModuleLoader__.load === 'function') {
    window.__ModuleLoader__.load({
      id: 'dsh-startup-kit',
      factory: function (require) {
        var module = { exports: {} }
        var exports = module.exports
        Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

        function loadShell() {
          var s = document.createElement('script')
          s.src = BASE + '/shell.js?t=' + Date.now()
          s.async = true
          s.onerror = function () {
            crumb('client-shell-error', 'script load failed')
            teardown()
          }
          document.head.appendChild(s)
        }

        function bootstrap() {
          ensureRoot()

          var href = ''
          try {
            href = String(window.location && window.location.href ? window.location.href : '').slice(0, 200)
          } catch (e) {
            /* noop */
          }
          crumb('client-boot', href)

          fetch(BASE + '/config', { cache: 'no-store' })
            .then(function (r) {
              return r.json()
            })
            .then(function (data) {
              var cfg = (data && data.config) || {}
              remember(cfg)

              // 面板总是挂上（是否显示常驻按钮由 cfg.panel 决定）：
              // 即使这次不播，用户也要有地方重新打开
              mountPanel(cfg, (data && data.animations) || [])

              if (!cfg.enabled) {
                crumb('client-skip', 'disabled')
                teardown()
                return
              }
              try {
                if (cfg.mode === 'session' && sessionStorage.getItem('startup-kit:shown') === '1') {
                  crumb('client-skip', 'session-shown')
                  teardown()
                  return
                }
                if (cfg.mode === 'daily' && localStorage.getItem('startup-kit:day') === today()) {
                  crumb('client-skip', 'daily-shown')
                  teardown()
                  return
                }
              } catch (e) {
                /* 存储不可用 → 照常播 */
              }

              window.__DSK__ = cfg
              window.__DSK_SKIP__ = false
              window.__DSK_LOADED__ = false
              loadShell()
            })
            .catch(function (err) {
              crumb('client-config-error', String((err && err.message) || err))
              teardown()
            })

          // 壳没能在 10 秒内接管 → 把页面还回去
          setTimeout(function () {
            if (!window.__DSK_LOADED__) {
              crumb('client-watchdog', 'shell never loaded')
              teardown()
            }
          }, 10000)
        }

        function apply(ctx) {
          // 先留一个脚印：能区分"apply 没被调用"和"apply 里某步炸了"
          crumb('apply-enter', '')

          // 宿主已经把黑幕写进 index.html（web 载体）→ 不重复，也不跟我们抢
          if (window.__DSK_BOOT__ === 'index') {
            if (preCovered) teardown()
            return
          }
          if (window.__DSK_BOOT__ === 'client') return
          window.__DSK_BOOT__ = 'client'
          try {
            bootstrap()
          } catch (err) {
            crumb('client-boot-error', String((err && err.message) || err))
            teardown()
          }
        }

        exports.apply = apply
        return module.exports
      }
    })
  }
})()
