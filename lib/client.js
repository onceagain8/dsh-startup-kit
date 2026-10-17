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
   * 为什么不走 DSH 的原生设置卡片：那条路要求 Host 侧用
   * @deepseek-ai/dsh-settings 注册命名空间、Client 侧用 React 渲染并注册进
   * settings.plugin.item 插槽，而且卡片只有在 Host 服务了该命名空间时才会
   * 被渲染。对一个小插件来说依赖太重，这里改成自带面板，直接读写我们自己的
   * /config —— 零依赖，且"改完立刻生效"。
   *
   * 面板层级故意低于黑幕（2147482900 < 2147483000），开场演出期间不会露出来。 */
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

  function mountPanel(cfg, animations) {
    try {
      if (document.getElementById('dsk-fab')) return

      var style = document.createElement('style')
      style.id = 'dsk-panel-style'
      style.textContent =
        '#dsk-fab{position:fixed;left:14px;bottom:14px;z-index:2147482900;width:30px;height:30px;' +
        'border-radius:50%;border:1px solid rgba(255,255,255,.14);background:rgba(20,24,32,.72);' +
        'color:#9aa6bd;font:13px/1 ui-monospace,monospace;cursor:pointer;opacity:.45;' +
        'transition:opacity .2s,color .2s}' +
        '#dsk-fab:hover{opacity:1;color:#fff}' +
        '#dsk-panel{position:fixed;left:14px;bottom:56px;z-index:2147482900;width:266px;' +
        'padding:14px 16px 16px;border-radius:10px;background:rgba(16,19,26,.97);' +
        'border:1px solid rgba(255,255,255,.1);color:#c9d2e3;' +
        'font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;' +
        'box-shadow:0 12px 40px rgba(0,0,0,.5);display:none}' +
        '#dsk-panel.on{display:block}' +
        '#dsk-panel .h{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;' +
        'color:#fff;letter-spacing:.08em}' +
        '#dsk-panel .h button{background:none;border:0;color:#7d879c;font-size:15px;cursor:pointer}' +
        '#dsk-panel label{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:7px 0;color:#8b97ad}' +
        '#dsk-panel select{font:inherit;background:#151a24;color:#c9d2e3;border:1px solid rgba(255,255,255,.12);' +
        'border-radius:4px;padding:3px 6px;max-width:150px}' +
        '#dsk-panel input[type=range]{width:110px;accent-color:#ff7500}' +
        '#dsk-panel .row{display:flex;align-items:center;gap:10px;margin-top:12px}' +
        '#dsk-panel .row button{font:inherit;background:#1b2130;color:#c9d2e3;border:1px solid rgba(255,255,255,.12);' +
        'border-radius:4px;padding:5px 10px;cursor:pointer}' +
        '#dsk-panel .row button:hover{border-color:rgba(255,117,0,.6);color:#fff}' +
        '#dsk-panel .msg{color:#6ee7a8;font-size:11px}'

      var fab = document.createElement('button')
      fab.id = 'dsk-fab'
      fab.type = 'button'
      fab.title = '启动动画'
      fab.textContent = '◆'

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
        '<span class="msg" data-msg></span></div>'

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
      fab.addEventListener('click', function () {
        panel.classList.toggle('on')
      })

      document.body.appendChild(style)
      document.body.appendChild(fab)
      document.body.appendChild(panel)
    } catch (e) {
      crumb('panel-error', String((e && e.message) || e))
    }
  }

  /* ── 插件本体 ────────────────────────────────────────────────────────── */

  if (window.__ModuleLoader__ && typeof window.__ModuleLoader__.load === 'function') {
    window.__ModuleLoader__.load({
      id: 'dsh-startup-kit',
      factory: function () {
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

              // 面板先挂上：即使这次不播，用户也要有地方重新打开
              if (cfg.panel !== false) mountPanel(cfg, (data && data.animations) || [])

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

        function apply() {
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
