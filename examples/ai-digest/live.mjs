#!/usr/bin/env node
/**
 * 一条命令起全套：bridge(relay) + 流水线(watch)
 *
 *   node live.mjs            # 默认每 14 秒重跑一轮，bridge 在 8787
 *   node live.mjs --slow     # 每 40 秒一轮（想看得更从容）
 *   node live.mjs --once     # 只跑一轮
 *
 * 然后浏览器打开： Agent-HQ-智能总部.html?live=1
 * Ctrl+C 一起退出（不会留后台进程）。
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const ONCE = argv.includes('--once')
const SLOW = argv.includes('--slow')
const PORT = 8787

const kids = []
const shutdown = (code = 0) => {
  for (const k of kids) {
    try {
      k.kill('SIGINT')
    } catch {
      /* 已退出 */
    }
  }
  setTimeout(() => process.exit(code), 300)
}
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

// 1) bridge 先起（relay = 只转发，不造事件）
const bridge = spawn(process.execPath, [path.join(HERE, '../../server/bridge.mjs'), '--relay', '--port', String(PORT)], {
  stdio: 'inherit',
})
kids.push(bridge)
bridge.on('exit', (c) => {
  if (c && c !== 0) console.error(`[live] bridge 退出 code=${c}（端口被占？改 --port）`)
})

// 2) 等它可用
let ok = false
for (let i = 0; i < 40; i++) {
  try {
    const h = await (await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(500) })).json()
    if (h.ok) {
      ok = true
      console.log(`[live] bridge 就绪 · mode=${h.mode}`)
      break
    }
  } catch {
    /* 还没起来 */
  }
  await new Promise((r) => setTimeout(r, 250))
}
if (!ok) {
  console.error('[live] bridge 起不来，退出')
  shutdown(1)
}

// 3) 起流水线
const args = ['run.mjs', '--days', '14', '--deep']
if (ONCE) args.push('--once')
else args.push('--watch', SLOW ? '40' : '14')

console.log(`\n[live] 大屏地址： Agent-HQ-智能总部.html?live=1`)
console.log(`[live] 重跑间隔： ${ONCE ? '只跑一轮' : SLOW ? '40s' : '14s'}`)
console.log(`[live] Ctrl+C 结束\n`)

const digest = spawn(process.execPath, args, { cwd: HERE, stdio: 'inherit', env: { ...process.env, BRIDGE_URL: `http://127.0.0.1:${PORT}` } })
kids.push(digest)
digest.on('exit', (c) => {
  if (ONCE) {
    console.log(`[live] 单轮结束 code=${c}，bridge 保持在线（大屏还能看最后状态）`)
    return
  }
  shutdown(c ?? 0)
})
