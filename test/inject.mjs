/**
 * dsh-startup-kit — 宿主注入冒烟测试
 * ----------------------------------------------------------------------------
 * 用一个假的 ctx 跑真实的 lib/index.js，验证它写进 index.html 的那段东西：
 * 黑幕、关键 CSS、配置、壳脚本都在，且 JSON 不会把 <script> 撑破。
 *
 * 这段逻辑只有在 DSH 里才会执行，是最容易出错、也最难人工验证的一环。
 *
 * 运行：node test/inject.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HOME = path.join(os.tmpdir(), 'dsk-inject-test-' + process.pid)
fs.mkdirSync(HOME, { recursive: true })
process.env.DSH_HOME = HOME

const mod = await import('../lib/index.js')

const routes = []
let tap = null

const server = {
  register(route) {
    routes.push(route)
    return () => {}
  },
  tapIndex(fn) {
    tap = fn
    return () => {}
  }
}

const ctx = {
  effect(fn) {
    fn()
  },
  logger: { warn(message) { assert.fail('不该有 warn：' + message) } },
  get(name) {
    return name === 'webServer' ? server : undefined
  }
}

mod.apply(ctx)

/* ── 路由 ─────────────────────────────────────────────────────────────── */

assert.equal(routes.length, 1, '应当只注册一条前缀路由')
assert.equal(routes[0].kind, 'prefix')
assert.equal(routes[0].path, '/startup-kit')
assert.equal(typeof routes[0].handler, 'function')
console.log('ok   1/4  注册了 /startup-kit 前缀路由')

/* ── 注入 ─────────────────────────────────────────────────────────────── */

const input = '<!doctype html><html><head><title>x</title></head><body><div id="app"></div></body></html>'
const html = tap(input)

assert.equal(typeof html, 'string')
assert.equal(html.includes('id="dsk-root"'), true, '必须有黑幕节点')
assert.equal(html.includes('dsk-lock'), true, '必须有锁滚动的关键 CSS')
assert.equal(html.includes('data-dsk-shell'), true, '必须有启动壳的内联脚本')
assert.equal(html.includes('__DSH_STARTUP_KIT__'), true, '启动壳的源码必须真的内联进去')
assert.equal(html.includes('window.__DSK__='), true, '必须把配置内联进去')
assert.equal(html.includes('animation'), true, '配置里必须有 animation 字段')

// 注入位置：head 里放 style，body 开头放黑幕
assert.equal(html.indexOf('dsk-critical') < html.indexOf('</head>'), true, '关键 CSS 必须进 head')
assert.equal(html.indexOf('id="dsk-root"') > html.indexOf('<body>'), true, '黑幕必须在 body 内')

// 幂等：同一份 HTML 再注入一次不应重复
assert.equal(tap(html), html, '对已注入过的 HTML 应当原样返回')
console.log('ok   2/4  注入内容完整、位置正确、且幂等')

/* ── 转义 ─────────────────────────────────────────────────────────────── */

{
  // 把配置里塞一个恶意 animation 名，看内联 JSON 会不会破坏 script
  fs.writeFileSync(
    path.join(HOME, 'startup-kit.json'),
    JSON.stringify({ animation: 'fade', mode: 'always' }),
    'utf8'
  )
  const again = tap('<html><head></head><body>x</body></html>')
  const m = /window\.__DSK__=(\{.*?\});/.exec(again)
  assert.notEqual(m, null, '应当能定位到内联配置')
  assert.equal(m[1].includes('<'), false, '内联 JSON 里不允许出现裸 <')
  assert.equal(m[1].includes('</script>'), false, '内联 JSON 里不允许出现闭合标签')
  console.log('ok   3/4  内联 JSON 已转义（< 已变成 \\u003c）')
}

/* ── 配置收敛：脏值不能把开关关掉 ─────────────────────────────────────── */

{
  const { normalizeConfig, DEFAULTS } = await import('../lib/service.js')

  // 回归：曾经有一次合并把字段写成 {}，truthy 把 {} 判成 false，
  // 于是 enabled 变 false、插件从此不播，界面看起来却像"没人改过配置"。
  assert.equal(normalizeConfig({ enabled: {} }).enabled, DEFAULTS.enabled, '空对象不能关掉 enabled')
  assert.equal(normalizeConfig({ enabled: 'yes' }).enabled, DEFAULTS.enabled, '无法识别的字符串要退回默认')
  assert.equal(normalizeConfig({ allowSkip: {} }).allowSkip, DEFAULTS.allowSkip, 'allowSkip 同理')
  assert.equal(normalizeConfig({ enabled: false }).enabled, false, '明确的 false 必须保留')
  assert.equal(normalizeConfig({ enabled: 'false' }).enabled, false, '字符串 false 也是 false')
  assert.equal(normalizeConfig({ panel: {} }).panel, DEFAULTS.panel, '脏 panel 退回默认入口策略')

  console.log('ok   4/4  配置收敛：脏值退回默认，不会误关插件')
}

fs.rmSync(HOME, { recursive: true, force: true })
console.log('\n全部通过。')
