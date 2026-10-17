/**
 * 落盘日志。
 *
 * 启动动画最尴尬的地方：它坏了的时候，用户看到的只是"没动画"，而所有
 * console 都在用户看不见的 devtools 里。所以把关键节点写进文件，
 * 这样出问题时直接看文件，不用靠猜。
 *
 * 任何失败都不许影响主流程 —— 日志写不进去就算了。
 */
import fs from 'node:fs'
import path from 'node:path'

export function createLogger(file, { maxBytes = 512 * 1024 } = {}) {
  function rotate() {
    try {
      if (fs.statSync(file).size > maxBytes) fs.renameSync(file, file + '.1')
    } catch {
      /* 文件还不存在，正常 */
    }
  }

  function format(args) {
    return args
      .map((value) => {
        if (typeof value === 'string') return value
        try {
          return JSON.stringify(value)
        } catch {
          return String(value)
        }
      })
      .join(' ')
  }

  return function log(...args) {
    const line = new Date().toISOString().slice(11, 23) + ' ' + format(args)
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      rotate()
      fs.appendFileSync(file, line + '\n', 'utf8')
    } catch {
      /* 日志失败不影响启动 */
    }
    try {
      console.log('[startup-kit] ' + line)
    } catch {
      /* noop */
    }
  }
}
