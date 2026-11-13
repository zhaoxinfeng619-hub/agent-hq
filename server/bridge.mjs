#!/usr/bin/env node
/**
 * Agent HQ · bridge —— 把真实 agent 运行时的事件流推给大屏
 *
 *   node server/bridge.mjs --relay           # 纯接收模式：不造任何事件，只等真实运行时打点
 *   node server/bridge.mjs --demo            # 内置多 agent 编排演示（默认）
 *   node server/bridge.mjs --file run.jsonl  # 跟读任意 JSONL 事件日志（tail -f 语义）
 *   node server/bridge.mjs --port 8787       # 改端口
 *
 * 大屏侧：打开 Agent-HQ 时加 ?live=1（默认连 http://127.0.0.1:8787/events）
 *
 * HTTP:
 *   GET  /events          SSE 事件流（推荐）
 *   GET  /events.json     ?since=<n> 轮询用，返回最近事件 + 序号
 *   POST /emit            单条事件入队并广播（curl 可测）
 *   POST /reset           清空（大屏回到 MOCK 演出）
 *   GET  /health
 */

import http from 'node:http'
import fs from 'node:fs'
import { createReadStream } from 'node:fs'

const argv = process.argv.slice(2)
const argOf = (k, d) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d
}
const PORT = Number(argOf('port', 8787))
const FILE = argOf('file', null)
/** --relay：只转发外部 POST /emit 进来的事件，一条都不自己造 */
const RELAY = argv.includes('--relay')
const DEMO = !RELAY && (argv.includes('--demo') || !FILE)

/* ------------------------------------------------------------------ 事件总线 */

/** 环形缓冲：SSE 与轮询共用 */
const LOG_MAX = 400
let seq = 0
const log = []
const clients = new Set()

function emit(ev) {
  const item = { ...ev, _n: ++seq, _ts: Date.now() }
  log.push(item)
  if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX)
  const payload = `data: ${JSON.stringify(item)}\n\n`
  for (const res of clients) {
    try {
      res.write(payload)
    } catch {
      clients.delete(res)
    }
  }
  if (!DEMO || process.env.BRIDGE_VERBOSE) console.log('→', item.type, item.agent ?? item.agents?.length ?? '')
}

/* ------------------------------------------------------------------ 演示编排 */

const PICK = (a) => a[Math.floor(Math.random() * a.length)]

function demo() {
  const run = Math.random().toString(36).slice(2, 6)
  // 固定 id：同一个 agent 反复接活，座位才稳定（真实运行时 id 本来就长期存在）
  const orch = 'orchestrator'
  const kids = [
    { id: 'spec-writer', dept: 'product', task: '拆解内容审核需求 · 输出判定树' },
    { id: 'api-refactor', dept: 'eng', task: '重写 moderation.service.ts' },
    { id: 'ui-review', dept: 'design', task: '审核工作台交互稿' },
    { id: 'eval-runner', dept: 'data', task: '跑 2,000 条集测样本' },
  ]

  const timeline = []
  const at = (ms, ev) => timeline.push({ ms, ev })

  at(0, { type: 'agent.start', agent: orch, dept: 'director', task: `编排 · 审核链路重构 #${run}` })
  at(600, { type: 'tool', agent: orch, tool: 'plan.decompose', msg: `${orch} 拆解为 4 个子任务` })

  kids.forEach((k, i) => {
    at(1200 + i * 700, {
      type: 'subagent.spawn',
      agent: k.id,
      parent: orch,
      dept: k.dept,
      task: k.task,
    })
    at(1500 + i * 700, { type: 'agent.start', agent: k.id, dept: k.dept, task: k.task })
  })

  // 每个子 agent 自己推进：progress + tool 交替
  const tools = ['file.read', 'file.edit', 'python.exec', 'sql.query', 'web.search', 'playwright', 'llm.call']
  for (let step = 0; step < 9; step++) {
    kids.forEach((k, i) => {
      at(2600 + step * 900 + i * 120, { type: 'progress', agent: k.id, dept: k.dept, p: Math.min(0.95, (step + 1) / 10) })
      if (step % 2 === 0) at(2900 + step * 900 + i * 120, { type: 'tool', agent: k.id, dept: k.dept, tool: PICK(tools) })
    })
  }

  // 中途一段协同：拉三个子 agent 开会
  at(6200, {
    type: 'meeting.start',
    agents: kids.slice(0, 3).map((k) => k.id),
    topic: '审核口径对齐 · 误杀率 vs 漏放率',
    ms: 9000,
  })
  at(15_400, { type: 'meeting.end' })

  // 一个子 agent 翻车再恢复，让告警不是摆设
  at(9600, { type: 'agent.error', agent: kids[1].id, dept: kids[1].dept, msg: '上游 429 限流' })
  at(12_800, { type: 'agent.start', agent: kids[1].id, dept: kids[1].dept, task: kids[1].task })

  kids.forEach((k, i) => {
    at(19_500 + i * 900, {
      type: 'agent.done',
      agent: k.id,
      dept: k.dept,
      tokens: 20_000 + Math.floor(Math.random() * 60_000),
    })
  })
  at(24_500, { type: 'agent.done', agent: orch, dept: 'director', tokens: 96_000 })
  at(25_500, { type: 'agent.idle', agent: orch, dept: 'director' })

  return { timeline, total: 28_000 }
}

