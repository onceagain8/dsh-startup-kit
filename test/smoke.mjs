/**
 * dsh-startup-kit — 启动壳冒烟测试
 * ----------------------------------------------------------------------------
 * 不开浏览器、不装 DSH，用 node:vm + 一个最小 DOM 桩跑真实的 lib/shell.js。
 *
 * 验的是壳的三条承诺（也是这套设计存在的理由）：
 *   1. 正常演完 → 淡出 → 移除节点 → 解锁滚动
 *   2. 动画抛异常 → 立即揭幕，不淡出、不锁屏
 *   3. 跳过 / 看门狗 → 一定能收场
 *
 * 运行：node test/smoke.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const SRC = readFileSync(new URL('../lib/shell.js', import.meta.url), 'utf8')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* ── 最小 DOM 桩 ────────────────────────────────────────────────────────── */

class ClassList {
  constructor() {
    this.set = new Set()
  }
  add(...names) {
    names.forEach((n) => this.set.add(n))
  }
  remove(...names) {
    names.forEach((n) => this.set.delete(n))
  }
  contains(name) {
    return this.set.has(name)
  }
  toggle(name, force) {
    if (force === undefined) {
      if (this.set.has(name)) this.set.delete(name)
      else this.set.add(name)
      return
    }
    if (force) this.set.add(name)
    else this.set.delete(name)
  }
  toString() {
    return [...this.set].join(' ')
  }
}

class El {
  constructor(tag = 'div') {
    this.tagName = tag
    this.children = []
    this.parentNode = null
    this._id = ''
    this._classes = new ClassList()
    this.style = {}
    this.textContent = ''
    this.innerHTML = ''
    this.hidden = false
    this.attrs = {}
  }
  get id() {
    return this._id
  }
  set id(value) {
    this._id = value
  }
  get className() {
    return this._classes.toString()
  }
  set className(value) {
    this._classes = new ClassList()
    String(value)
      .split(/\s+/)
      .filter(Boolean)
      .forEach((c) => this._classes.add(c))
  }
  get classList() {
    return this._classes
  }
  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node)
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
  addEventListener() {}
  removeEventListener() {}
  setAttribute(key, value) {
    this.attrs[key] = value
  }
  get offsetWidth() {
    return 100
  }
}

class CustomEvent {
  constructor(type, init) {
    this.type = type
    this.detail = init && init.detail
  }
}

function makeStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  }
}

function makeEnv(config, modules) {
  const html = new El('html')
  const head = new El('head')
  const body = new El('body')

  const document = {
    readyState: 'complete',
    documentElement: html,
    head,
    body,
    createElement: (tag) => new El(tag),
    createElementNS: (_ns, tag) => new El(tag),
    addEventListener() {},
    removeEventListener() {},
    getElementById(id) {
      let found = null
      const visit = (node) => {
        if (found) return
        if (node.id === id) {
          found = node
          return
        }
        node.children.forEach(visit)
      }
      visit(head)
      visit(body)
      return found
    }
  }

  const win = {
    events: [],
    dispatchEvent(event) {
      this.events.push(event)
      return true
    },
    __DSK__: config,
    __DSK_LOAD__: (id) => {
      const mod = modules[id]
      if (!mod) throw new Error('no such animation: ' + id)
      return mod
    }
  }
  win.window = win

  const context = vm.createContext({
    window: win,
    document,
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    sessionStorage: makeStorage(),
    localStorage: makeStorage(),
    CustomEvent
  })

  new vm.Script(SRC, { filename: 'shell.js' }).runInContext(context)

  return { window: win, document, context }
}

const has = (env, type) => env.window.events.some((e) => e.type === type)
const locked = (env) => env.document.documentElement.classList.contains('dsk-lock')
const rootGone = (env) => env.document.getElementById('dsk-root') === null

/* ── 1. 正常演完 → 收场 ─────────────────────────────────────────────────── */

{
  const env = makeEnv({ animation: 'ok', mode: 'always', speed: 1, allowSkip: true, watchdogMs: 20000 }, {
    ok: { run: async (api) => { await api.wait(20) } }
  })

  assert.equal(locked(env), true, '演出期间必须锁住滚动')
  assert.notEqual(env.document.getElementById('dsk-root'), null, '演出期间必须有黑幕')

  await sleep(1000) // 演出 + 780ms 淡出

  assert.equal(rootGone(env), true, '收场后节点必须移除')
  assert.equal(locked(env), false, '收场后必须解锁滚动')
  assert.equal(has(env, 'startup-kit:handoff'), true, '必须发 handoff 事件')
  assert.equal(has(env, 'startup-kit:done'), true, '必须发 done 事件')
  console.log('ok   1/4  正常收场：淡出 → 移除 → 解锁')
}

/* ── 2. 动画抛错 → 立即揭幕（不淡出） ───────────────────────────────────── */

{
  const env = makeEnv({ animation: 'bad', mode: 'always', speed: 1, allowSkip: true, watchdogMs: 20000 }, {
    bad: { run: async () => { throw new Error('boom') } }
  })

  await sleep(150)

  assert.equal(rootGone(env), true, '抛错后必须立刻拆掉黑幕')
  assert.equal(locked(env), false, '抛错后必须解锁')
  assert.equal(has(env, 'startup-kit:done'), true, '抛错也要发 done')
  assert.equal(has(env, 'startup-kit:handoff'), false, '抛错走瞬拆，不该有淡出')
  console.log('ok   2/4  动画抛错：立即揭幕，绝不留黑屏')
}

/* ── 3. 跳过 → 不卡在长等待上 ───────────────────────────────────────────── */

{
  const env = makeEnv({ animation: 'slow', mode: 'always', speed: 1, allowSkip: true, watchdogMs: 20000 }, {
    slow: { run: async (api) => { await api.wait(5000) } }
  })

  await sleep(40)
  env.window.__DSH_STARTUP_KIT__.skip()
  await sleep(900)

  assert.equal(rootGone(env), true, '跳过后 5 秒的等待必须被释放')
  assert.equal(locked(env), false, '跳过后必须解锁')
  assert.equal(has(env, 'startup-kit:done'), true, '跳过后必须发 done')
  console.log('ok   3/4  跳过：长等待被释放，不必等它自己走完')
}

/* ── 4. 看门狗 → 动画永不返回也能收场 ──────────────────────────────────── */

{
  const env = makeEnv({ animation: 'hang', mode: 'always', speed: 1, allowSkip: true, watchdogMs: 2000 }, {
    hang: { run: () => new Promise(() => {}) }
  })

  await sleep(3100) // 看门狗 2000 + 淡出 780

  assert.equal(rootGone(env), true, '看门狗必须能拆掉卡死的黑幕')
  assert.equal(locked(env), false, '看门狗收场后必须解锁')
  assert.equal(has(env, 'startup-kit:done'), true, '看门狗收场也要发 done')
  console.log('ok   4/4  看门狗：动画永不 resolve 也能收场')
}

console.log('\n全部通过。')
