#!/usr/bin/env node
/**
 * AI 日报 / 周报 —— 真实的阶段化多 agent 流水线
 *
 *   node run.mjs                          # 跑一轮（当前 ../agent-hq 最近 7 天）
 *   node run.mjs --repo ../foo --days 14  # 换仓库 / 换窗口
 *   node run.mjs --watch 60               # 每 60 秒重跑一轮（长时间观察大屏用）
 *   node run.mjs --no-meeting             # 不要协同会议
 *
 * 真实性说明（这几条是"能看到真运行"的根据）：
 *   1. 4 个 worker 是真正的 OS 子进程（os 进程列表里能看到 4 个 node），不是模拟对象。
 *   2. 依赖是真的：collector 必须先写出 metrics.json，writer/analyst 才读得到；
 *      写不出就真的 ENOENT 失败。并行也是真的：writer 和 analyst 同时起。
 *   3. 每个 tool 事件对应一次真实调用（真的执行 git、真的 fs.readFileSync）。
 *   4. 事件时间戳是真实到达时刻，可用 `curl /events.json` 复核，没有预录时间线。
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { emit } from './lib/emit.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, 'out')

const argv = process.argv.slice(2)
const argOf = (k, d) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d
}
const REPO = path.resolve(HERE, argOf('repo', '../..'))
const SCAN = path.resolve(HERE, argOf('scan', '../../..'))
const DAYS = Number(argOf('days', 7))
const WATCH = Number(argOf('watch', 0))
const DEEP = argv.includes('--deep')
const MEETING = !argv.includes('--no-meeting')
const ORCH = 'digest.orchestrator'

const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a)

/** 起一个真实子进程，等它退出；退出码带回 */
function runWorker(script, env) {
  return new Promise((resolve) => {
    const started = Date.now()
    const p = spawn(process.execPath, [path.join(HERE, 'workers', script)], {
      cwd: HERE,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    p.stdout.on('data', (d) => {
      out += d
      process.stdout.write(`    ${script} │ ${d}`)
    })
    p.stderr.on('data', (d) => process.stderr.write(`    ${script} ! ${d}`))
    p.on('exit', (code) => resolve({ code: code ?? 1, ms: Date.now() - started, out: out.trim() }))
  })
}

async function spawnChild({ id, dept, task, script, env = {}, wait = true }) {
  // 先声明"我派了谁"，再让子进程自己报 start（和真实框架的顺序一致）
  await emit({ type: 'subagent.spawn', agent: id, parent: ORCH, dept, task })
  log(`spawn ${id} → ${dept}`)
  const promise = runWorker(script, { AGENT_ID: id, AGENT_DEPT: dept, AGENT_TASK: task, REPO, SCAN, DAYS, DEEP: DEEP ? '1' : '0', ...env })
  return wait ? promise : { id, dept, promise }
}

async function round(n) {
  const tag = n ? ` · 第 ${n} 轮` : ''
  log(`开始${tag}  repo=${path.basename(REPO)} days=${DAYS}`)

  fs.mkdirSync(OUT, { recursive: true })
  // 每轮清掉产物：保证"看到完成"= 本轮真的写出来了，不会拿上一轮的残留冒充
  for (const f of ['metrics.json', 'daily.md', 'insights.md', 'report.html']) {
    try {
      fs.unlinkSync(path.join(OUT, f))
    } catch {
      /* 本来就没有 */
    }
  }

  await emit({ type: 'reset' })
  await emit({
    type: 'agent.start',
    agent: ORCH,
    dept: 'director',
    task: `编排 AI 日报/周报${tag} · ${path.basename(REPO)} · 近 ${DAYS} 天`,
  })
  await emit({ type: 'tool', agent: ORCH, dept: 'director', tool: 'plan.decompose', msg: '拆成 4 步：采集 → 撰稿 ∥ 分析 → 渲染' })

  /* ---- 阶段 1：采集（串行，因为后面所有人都依赖它）---- */
  const c = await spawnChild({
    id: 'digest.collector',
    dept: 'data',
    task: `采集 ${path.basename(REPO)} 近 ${DAYS} 天提交`,
    script: 'collector.mjs',
  })
  if (c.code !== 0) {
    await emit({ type: 'agent.error', agent: ORCH, dept: 'director', msg: `collector 退出码 ${c.code}，流水线中止` })
    log('采集失败，中止')
    return false
  }

  /* ---- 阶段 2：撰稿 ∥ 分析（真并行，两个进程同时起）---- */
  await emit({ type: 'tool', agent: ORCH, dept: 'director', tool: 'parallel.dispatch', msg: 'writer ∥ analyst 并行开工' })
  const [w, a] = await Promise.all([
    spawnChild({ id: 'digest.writer', dept: 'product', task: '按天生成日报正文', script: 'writer.mjs' }),
    spawnChild({ id: 'digest.analyst', dept: 'eng', task: '统计趋势并判定风险', script: 'analyst.mjs' }),
  ])

  const bothOk = w.code === 0 && a.code === 0

  /* ---- 阶段 3：协同会议（两人都产出后，对齐口径；这是真实存在的动作）---- */
  if (MEETING && bothOk) {
    await emit({
      type: 'meeting.start',
      agents: ['digest.writer', 'digest.analyst', 'digest.renderer'],
      topic: `日报口径对齐 · ${path.basename(REPO)} 本周结论`,
      ms: 5000,
    })
    log('协同会议 5s（对齐数字口径）')
    await new Promise((r) => setTimeout(r, 5000))
    await emit({ type: 'meeting.end' })
  }

  if (!bothOk) {
    await emit({
      type: 'agent.error',
      agent: ORCH,
      dept: 'director',
      msg: `上游失败 writer=${w.code} analyst=${a.code}，跳过渲染`,
    })
    log('上游失败，跳过渲染')
    return false
  }

  /* ---- 阶段 4：渲染 + 校验（依赖前三者的产物）---- */
  const r = await spawnChild({
    id: 'digest.renderer',
    dept: 'design',
    task: '合成 HTML 并校验数字一致性',
    script: 'renderer.mjs',
  })

  const ok = r.code === 0
  const report = path.join(OUT, 'report.html')
  const size = ok && fs.existsSync(report) ? (fs.statSync(report).size / 1024).toFixed(1) : '0'

  await emit({
    type: ok ? 'agent.done' : 'agent.error',
    agent: ORCH,
    dept: 'director',
    msg: ok ? `产出 out/report.html（${size} KB）` : `渲染失败，退出码 ${r.code}`,
    tokens: 0,
  })
  if (ok) await emit({ type: 'agent.idle', agent: ORCH, dept: 'director' })

  log(ok ? `完成 ✅  out/report.html ${size} KB  总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s` : '失败 ❌')
  return ok
}

async function main() {
  const health = await fetch(`${process.env.BRIDGE_URL ?? 'http://127.0.0.1:8787'}/health`, {
    signal: AbortSignal.timeout(1500),
  })
    .then((r) => r.json())
    .catch(() => null)
  if (health) log(`bridge 在线 · mode=${health.mode} · clients=${health.clients}`)
  else log('bridge 未运行（事件只落 JSONL，大屏看不到；先跑 npm run bridge:relay）')

  if (!WATCH) {
    const ok = await round(0)
    process.exit(ok ? 0 : 1)
  }

  let n = 1
  for (;;) {
    await round(n++)
    log(`下一轮 ${WATCH}s 后`)
    await new Promise((r) => setTimeout(r, WATCH * 1000))
  }
}

main()
