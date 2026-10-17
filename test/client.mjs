/**
 * dsh-startup-kit — 浏览器半边（client bundle）契约测试
 * ----------------------------------------------------------------------------
 * 这一半写错会让 DSH 直接起不来（bundle 注册不上 → entry 激活失败），
 * 所以至少要证明这些：
 *   1. 它是经典脚本，调用 __ModuleLoader__.load 注册了正确的 id
 *   2. 工厂返回的导出里有 apply（Cordis 会拿它当插件）
 *   3. 脚本一执行就铺好黑幕（消闪的关键：不等任何网络往返）
 *   4. 宿主已经注入过时，apply 什么都不做（不重复铺）
 *   5. 配置说不播时会把它拆掉
 *
 * 运行：node test/client.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const SRC = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/* ── 最小 DOM ───────────────────────────────────────────────────────────── */

class El {
  constructor(tag = 'div') {
    this.tagName = tag
    this.children = []
    this.parentNode = null
    this.id = ''
    this.className = ''
    this.textContent = ''
    this.innerHTML = ''
    this.style = { cssText: '' }
    this._classes = new Set()
  }
  get classList() {
    const set = this._classes
    return {
      add: (...n) => n.forEach((x) => set.add(x)),
      remove: (...n) => n.forEach((x) => set.delete(x)),
      contains: (n) => set.has(n)
    }
  }
  appendChild(node) {
    node.parentNode = this
    this.children.push(node)
    return node
  }
  removeChild(node) {
    const i = this.children.indexOf(node)
    if (i >= 0) this.children.splice(i, 1)
    node.parentNode = null
    return node
  }
  querySelector() {
    if (!this._q) this._q = new El()
    return this._q
  }
  addEventListener() {}
  removeEventListener() {}
  setAttribute() {}
}

/**
 * @param config /config 返回的配置
 * @param pre    脚本执行前就挂在 window 上的标记（模拟宿主已注入）
 */
function makeEnv(config, pre = {}) {
  const head = new El('head')
  const body = new El('body')
  const html = new El('html')

  const document = {
    head,
    body,
    documentElement: html,
    createElement: (t) => new El(t),
    addEventListener() {},
    removeEventListener() {},
    getElementById(id) {
      let found = null
      const visit = (n) => {
        if (found) return
        if (n.id === id) found = n
        else n.children.forEach(visit)
      }
      visit(head)
      visit(body)
      return found
    }
  }

  const store = new Map()
  const win = Object.assign(
    {
      location: { href: 'dsh-app://app/' },
      addEventListener() {},
      removeEventListener() {},
      innerWidth: 1280,
      innerHeight: 800,
      __ModuleLoader__: {
        registered: [],
        load(reg) {
          this.registered.push(reg)
        }
      }
    },
    pre
  )
  win.window = win

  const context = vm.createContext({
    window: win,
    document,
    Image: class {
      set src(_v) {}
    },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({ config }) }),
    sessionStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v)
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    // 定时器做成空转：测试不依赖看门狗，也别让 node 挂 10 秒等它
    setTimeout: () => 0,
    clearTimeout: () => {},
    Symbol,
    Object,
    JSON,
    Date,
    String
  })

  new vm.Script(SRC, { filename: 'client.js' }).runInContext(context)
  return { win, document }
}

const has = (env, id) => env.document.getElementById(id) !== null

/* ── 1. 注册契约 ────────────────────────────────────────────────────────── */

{
  const env = makeEnv({ enabled: true })
  const regs = env.win.__ModuleLoader__.registered
  assert.equal(regs.length, 1, '必须只注册一次')
  assert.equal(regs[0].id, 'dsh-startup-kit', 'id 必须等于包名')
  assert.equal(typeof regs[0].factory, 'function', '必须提供 factory')

  const exports = regs[0].factory()
  assert.equal(typeof exports.apply, 'function', '导出里必须有 apply')
  // 不声明任何 inject：设置分区那条线已摘下，插件不依赖任何客户端服务，
  // 这样即使某个服务缺席也不会挡住开场动画
  assert.equal(exports.inject, undefined, '不该声明 inject')
  console.log('ok   1/6  bundle 注册契约正确（id + CJS 工厂 + apply）')
}

/* ── 2. 顶层立刻铺黑幕（不等网络） ─────────────────────────────────────── */

{
  const env = makeEnv({ enabled: true })
  assert.equal(has(env, 'dsk-root'), true, '脚本执行的那一刻黑幕就该在')
  assert.equal(env.document.documentElement.classList.contains('dsk-lock'), true, '同时锁滚动')
  console.log('ok   2/6  顶层已铺好黑幕（消闪关键）')
}

/* ── 3. 宿主注入过 → 顶层不铺，apply 不做事 ────────────────────────────── */

{
  const env = makeEnv({ enabled: true }, { __DSK_BOOT__: 'index' })
  assert.equal(has(env, 'dsk-root'), false, '宿主已接管时不该抢着铺')
  env.win.__ModuleLoader__.registered[0].factory().apply({})
  assert.equal(has(env, 'dsk-root'), false, 'apply 也不该铺')
  console.log('ok   3/6  宿主已注入时幂等')
}

/* ── 4. 自举：黑幕在，apply 后进入取配置流程 ───────────────────────────── */

{
  const env = makeEnv({
    enabled: true,
    mode: 'always',
    animation: 'fade',
    speed: 1,
    allowSkip: true,
    watchdogMs: 15000
  })
  env.win.__ModuleLoader__.registered[0].factory().apply({})
  assert.equal(has(env, 'dsk-root'), true, '自举时黑幕必须在')
  console.log('ok   4/6  自举保持黑幕并进入取配置流程')
}

/* ── 5. 配置说不播 → 拆掉 ─────────────────────────────────────────────── */

{
  const env = makeEnv({ enabled: false })
  env.win.__ModuleLoader__.registered[0].factory().apply({})
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(has(env, 'dsk-root'), false, '不该播时必须把黑幕拆掉，绝不能留黑屏')
  assert.equal(env.document.documentElement.classList.contains('dsk-lock'), false, '也要解锁')
  console.log('ok   5/6  enabled=false 时自动拆掉黑幕')
}

/* ── 6. 入口策略：默认不占常驻界面 ─────────────────────────────────────── */

{
  const base = { enabled: true, mode: 'always', animation: 'fade', speed: 1, watchdogMs: 15000 }

  const boot = makeEnv({ ...base, panel: 'boot' })
  boot.win.__ModuleLoader__.registered[0].factory().apply({})
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(has(boot, 'dsk-panel'), true, '面板本身要挂上（等 ⚙ 或快捷键）')
  assert.equal(has(boot, 'dsk-fab'), false, "'boot' 模式不该出现常驻按钮")

  const always = makeEnv({ ...base, panel: 'always' })
  always.win.__ModuleLoader__.registered[0].factory().apply({})
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(has(always, 'dsk-fab'), true, "'always' 模式才有常驻按钮")

  console.log('ok   6/6  入口策略：默认不占常驻界面')
}

console.log('\n全部通过。')
