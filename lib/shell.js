/* ============================================================================
 * dsh-startup-kit — 启动壳（浏览器端，零依赖）
 * ----------------------------------------------------------------------------
 * 由 Host 注入到 index.html，在 React 挂载之前接管首屏。
 *
 * 分工是这一整套设计的核心：
 *
 *   壳（本文件）负责所有"危险的事"
 *     · 盖住屏幕、锁住滚动
 *     · 提供可被跳过的等待（api.wait）
 *     · 看门狗、异常兜底、收场、解锁、记录"本会话播过了"
 *
 *   动画（lib/animations/*.js）只负责"演"
 *     · 拿到一个 api，往 api.stage 里画东西，await 完就结束
 *     · 它不需要、也不允许自己拆黑幕 —— 收场永远是壳的事
 *
 * 好处：动画作者怎么写都不会把用户锁在黑屏里。写崩了、忘了 return、
 * 死循环 await，看门狗都会把屏幕还回去。
 *
 * 对外接口：
 *   window.__DSH_STARTUP_KIT__ = { skip, stop, replay, config }
 * 事件：
 *   'startup-kit:handoff'  开始淡出（给别的插件做交叉叠化的钩子）
 *   'startup-kit:done'     节点已移除、页面已解锁
 * ========================================================================== */
