/**
 * dsh-startup-kit — 与载体无关的 HTTP 服务
 * ----------------------------------------------------------------------------
 * 同一个 `handle(req, res)` 被两个载体复用：
 *
 *   · lib/index.js  装在 DSH 里时，注册成 /startup-kit 前缀路由
 *   · tools/preview.mjs  不装 DSH 也能跑：node tools/preview.mjs
 *
 * 之所以拆出来，是因为"路由逻辑"必须只有一份——否则预览看到的和真实启动
 * 看到的会是两套行为，那预览就没意义了。
 *
 * 这里只管四件事：配置读写、动画清单、静态文件、预览页。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createLogger } from './logger.js'

export const BASE = '/startup-kit'

/** 默认配置。字段与 lib/shell.js 的 C 一一对应。 */
export const DEFAULTS = {
  enabled: true,
  /** 播放策略：always 每次刷新都播 / session 本会话一次 / daily 每天一次 */
  mode: 'session',
  /** 用哪支动画（lib/animations/ 里的文件名，不含 .js） */
  animation: 'fade',
  /** 全局速度倍率，只影响 api.wait() 的时长 */
  speed: 1,
  /** 是否允许 Esc / 跳过按钮提前收场 */
  allowSkip: true,
  /** 看门狗：超过这个时间还没收场就强制收场，绝不留黑屏 */
  watchdogMs: 15000,
  /** 详细日志：打开后连每个请求都记（排查时用，平时关掉免得刷屏） */
  debug: false,
  /** 左下角悬浮设置面板：不想要 UI 就关掉 */
  panel: true
}

const MODES = ['always', 'session', 'daily']

function clamp(value, lo, hi, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, n))
}

function truthy(value, fallback) {
  if (value === undefined || value === null) return fallback
  return value === true || value === 'true' || value === 1 || value === '1'
}

/** 把任意输入收敛成一个合法配置。读文件和写文件都过这一层。 */
export function normalizeConfig(input) {
  const src = input && typeof input === 'object' ? input : {}
  const out = { ...DEFAULTS }

  out.enabled = truthy(src.enabled, DEFAULTS.enabled)
  out.allowSkip = truthy(src.allowSkip, DEFAULTS.allowSkip)
  out.debug = truthy(src.debug, DEFAULTS.debug)
  out.panel = truthy(src.panel, DEFAULTS.panel)
  if (MODES.includes(src.mode)) out.mode = src.mode
  if (typeof src.animation === 'string' && /^[a-z0-9][a-z0-9._-]*$/i.test(src.animation)) {
    out.animation = src.animation
  }
  out.speed = clamp(src.speed, 0.25, 4, DEFAULTS.speed)
  out.watchdogMs = clamp(src.watchdogMs, 2000, 120000, DEFAULTS.watchdogMs)

  return out
}

const MIME = {
  '.js': 'application/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
}

/**
 * @param {object} options
 * @param {string} options.libDir  本包的 lib 目录（放 shell.js / preview.html / animations）
 * @param {string} options.homeDir 配置目录（通常是 ~/.dsh）
 */