function startDemo() {
  const plan = demo()
  const t0 = Date.now()
  // 模拟真实到达顺序：按相对时间派发
  const timers = plan.timeline.map(({ ms, ev }) => setTimeout(() => emit(ev), ms))
  const loop = setTimeout(startDemo, plan.total)
  return () => {
    timers.forEach(clearTimeout)
    clearTimeout(loop)
  }
}

/* ------------------------------------------------------------------ JSONL 跟读 */

function follow(file) {
  let offset = 0
  let rest = ''
  const pump = () => {
    let stat
    try {
      stat = fs.statSync(file)
    } catch {
      return
    }
    if (stat.size <= offset) return
    const stream = createReadStream(file, { start: offset, end: stat.size - 1, encoding: 'utf8' })
    stream.on('data', (chunk) => {
      rest += chunk
      const lines = rest.split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) {
        const s = line.trim()
        if (!s) continue
        try {
          const ev = JSON.parse(s)
          if (ev && typeof ev.type === 'string') emit(ev)
        } catch {
          /* 半行 / 非 JSON，忽略 */
        }
      }
    })
    stream.on('end', () => {
      offset = stat.size
    })
  }
  offset = 0
  pump()
  fs.watchFile(file, { interval: 250 }, pump)
  console.log(`跟读 ${file}`)
}

/* ------------------------------------------------------------------ HTTP */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    return res.end()
  }

  if (url.pathname === '/health') {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ ok: true, mode: RELAY ? 'relay' : DEMO ? 'demo' : 'file', clients: clients.size, seq }))
  }

  if (url.pathname === '/events.json') {
    const since = Number(url.searchParams.get('since') ?? 0)
    const items = log.filter((e) => e._n > since)
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' })
    return res.end(JSON.stringify(items))
  }

  if (url.pathname === '/events') {
    res.writeHead(200, {
      ...CORS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write(': connected\n\n')
    // 中途打开大屏时补发最近事件，重建"谁派了谁"的关系与当前状态
    for (const item of log.slice(-90)) res.write(`data: ${JSON.stringify(item)}\n\n`)
    clients.add(res)
    const beat = setInterval(() => {
      try {
        res.write(': ping\n\n')
      } catch {
        clearInterval(beat)
      }
    }, 15_000)
    req.on('close', () => {
      clearInterval(beat)
      clients.delete(res)
    })
    return
  }

  if (req.method === 'POST' && (url.pathname === '/emit' || url.pathname === '/reset')) {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      if (url.pathname === '/reset') {
        emit({ type: 'reset' })
        res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ ok: true }))
      }
      try {
        const ev = JSON.parse(body || '{}')
        if (!ev.type) throw new Error('缺少 type')
        emit(ev)
        res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, seq }))
      } catch (e) {
        res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: String(e.message ?? e) }))
      }
    })
    return
  }

  res.writeHead(404, { ...CORS, 'Content-Type': 'text/plain' })
  res.end('not found: /events | /events.json | /emit | /reset | /health')
})

server.listen(PORT, () => {
  console.log(`\n  Agent HQ bridge → http://127.0.0.1:${PORT}`)
  console.log(`  SSE   : http://127.0.0.1:${PORT}/events`)
  console.log(`  大屏  : 打开 Agent-HQ-智能总部.html?live=1`)
  if (RELAY) console.log(`  模式  : relay（只转发 POST /emit，不造事件）\n`)
  else console.log('')
  if (RELAY) return
  if (FILE) follow(FILE)
  else startDemo()
})
