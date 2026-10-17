#!/usr/bin/env node
/**
 * dsh-startup-kit — 独立预览服务器
 * ----------------------------------------------------------------------------
 * 不装 DSH 也能看动画：node tools/preview.mjs
 *
 * 它和装在 DSH 里的宿主半边走的是**同一份 lib/service.js**，
 * 路由、配置、动画清单完全一致 —— 所以预览里看到的就是启动时看到的。
 *
 * 配置写在 $DSH_HOME/startup-kit.json（默认 ~/.dsh），与真实启动共用。
 * 想隔离调试可以设 DSH_HOME 指到别处。
 */
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASE, createStartupKit } from '../lib/service.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const PORT = Number(process.env.PORT) || 5599

const kit = createStartupKit({ libDir: path.join(ROOT, 'lib'), homeDir: HOME })

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/' || req.url === '') {
      res.writeHead(302, { location: BASE + '/preview' })
      res.end()
      return
    }
    const handled = await kit.handle(req, res)
    if (!handled) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('not found')
    }
  } catch (err) {
    try {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('preview server error')
    } catch {
      /* 响应已经发出去了 */
    }
    console.error('[startup-kit]', err)
  }
})

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`[startup-kit] 端口 ${PORT} 已被占用，换一个：$env:PORT=5600; node tools/preview.mjs`)
  } else {
    console.error('[startup-kit] 服务启动失败：', err)
  }
  process.exit(1)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[startup-kit] 预览：http://127.0.0.1:${PORT}${BASE}/preview`)
  console.log(`[startup-kit] 配置：${path.join(HOME, 'startup-kit.json')}`)
  console.log(`[startup-kit] 动画目录：${path.join(ROOT, 'lib', 'animations')}`)
})
