#!/usr/bin/env node
/**
 * dsh-startup-kit — 诊断
 * ----------------------------------------------------------------------------
 * 启动动画坏了的时候，现象永远只有一句"没有动画"。这个脚本把三个落盘证据
 * 摆到一起，并给出结论：
 *
 *   startup-kit.log          宿主侧：有没有加载、有没有改写 index.html、收到了哪些请求
 *   startup-kit-browser.log  浏览器侧：壳有没有跑、动画有没有加载成功、怎么收场
 *   startup-kit-index.html   注入后的 index.html 原文
 *
 * 用法：node tools/diagnose.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const F = {
  config: path.join(HOME, 'startup-kit.json'),
  log: path.join(HOME, 'startup-kit.log'),
  browser: path.join(HOME, 'startup-kit-browser.log'),
  index: path.join(HOME, 'startup-kit-index.html')
}

/* --mode=always 之类的写法会把配置写盘（诊断时强制每次刷新都播，排除"已播过"的干扰） */
const modeArg = process.argv.find((a) => a.startsWith('--mode='))
if (modeArg) {
  const mode = modeArg.slice('--mode='.length)
  if (!['always', 'session', 'daily'].includes(mode)) {
    console.error('mode 只能是 always / session / daily')
    process.exit(1)
  }
  let current = {}
  try {
    current = JSON.parse(fs.readFileSync(F.config, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    current = {}
  }
  fs.mkdirSync(HOME, { recursive: true })
  fs.writeFileSync(F.config, JSON.stringify({ ...current, mode }, null, 2) + '\n', 'utf8')
  console.log('已把 ' + F.config + ' 的 mode 设为 ' + mode)
}

function read(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

function tail(text, n) {
  if (!text) return ''
  const lines = text.trimEnd().split('\n')
  return lines.slice(-n).join('\n')
}

function line(label, value) {
  console.log('  ' + label.padEnd(22) + value)
}

console.log('\n=== startup-kit 诊断 ===\n')
line('DSH_HOME', HOME)

/* ── 配置 ────────────────────────────────────────────────────────────── */

const rawConfig = read(F.config)
let cfg = null
if (rawConfig === null) {
  console.log('\n[配置] 还没有 startup-kit.json（用默认值）')
} else {
  try {
    cfg = JSON.parse(rawConfig.replace(/^\uFEFF/, ''))
    console.log('\n[配置] ' + F.config)
    for (const [k, v] of Object.entries(cfg)) line(k, String(v))
  } catch (err) {
    console.log('\n[配置] 解析失败：' + err.message)
  }
}

/* ── 宿主日志 ────────────────────────────────────────────────────────── */

const hostLog = read(F.log)
const browserLog = read(F.browser)
const indexDump = read(F.index)

console.log('\n[宿主日志] ' + (hostLog === null ? '不存在' : F.log))
if (hostLog) {
  console.log(tail(hostLog, 25))
}

console.log('\n[浏览器日志] ' + (browserLog === null ? '不存在' : F.browser))
if (browserLog) {
  console.log(tail(browserLog, 25))
}

console.log('\n[注入结果] ' + (indexDump === null ? '不存在' : F.index))
if (indexDump) {
  line('字节数', String(indexDump.length))
  line('含 dsk-root', String(indexDump.includes('id="dsk-root"')))
  line('含 dsk-lock', String(indexDump.includes('dsk-lock')))
  line('含 shell.js', String(indexDump.includes('/startup-kit/shell.js')))
}

/* ── 结论 ────────────────────────────────────────────────────────────── */

console.log('\n=== 结论 ===\n')

const hasApply = !!hostLog && hostLog.includes('apply 完成')
const hasTap = !!hostLog && hostLog.includes('tapIndex')
const hasBrowser = !!browserLog
const hasClientBoot = !!browserLog && browserLog.includes('client-boot')
const hasMounted = !!browserLog && browserLog.includes('shell-mounted')
const hasRejection = !!hostLog && hostLog.includes('guard-rejected')

if (!hostLog && !indexDump) {
  console.log('  ✗ 宿主半边没有留下任何痕迹：插件根本没被加载。')
  console.log('    检查 package.json 的 dsh.profile.bundles、以及 DSH 启动日志里的加载错误。')
} else if (!hasApply) {
  console.log('  ✗ 有日志文件但没有 "apply 完成"：apply 中途抛异常或没执行到。')
  console.log('    看日志末尾的报错。')
} else if (!hasBrowser && !hasTap) {
  console.log('  ✗ 两条路都没走通：宿主没改写 HTML，client 半边也没跑。')
  console.log('    → client 半边需要 package.json 里有 dsh.client + exports["./client"]，改完要重启。')
} else if (!hasBrowser) {
  console.log('  ✗ 宿主改写了 HTML，但窗口加载的不是那份文档；client 半边也没有回传。')
  console.log('    → 检查 package.json 的 dsh.client 声明是否生效（重启后 bundle 才会被注册）')
  console.log('    → 或 bundle 注册失败，DSH 启动日志里会有 "bundle ... without registering"')
} else if (!hasClientBoot && !hasMounted) {
  console.log('  ? 有面包屑但既不是 client-boot 也不是 shell-mounted，看上面日志。')
} else if (hasClientBoot && !hasMounted) {
  console.log('  ✗ client 半边自举了，但启动壳没装上。')
  if (browserLog.includes('client-config-error')) {
    console.log('    → 取不到 /startup-kit/config：页面无法访问本地 HTTP 服务（file:// 场景？）')
  } else if (browserLog.includes('client-shell-error')) {
    console.log('    → /startup-kit/shell.js 加载失败')
  } else if (browserLog.includes('client-watchdog')) {
    console.log('    → 壳脚本执行了但没置 __DSK_LOADED__，看 shell 自身是否报错')
  } else if (browserLog.includes('client-skip')) {
    console.log('    → 配置判定本次不播')
  } else {
    console.log('    → 看上面日志里 client-boot 之后发生了什么')
  }
} else if (!hasMounted) {
  console.log('  ✗ 有面包屑，但没有 shell-mounted：壳执行到一半就断了。')
} else if (browserLog.includes('animation-load-error')) {
  console.log('  ✗ 壳跑起来了，但动画模块 import 失败。')
  console.log('    → 看上面日志里记录的失败原因；多半是 /startup-kit/animations/*.js 取不到。')
} else if (browserLog.includes('skip-by-host')) {
  console.log('  ✓ 宿主判定本次不播（enabled=false / session 已播 / daily 已播）。')
  console.log('    → 把 startup-kit.json 的 mode 改成 always，或清掉 sessionStorage。')
} else if (browserLog.includes('finish done')) {
  console.log('  ✓ 动画正常演完并收场了。如果没看到，可能是：')
  console.log('    · mode=session 且本会话已播过 → sessionStorage 里有标记')
  console.log('    · 动画太快（speed 太大）或窗口启动得比动画慢')
} else if (hasRejection) {
  console.log('  ? 有请求被信任栅栏拒绝，但 GET 静态资源现在已放行。')
  console.log('    把上面三段日志发出来。')
} else {
  console.log('  ? 有日志但没匹配到已知模式，把上面三段日志一起发出来。')
}

console.log('\n提示：想强制每次都播，把配置里的 "mode" 改成 "always"。\n')
