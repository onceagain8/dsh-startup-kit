/**
 * dsh-startup-kit — Host 半边
 * ----------------------------------------------------------------------------
 * 只做三件事：
 *   1. 改写 index.html：把黑幕、关键 CSS、配置、启动壳一起塞进去
 *   2. 注册 /startup-kit 前缀路由（壳、动画清单、各支动画、配置、预览页）
 *   3. 把配置持久化到 $DSH_HOME/startup-kit.json
 *
 * 为什么必须在 Host 侧注入、而不是等浏览器插件系统起来再建 DOM：
 *   client 半边的插件要等 __DSH_BOOT__ 拉完、模块执行完才跑，那时 React 已经
 *   渲染出界面了 —— 用户会先看到一瞬白屏/界面，然后被黑幕盖住。
 *   把黑幕写进 index.html，浏览器拿到的第一帧就是黑的，没有那个窗口期。
 *
 * 这一半刻意"绝不抛异常"：启动动画坏了最多是没有动画，绝不能拖垮 DSH 启动。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASE, DEFAULTS, createStartupKit } from './service.js'

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url))
const HOME_DIR = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')

export const name = 'startup-kit'
export const inject = ['webServer']

/**
 * 关键 CSS：只有两条，但这就是"不白闪"的全部秘密。
 * 黑底 + 最高层级，由 HTML 本身携带，早于任何 JS 执行。
 */
const CRITICAL_CSS = [
  'html.dsk-lock,html.dsk-lock body{overflow:hidden!important}',
  '#dsk-root.dsk-boot{position:fixed;inset:0;z-index:2147483000;background:#05060a}'
].join('')

/**
 * 内联引导脚本。它在 React 之前跑，职责只有两个：
 *   · 决定"这次到底播不播"（不播就把黑幕删掉，连闪一下都不留）
 *   · 万一 shell.js 根本没加载成功（404 / 语法错 / 被拦），超时后强行放行
 */
const BOOTSTRAP = `(function(){try{
window.__DSK_BOOT__='index';
var c=window.__DSK__||{};
var root=document.getElementById('dsk-root');
var off=!c.enabled;
if(!off&&c.mode==='session'&&sessionStorage.getItem('startup-kit:shown')==='1')off=true;
if(!off&&c.mode==='daily'&&localStorage.getItem('startup-kit:day')===new Date().toISOString().slice(0,10))off=true;
if(off){window.__DSK_SKIP__=true;if(root&&root.parentNode)root.parentNode.removeChild(root);return}
document.documentElement.classList.add('dsk-lock');
setTimeout(function(){try{
var r=document.getElementById('dsk-root');
if(r&&r.className&&r.className.indexOf('dsk-boot')!==-1){
if(r.parentNode)r.parentNode.removeChild(r);
document.documentElement.classList.remove('dsk-lock');
if(document.body)document.body.style.overflow='';
window.__DSK_FAILED__=true;
}}catch(e){}}, (Number(c.watchdogMs)>0?Number(c.watchdogMs):15000));
}catch(e){}})()`

/** 内联 JSON 里绝不能出现 `</script>`。 */
function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '')
}

/** 取 webServer 服务；桌面端若走 file:// + IPC 下发前端，这里可能拿不到。 */
function resolveWebServer(ctx) {
  try {
    if (typeof ctx.get === 'function') {
      const viaGet = ctx.get('webServer')
      if (viaGet) return viaGet
    }
  } catch {
    /* 取不到就当没有 */
  }
  return ctx.webServer
}

function usable(server) {
  return !!server && typeof server.register === 'function' && typeof server.tapIndex === 'function'
}

/** 浏览器信任栅栏：自定义路由必须过一遍，否则局域网里任何页面都能读写配置。 */
function makeGuard(ctx) {
  return function rejected(req, res) {
    try {
      const conn = typeof ctx.get === 'function' ? ctx.get('connection') : undefined
      const c = conn || ctx.connection
      if (!c || typeof c.requestRejection !== 'function') return false
      const code = c.requestRejection(req)
      if (code === undefined || code === null || code === false) return false
      res.statusCode = typeof code === 'number' ? code : 403
      res.end()
      return true
    } catch {
      return false
    }
  }
}

