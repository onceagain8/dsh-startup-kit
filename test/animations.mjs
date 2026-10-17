/**
 * dsh-startup-kit — 动画契约测试
 * ----------------------------------------------------------------------------
 * 每支动画都是一个独立模块，最容易出错的地方是"元信息两处不一致"：
 * 文件头注释（清单读它）和模块里的 meta（壳读它）写岔了，
 * 表现为列表里显示 4.2s、实际看门狗按 2s 算。
 *
 * 所以这里逐支校验：
 *   1. 导出 run()
 *   2. 导出 meta，且 id 与文件名一致
 *   3. meta.duration 是正数，complexity 是已知值
 *   4. 文件头注释里的 @title/@duration/@complexity 与 meta 一致
 *
 * 运行：node test/animations.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'animations')
const COMPLEXITY = ['simple', 'medium', 'heavy']

function headerOf(src) {
  const head = src.slice(0, 1200)
  const pick = (tag) => {
    const m = new RegExp('@' + tag + '\\s+(.+)').exec(head)
    return m ? m[1].trim() : ''
  }
  return {
    title: pick('title'),
    duration: Number(pick('duration')) || 0,
    complexity: pick('complexity')
  }
}

const files = fs
  .readdirSync(DIR)
  .filter((n) => /^[a-z0-9][a-z0-9._-]*\.js$/i.test(n) && !n.startsWith('_'))
  .sort()

assert.ok(files.length >= 3, '至少要有 3 支动画，当前 ' + files.length)

let index = 0
for (const name of files) {
  index += 1
  const id = name.slice(0, -3)
  const full = path.join(DIR, name)
  const src = fs.readFileSync(full, 'utf8')
  const header = headerOf(src)
  const mod = await import(pathToFileURL(full).href)

  assert.equal(typeof mod.run, 'function', name + ' 必须导出 run()')
  assert.equal(typeof mod.meta, 'object', name + ' 必须导出 meta')
  assert.equal(mod.meta.id, id, name + ' 的 meta.id 必须等于文件名')
  assert.ok(mod.meta.title, name + ' 的 meta.title 不能为空')
  assert.ok(
    Number.isFinite(mod.meta.duration) && mod.meta.duration > 0,
    name + ' 的 meta.duration 必须是正数'
  )
  assert.ok(COMPLEXITY.includes(mod.meta.complexity), name + ' 的 complexity 取值非法')

  // 两处元信息必须一致：注释供清单读取，meta 供壳读取
  assert.equal(header.duration, mod.meta.duration, name + ' 的 @duration 与 meta.duration 不一致')
  assert.equal(header.complexity, mod.meta.complexity, name + ' 的 @complexity 与 meta.complexity 不一致')
  assert.equal(header.title, mod.meta.title, name + ' 的 @title 与 meta.title 不一致')

  // 生命周期钩子是可选的，但给了就得是函数
  for (const hook of ['setup', 'dispose']) {
    if (mod[hook] !== undefined) {
      assert.equal(typeof mod[hook], 'function', name + ' 的 ' + hook + ' 必须是函数')
    }
  }

  console.log(
    'ok   ' + String(index).padStart(2) + '  ' + id.padEnd(8) + mod.meta.duration + 'ms  ' + mod.meta.complexity
  )
}

console.log('\n全部通过（' + files.length + ' 支动画）。')