(function () {
  'use strict'

  if (window.__DSK_LOADED__) return
  window.__DSK_LOADED__ = true

  var BASE = '/startup-kit'
  var ROOT_ID = 'dsk-root'
  var HANDOFF_MS = 780

  function num(value, lo, hi, fallback) {
    var n = Number(value)
    if (!isFinite(n)) return fallback
    return Math.min(hi, Math.max(lo, n))
  }

  function log() {
    try {
      var args = Array.prototype.slice.call(arguments)
      args.unshift('[startup-kit]')
      console.log.apply(console, args)
    } catch {
      /* 日志失败不许影响流程 */
    }
  }

  /**
   * 面包屑：把浏览器这边发生的事回传给宿主，落进 ~/.dsh/startup-kit-browser.log。
   *
   * 为什么需要：启动动画坏掉的时候，用户只看到"没动画"，而 console 在
   * 用户不会打开的地方。把它写进文件，排查就不用靠猜。
   *
   * 为什么用 <img> 而不是 fetch：
   *   img 请求不受 CORS / 预检 / 自定义头限制，也不需要等待响应体，
   *   是浏览器里"能发出去"的最低门槛。fetch + keepalive 在离场时可能被丢弃。
   * 任何失败都吞掉 —— 诊断绝不能成为新的故障点。
   */
  var crumbs = 0
  function breadcrumb(name, extra) {
    try {
      if (crumbs > 80) return
      crumbs++
      var detail = ''
      if (extra !== undefined && extra !== null) {
        try {
          detail = typeof extra === 'string' ? extra : JSON.stringify(extra)
        } catch {
          detail = String(extra)
        }
      }
      var src =
        BASE +
        '/log?e=' +
        encodeURIComponent(name) +
        '&x=' +
        encodeURIComponent(detail.slice(0, 400)) +
        '&t=' +
        Date.now()
      if (typeof Image === 'function') {
        new Image().src = src
        return
      }
      if (typeof fetch === 'function') {
        fetch(src, { keepalive: true }).catch(function () {})
      }
    } catch {
      /* 诊断失败不影响演出 */
    }
  }

  try {
    window.addEventListener('error', function (e) {
      breadcrumb('window-error', (e && e.message) || 'unknown')
    })
  } catch {
    /* noop */
  }

  var C = (function (raw) {
    raw = raw && typeof raw === 'object' ? raw : {}
    return {
      enabled: raw.enabled !== false,
      mode: raw.mode === 'always' || raw.mode === 'daily' ? raw.mode : 'session',
      animation: typeof raw.animation === 'string' && raw.animation ? raw.animation : 'fade',
      speed: num(raw.speed, 0.25, 4, 1),
      allowSkip: raw.allowSkip !== false,
      watchdogMs: num(raw.watchdogMs, 2000, 120000, 15000),
      panel: raw.panel === 'always' || raw.panel === 'never' ? raw.panel : 'boot'
    }
  })(window.__DSK__)

  /* ── 对外 API（先挂上，保证任何阶段都能调用） ─────────────────────────── */
  var PUBLIC = {
    skip: function () {},
    stop: function () {},
    replay: function () {},
    config: C
  }
  window.__DSH_STARTUP_KIT__ = PUBLIC

  /* Host 的内联脚本已经判定"这次不播"（未启用 / 本会话已播 / 今日已播） */
  if (window.__DSK_SKIP__ === true) {
    log('本次跳过（配置或持久化标记）')
    breadcrumb('skip-by-host', { mode: C.mode, enabled: C.enabled })
    return
  }

  /* ── 基础样式（只注入一次；动画自己的样式走 api.addStyle） ───────────── */
  var BASE_CSS = [
    '#dsk-root{position:fixed;inset:0;z-index:2147483000;background:#05060a;',
    'color:#e9edf6;overflow:hidden;-webkit-font-smoothing:antialiased;',
    'font-family:ui-monospace,SFMono-Regular,"Cascadia Mono",Consolas,monospace}',
    '#dsk-root.dsk-handoff{opacity:0;transform:scale(1.035);filter:blur(4px);',
    'transition:opacity .78s cubic-bezier(.4,0,.2,1),transform .78s cubic-bezier(.4,0,.2,1),',
    'filter .78s ease;pointer-events:none}',
    '#dsk-root .dsk-stage{position:absolute;inset:0;display:flex;align-items:center;',
    'justify-content:center;overflow:hidden}',
    '#dsk-root .dsk-bar{position:absolute;left:0;right:0;bottom:0;height:2px;',
    'background:rgba(255,255,255,.07)}',
    '#dsk-root .dsk-bar i{display:block;height:100%;width:0;background:#ff7500;',
    'transition:width .25s linear}',
    '#dsk-root .dsk-skip{position:absolute;right:28px;bottom:64px;padding:6px 12px;',
    'font-family:inherit;font-size:11px;letter-spacing:.18em;text-transform:uppercase;',
    'color:rgba(233,237,246,.45);background:transparent;border:1px solid rgba(233,237,246,.18);',
    'cursor:pointer;transition:color .2s,border-color .2s}',
    '#dsk-root .dsk-skip:hover{color:#e9edf6;border-color:rgba(233,237,246,.5)}',
    '#dsk-root .dsk-skip[hidden]{display:none}',
    // 开场期间的设置入口：放在 SKIP 左边，播完跟黑幕一起消失，不占常驻界面
    '#dsk-root .dsk-gear{right:104px;letter-spacing:0;padding:6px 10px}'
  ].join('')

  var root = document.getElementById(ROOT_ID)
  if (!root) {
    root = document.createElement('div')
    root.id = ROOT_ID
    document.body.appendChild(root)
  }
  root.className = 'dsk-root'
  root.innerHTML = ''

  if (!document.getElementById('dsk-style')) {
    var styleTag = document.createElement('style')
    styleTag.id = 'dsk-style'
    styleTag.textContent = BASE_CSS
    document.head.appendChild(styleTag)
  }

  var stage = document.createElement('div')
  stage.className = 'dsk-stage'
  root.appendChild(stage)

  var bar = document.createElement('div')
  bar.className = 'dsk-bar'
  var barFill = document.createElement('i')
  bar.appendChild(barFill)
  root.appendChild(bar)

  var skipBtn = document.createElement('button')
  skipBtn.type = 'button'
  skipBtn.className = 'dsk-skip'
  skipBtn.textContent = 'skip ▸'
  skipBtn.hidden = !C.allowSkip
  root.appendChild(skipBtn)

  // 开场期间的设置入口。默认不放常驻按钮 —— 角落是侧栏「…」和发送按钮的地盘，
  // 常驻会挡到它们。所以入口只活在这一屏，播完随黑幕一起消失。
  var gearBtn = document.createElement('button')
  gearBtn.type = 'button'
  gearBtn.className = 'dsk-skip dsk-gear'
  gearBtn.textContent = '⚙'
  gearBtn.title = '启动动画设置（Ctrl+Alt+S）'
  gearBtn.hidden = C.panel === 'never'
  gearBtn.addEventListener('click', function (e) {
    e.stopPropagation()
    var api = window.__DSH_STARTUP_KIT_PANEL__
    if (api && typeof api.toggle === 'function') api.toggle()
    else log('设置面板尚未就绪（client 半边可能没加载）')
  })
  root.appendChild(gearBtn)

  breadcrumb('shell-mounted', {
    url: (function () {
      try {
        return location.href.slice(0, 200)
      } catch {
        return '?'
      }
    })(),
    animation: C.animation,
    mode: C.mode,
    speed: C.speed
  })

  /* ── 时间线引擎 ──────────────────────────────────────────────────────── */

  var finished = false
  var skipped = false
  var timers = []
  var waiters = []
  var skipHooks = []
  var releaseGate = null
  var watchdog = null
  /** 当前动画模块与它的 api：收场时用来调可选的 dispose() */
  var currentModule = null
  var currentApi = null

  /**
   * 可被跳过的等待。
   * `skipped` 之后所有新的 wait 立刻 resolve —— 这样动画会顺着自己的
   * 代码一路跑到 return，不需要我们逐个打断。
   */
  function wait(baseMs) {
    return new Promise(function (resolve) {
      if (finished || skipped) return resolve()

      var settled = false
      function done() {
        if (settled) return
        settled = true
        var i = timers.indexOf(timer)
        if (i >= 0) timers.splice(i, 1)
        var j = waiters.indexOf(done)
        if (j >= 0) waiters.splice(j, 1)
        resolve()
      }

      var timer = setTimeout(done, Math.max(0, Math.round(baseMs / C.speed)))
      timers.push(timer)
      waiters.push(done)
    })
  }

  /** 把所有挂起的等待立刻唤醒（跳过 / 收场时用）。 */
  function releaseAll() {
    var list = waiters.slice()
    waiters.length = 0
    for (var i = 0; i < timers.length; i++) clearTimeout(timers[i])
    timers.length = 0
    for (var j = 0; j < list.length; j++) {
      try {
        list[j]()
      } catch {
        /* 单个 waiter 失败不影响其它 */
      }
    }
  }

  function runHooks() {
    var list = skipHooks.slice()
    skipHooks.length = 0
    for (var i = 0; i < list.length; i++) {
      try {
        list[i]()
      } catch (err) {
        log('清理回调抛错', err)
      }
    }
  }

  function setProgress(p) {
    var v = Math.max(0, Math.min(1, Number(p) || 0))
    barFill.style.width = (v * 100).toFixed(1) + '%'
  }

  function unlock() {
    try {
      document.documentElement.classList.remove('dsk-lock')
      document.documentElement.style.overflow = ''
      if (document.body) document.body.style.overflow = ''
    } catch {
      /* noop */
    }
  }

  function persist() {
    try {
      if (C.mode === 'session') sessionStorage.setItem('startup-kit:shown', '1')
      if (C.mode === 'daily') localStorage.setItem('startup-kit:day', new Date().toISOString().slice(0, 10))
    } catch {
      /* 隐私模式不可写，忽略 */
    }
  }

  function teardown() {
    try {
      unlock()
      if (root.parentNode) root.parentNode.removeChild(root)
      window.dispatchEvent(new CustomEvent('startup-kit:done'))
    } catch (err) {
      log('收场清理失败', err)
    }
  }

  /**
   * 收场。幂等，任何路径都可以调。
   * @param {string} reason done | skipped | watchdog | exception | load-error | stopped
   */
  function finish(reason) {
    if (finished) return
    finished = true

    if (watchdog) {
      clearTimeout(watchdog)
      watchdog = null
    }
    releaseAll()
    runHooks()
    persist()
    breadcrumb('finish', reason)

    // 可选的 dispose：动画自己收尾（停 rAF、关 AudioContext 等）
    if (currentModule && typeof currentModule.dispose === 'function') {
      try {
        currentModule.dispose(currentApi)
      } catch (err) {
        log('dispose 抛错（已忽略）：' + ((err && err.message) || err))
      }
    }

    var instant = reason === 'load-error' || reason === 'exception'
    if (instant) {
      log('收场（' + reason + '），直接揭幕')
      teardown()
      return
    }

    // 开始淡出：这个事件是给别的启动插件做交叉叠化用的钩子
    try {
      window.dispatchEvent(new CustomEvent('startup-kit:handoff', { detail: { reason: reason } }))
    } catch {
      /* noop */
    }
    root.classList.add('dsk-handoff')
    setTimeout(teardown, HANDOFF_MS)
  }

  /** 强行终止：不淡出，立刻拆掉（重播时用）。 */
  function abort() {
    if (finished) return
    finished = true
    if (watchdog) {
      clearTimeout(watchdog)
      watchdog = null
    }
    releaseAll()
    runHooks()
    try {
      if (root.parentNode) root.parentNode.removeChild(root)
    } catch {
      /* noop */
    }
  }

  function requestSkip() {
    if (finished || skipped) return
    skipped = true
    log('用户跳过')
    breadcrumb('skip')
    releaseAll()
    runHooks()
    if (typeof releaseGate === 'function') releaseGate()
    else finish('skipped')
  }

  /* ── 装载动画 ────────────────────────────────────────────────────────── */

  function animationUrl(id) {
    return BASE + '/animations/' + encodeURIComponent(id) + '.js'
  }

  function loadAnimation(id) {
    // 测试/嵌入场景可以替换装载器
    var hook = window.__DSK_LOAD__
    if (typeof hook === 'function') return Promise.resolve(hook(id))
    // 重播时加时间戳，绕过模块图缓存，改了动画刷新就能看到
    var suffix = window.__DSK_REPLAY__ ? '?t=' + Date.now() : ''
    return import(animationUrl(id) + suffix)
  }

  function makeApi(meta) {
    var startedAt = Date.now()
    var declared = Number(meta && meta.duration)
    var budget = isFinite(declared) && declared > 0 ? declared : 0

    return {
      root: root,
      stage: stage,
      config: C,
      /** 动画自己声明的元信息（见 lib/animations/_template.js） */
      meta: meta || {},
      /** 自报的时长（ms）；没报就是 0，表示"壳不知道" */
      duration: budget,
      /** 从开场到现在过了多久（ms） */
      elapsed: function () {
        return Date.now() - startedAt
      },
      /** 还剩多少毫秒；没自报时长时返回 Infinity */
      remaining: function () {
        return budget > 0 ? Math.max(0, budget - (Date.now() - startedAt)) : Infinity
      },
      wait: wait,
      frame: function () {
        return wait(16)
      },
      skip: requestSkip,
      onSkip: function (fn) {
        if (typeof fn === 'function') skipHooks.push(fn)
      },
      log: log,
      setProgress: setProgress,
      addStyle: function (css) {
        var el = document.createElement('style')
        el.textContent = css
        root.appendChild(el)
        return function () {
          if (el.parentNode) el.parentNode.removeChild(el)
        }
      },
      isSkipped: function () {
        return skipped || finished
      }
    }
  }

  function boot() {
    var mod = null
    breadcrumb('boot', C.animation)
    return loadAnimation(C.animation)
      .then(function (m) {
        mod = m
        breadcrumb('animation-loaded', C.animation)
      })
      .catch(function (err) {
        var message = err && err.message ? err.message : String(err)
        log('加载动画失败：' + message)
        breadcrumb('animation-load-error', message)
        finish('load-error')
      })
      .then(function () {
        if (!mod || finished) return
        if (typeof mod.run !== 'function') {
          log('动画 ' + C.animation + ' 没有导出 run()，跳过')
          finish('load-error')
          return
        }

        var meta = mod.meta && typeof mod.meta === 'object' ? mod.meta : {}
        var api = makeApi(meta)
        currentModule = mod
        currentApi = api

        // 动画自报时长 → 看门狗据此收紧
        var declared = Number(meta.duration)
        if (isFinite(declared) && declared > 0) {
          var budget = armWatchdog(declared / C.speed + 4000)
          log('动画自报时长 ' + declared + 'ms，看门狗 ' + budget + 'ms')
        }

        var runDone = Promise.resolve()
          // setup 可选：用来建 DOM，不参与计时
          .then(function () {
            return typeof mod.setup === 'function' ? mod.setup(api) : undefined
          })
          .then(function () {
            if (finished || skipped) return undefined
            return mod.run(api)
          })
          .catch(function (err) {
            var message = err && err.message ? err.message : String(err)
            log('动画抛错，立即收场：' + message)
            breadcrumb('animation-threw', message)
            finish('exception')
          })

        // 跳过 / 看门狗可以让 run 之外的路径也结束
        var gate = new Promise(function (resolve) {
          releaseGate = resolve
        })

        return Promise.race([runDone, gate]).then(function () {
          releaseGate = null
          finish(skipped ? 'skipped' : 'done')
        })
      })
  }

  /* ── 重播（预览页与开发用） ───────────────────────────────────────────── */

  function replay() {
    abort()
    var old = document.getElementById(ROOT_ID)
    if (old && old.parentNode) old.parentNode.removeChild(old)
    window.__DSK_LOADED__ = false
    window.__DSK_SKIP__ = false
    window.__DSK_REPLAY__ = true
    var s = document.createElement('script')
    s.src = BASE + '/shell.js?t=' + Date.now()
    document.head.appendChild(s)
  }

  PUBLIC.skip = requestSkip
  PUBLIC.stop = abort
  PUBLIC.replay = replay

  /* ── 跳过入口 ────────────────────────────────────────────────────────── */

  if (C.allowSkip) {
    skipBtn.addEventListener('click', function (e) {
      e.stopPropagation()
      requestSkip()
    })
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') requestSkip()
    })
  }

  /* ── 接管屏幕 ────────────────────────────────────────────────────────── */

  document.documentElement.classList.add('dsk-lock')
  document.documentElement.style.overflow = 'hidden'
  if (document.body) document.body.style.overflow = 'hidden'
  setProgress(0.04)

  // 壳已经跑起来了，内联兜底脚本可以收工了（看门狗由本文件接手）
  root.classList.remove('dsk-boot')

  /**
   * 布防看门狗。
   *
   * 动画可以在 `meta.duration` 里自报时长，壳据此收紧或放宽：
   *   budget = duration / speed + 4s 余量
   * 没自报时用配置里的 watchdogMs。上限 120s，下限 3s。
   */
  function armWatchdog(ms) {
    if (watchdog) {
      clearTimeout(watchdog)
      watchdog = null
    }
    // 下限放宽到 500ms：配置层已经把 watchdogMs 夹在 [2000,120000]，
    // 这里再抬一次会把合法配置改掉（测试里就撞过）。
    var budget = Math.min(120000, Math.max(500, Math.round(ms)))
    watchdog = setTimeout(function () {
      log('看门狗触发（' + budget + 'ms），强制收场')
      finish('watchdog')
    }, budget)
    return budget
  }

  // 先按配置布防，动画自报时长后再收紧/放宽
  armWatchdog(C.watchdogMs)

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      boot()
    })
  } else {
    boot()
  }
})()