export function apply(ctx) {
  const kit = createStartupKit({ libDir: LIB_DIR, homeDir: HOME_DIR })
  const webServer = resolveWebServer(ctx)

  if (!usable(webServer)) {
    try {
      ctx.logger?.warn?.(
        '[startup-kit] 当前 profile 没有可用的 webServer，宿主侧跳过注入；' +
          '启动界面需要 HTTP 载体才能工作，本插件本次不生效。'
      )
    } catch {
      /* 日志失败不影响启动 */
    }
    return
  }

  const guard = makeGuard(ctx)

  /**
   * 哪些请求需要过信任栅栏。
   *
   * 原来的做法是"一律先过栅栏"，这在桌面端会要命：`<script src>` 这类请求
   * 带不了自定义头，栅栏一要求凭据，浏览器加载 shell.js / 动画模块就必然被拒，
   * 界面永远起不来。而且被拒的请求连日志都不留（栅栏在 handle 之前），
   * 排查时看起来像"浏览器根本没来取"。
   *
   * 现在的原则：**只读的东西不设栅栏，只有写操作设**。
   * 跨站页面就算能 GET 到，也读不到响应（没有 CORS 头）。
   */
  function needsGuard(req, pathname) {
    if (pathname === BASE + '/log') return false // 面包屑：写文件，但内容无害
    const method = (req.method || 'GET').toUpperCase()
    return method !== 'GET' && method !== 'HEAD'
  }

  // 一条前缀路由覆盖全部端点：/startup-kit/*
  ctx.effect(() =>
    webServer.register({
      kind: 'prefix',
      path: BASE,
      handler: async (req, res) => {
        // 先留痕，再过栅栏：这样"被拒"和"没来过"才分得清（debug 时才写）
        kit.debug('route-hit', (req.method || 'GET').toUpperCase(), req.url)

        let pathname = BASE
        try {
          pathname = new URL(req.url || '/', 'http://localhost').pathname
        } catch {
          /* 解析不了就按根处理 */
        }

        if (needsGuard(req, pathname) && guard(req, res)) {
          kit.log('guard-rejected', req.url)
          return
        }
        try {
          const handled = await kit.handle(req, res)
          if (!handled) {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('not found')
          }
        } catch (err) {
          try {
            res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('startup-kit error')
          } catch {
            /* 响应已经发出去就算了 */
          }
          try {
            ctx.logger?.warn?.('[startup-kit] 请求处理失败：' + (err && err.message))
          } catch {
            /* noop */
          }
        }
      }
    })
  )

  // 改写 index.html
  ctx.effect(() =>
    webServer.tapIndex((html) => {
      if (typeof html !== 'string') {
        kit.log('tapIndex: 传入的不是字符串，跳过', typeof html)
        return html
      }
      if (html.includes('data-dsk-shell')) {
        kit.log('tapIndex: 已经注入过，跳过', { bytes: html.length })
        return html
      }

      const cfg = kit.readConfig()
      const head = '<style id="dsk-critical">' + CRITICAL_CSS + '</style>'

      /*
       * 壳**内联**，不走 <script src>。
       *
       * 原因：外链脚本要过一层 HTTP 路由，而桌面端的请求可能被信任栅栏、
       * CSP、或代理拦下来 —— 一旦被拦，页面就完全没有启动壳，症状是"什么都没发生"，
       * 而且几乎无法从外部判断。
       * 页面本身就在用内联脚本（__DSH_CONTACT_CONFIG__、ModuleLoader），
       * 所以内联一定能执行。
       */
      let shell = ''
      try {
        shell = fs.readFileSync(path.join(LIB_DIR, 'shell.js'), 'utf8')
      } catch (err) {
        kit.log('读取 shell.js 失败', String(err && err.message))
      }
      // 内联脚本里绝不能出现 </script>
      shell = shell.replace(/<\/script/gi, '<\\/script')

      const body =
        '<div id="dsk-root" class="dsk-root dsk-boot"></div>' +
        '<script>window.__DSK__=' +
        safeJson(cfg) +
        ';' +
        BOOTSTRAP +
        '</script>' +
        (shell
          ? '<script data-dsk-shell>' + shell + '</script>'
          : '<script defer src="' + BASE + '/shell.js"></script>')

      let out = html
      if (out.includes('</head>')) out = out.replace('</head>', head + '</head>')
      else out = head + out

      if (out.includes('<body>')) out = out.replace('<body>', '<body>' + body)
      else if (out.includes('</body>')) out = out.replace('</body>', body + '</body>')
      else out = out + body

      // 落盘 + 记账：出问题时能直接看到浏览器收到了什么
      kit.dumpIndex(out)
      kit.log('tapIndex: 已注入', {
        inBytes: html.length,
        outBytes: out.length,
        shellInlined: !!shell,
        hasBodyTag: html.includes('<body>'),
        hasHeadTag: html.includes('</head>'),
        animation: cfg.animation,
        enabled: cfg.enabled,
        mode: cfg.mode
      })

      return out
    })
  )

  const cfg = kit.readConfig()
  kit.log('apply 完成', {
    webServer: !!webServer,
    prefix: BASE,
    animation: cfg.animation,
    mode: cfg.mode,
    enabled: cfg.enabled
  })
  console.log(
    `[startup-kit] host ready · animation=${cfg.animation} · mode=${cfg.mode} · config=${kit.configFile}`
  )
}

export { DEFAULTS }