export function createStartupKit({ libDir, homeDir }) {
  const animDir = path.join(libDir, 'animations')
  const configFile = path.join(homeDir, 'startup-kit.json')
  const logFile = path.join(homeDir, 'startup-kit.log')
  const browserLogFile = path.join(homeDir, 'startup-kit-browser.log')
  const indexDumpFile = path.join(homeDir, 'startup-kit-index.html')

  const log = createLogger(logFile)
  const browserLog = createLogger(browserLogFile)

  /**
   * 详细日志。只有配置里 debug=true 才写 —— 平时每个请求都记一条会把
   * 真正有用的信息淹掉。
   */
  function debug(...args) {
    try {
      if (!readConfig().debug) return
    } catch {
      return
    }
    log(...args)
  }

  /**
   * 把注入后的 index.html 原样落盘。
   * 这是判断"宿主到底有没有改写页面"最直接的证据 —— 不用 HTTP、不用 devtools。
   */
  function dumpIndex(html) {
    try {
      fs.mkdirSync(homeDir, { recursive: true })
      fs.writeFileSync(indexDumpFile, html, 'utf8')
    } catch {
      /* 落不了盘就算了 */
    }
  }

  /* ── 配置 ───────────────────────────────────────────────────────────── */

  function readConfig() {
    try {
      // 去掉 BOM：带 BOM 的 JSON.parse 会静默失败并回落默认值（这个坑很贵）
      const raw = fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, '')
      return normalizeConfig(JSON.parse(raw))
    } catch {
      return { ...DEFAULTS }
    }
  }

  function writeConfig(patch) {
    const next = normalizeConfig({ ...readConfig(), ...(patch || {}) })
    fs.mkdirSync(path.dirname(configFile), { recursive: true })
    const tmp = configFile + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8')
    fs.renameSync(tmp, configFile)
    return next
  }

  /* ── 动画清单 ────────────────────────────────────────────────────────── */

  /** 动画标题从文件头部的 `@title xxx` 注释里读；读不到就用文件名。 */
  function titleOf(file) {
    try {
      const head = fs.readFileSync(file, 'utf8').slice(0, 800)
      const m = /@title\s+(.+)/.exec(head)
      if (m) return m[1].trim()
    } catch {
      /* 读不到就算了 */
    }
    return path.basename(file, '.js')
  }

  function listAnimations() {
    let names = []
    try {
      names = fs.readdirSync(animDir)
    } catch {
      return []
    }
    const out = []
    for (const name of names) {
      // 下划线开头 = 模板/草稿，不进列表（但仍然可以被直接 import 调试）
      if (name.startsWith('_')) continue
      if (!/^[a-z0-9][a-z0-9._-]*\.js$/i.test(name)) continue
      const file = path.join(animDir, name)
      out.push({ id: name.slice(0, -3), title: titleOf(file) })
    }
    out.sort((a, b) => a.id.localeCompare(b.id))
    return out
  }

  /** 把 id 解析成文件路径。id 只允许安全字符，杜绝目录穿越。 */
  function animationPath(id) {
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(id)) return null
    if (id.startsWith('_')) return null
    const file = path.join(animDir, id + '.js')
    if (!fs.existsSync(file)) return null
    return file
  }

  /* ── 响应工具 ────────────────────────────────────────────────────────── */

  function sendJson(res, code, data) {
    const body = Buffer.from(JSON.stringify(data), 'utf8')
    res.writeHead(code, {
      'content-type': MIME['.json'],
      'cache-control': 'no-store',
      'content-length': body.length
    })
    res.end(body)
  }

  function sendText(res, code, type, text) {
    const body = Buffer.from(text, 'utf8')
    res.writeHead(code, {
      'content-type': type,
      'cache-control': 'no-store',
      'content-length': body.length
    })
    res.end(body)
  }

  function sendFile(res, file) {
    try {
      const text = fs.readFileSync(file, 'utf8')
      sendText(res, 200, MIME[path.extname(file)] || 'text/plain; charset=utf-8', text)
    } catch {
      sendText(res, 500, 'text/plain; charset=utf-8', 'read error')
    }
  }

  function readBody(req, limit = 64 * 1024) {
    return new Promise((resolve) => {
      let size = 0
      const chunks = []
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > limit) {
          req.destroy()
          resolve('')
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', () => resolve(''))
    })
  }

  /* ── 路由 ────────────────────────────────────────────────────────────── */

  /**
   * 处理一个请求。
   * @returns {Promise<boolean>} true = 已处理；false = 不归我管（调用方自行 404）
   */
  async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://localhost')
    const p = url.pathname

    if (p !== BASE && !p.startsWith(BASE + '/')) return false

    // 每个请求都留痕（只在 debug 时）：能一眼看出浏览器到底有没有来取东西
    debug('req', (req.method || 'GET').toUpperCase(), p)

    // 浏览器半边的面包屑。
    // 支持两种投递：POST JSON（信息全）、GET 查询串（<img> 通道，最不容易被拦）。
    if (p === BASE + '/log') {
      const method = (req.method || 'GET').toUpperCase()
      if (method === 'GET') {
        browserLog(url.searchParams.get('e') || '?', url.searchParams.get('x') || '')
        // 必须回一个合法的图片响应，否则 <img> 会当失败
        res.writeHead(200, { 'content-type': 'image/gif', 'cache-control': 'no-store' })
        res.end(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'))
        return true
      }
      const body = await readBody(req)
      try {
        const parsed = JSON.parse(body)
        browserLog(parsed.name || '?', parsed.extra === undefined ? '' : parsed.extra)
      } catch {
        browserLog('raw', body.slice(0, 500))
      }
      sendJson(res, 200, { ok: true })
      return true
    }

    // /startup-kit  /startup-kit/  /startup-kit/preview  → 预览页
    if (p === BASE || p === BASE + '/' || p === BASE + '/preview') {
      sendFile(res, path.join(libDir, 'preview.html'))
      return true
    }

    // 启动壳
    if (p === BASE + '/shell.js') {
      sendFile(res, path.join(libDir, 'shell.js'))
      return true
    }

    // 动画清单
    if (p === BASE + '/animations') {
      const cfg = readConfig()
      sendJson(res, 200, {
        ok: true,
        current: cfg.animation,
        animations: listAnimations()
      })
      return true
    }

    // 单支动画
    const m = /^\/startup-kit\/animations\/([a-z0-9][a-z0-9._-]*)\.js$/i.exec(p)
    if (m) {
      const file = animationPath(m[1])
      if (!file) {
        sendJson(res, 404, { ok: false, error: 'unknown animation: ' + m[1] })
        return true
      }
      sendFile(res, file)
      return true
    }

    // 配置读写
    if (p === BASE + '/config') {
      const method = (req.method || 'GET').toUpperCase()

      if (method === 'GET') {
        sendJson(res, 200, {
          ok: true,
          config: readConfig(),
          defaults: DEFAULTS,
          file: configFile.replace(/\\/g, '/'),
          animations: listAnimations()
        })
        return true
      }

      if (method === 'POST') {
        const text = await readBody(req)
        let patch = {}
        try {
          patch = text ? JSON.parse(text) : {}
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid json' })
          return true
        }
        if (patch && patch.action === 'reset') {
          sendJson(res, 200, { ok: true, config: writeConfig(DEFAULTS) })
          return true
        }
        sendJson(res, 200, { ok: true, config: writeConfig(patch) })
        return true
      }

      sendJson(res, 405, { ok: false, error: 'method not allowed' })
      return true
    }

    sendJson(res, 404, { ok: false, error: 'not found' })
    return true
  }

  return {
    handle,
    readConfig,
    writeConfig,
    listAnimations,
    animationPath,
    configFile,
    animDir,
    log,
    debug,
    dumpIndex,
    logFile,
    browserLogFile,
    indexDumpFile
  }
}
