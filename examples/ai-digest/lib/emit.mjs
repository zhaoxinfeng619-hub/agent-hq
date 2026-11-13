/**
 * 打点客户端：把真实执行事件发给 Agent HQ bridge。
 *
 * 设计原则（重要）：
 *   - 失败不阻断业务。bridge 没开就静默降级，只写本地 JSONL，任务照跑。
 *   - 不做任何延迟/伪造。事件时间戳 = 真实调用时刻，序号 = 真实到达顺序。
 *   - 每个事件的 agent id 就是真实进程标识，大屏上的一个身影 = 一个真实 worker。
 */

import fs from 'node:fs'
import path from 'node:path'

const BRIDGE = process.env.BRIDGE_URL ?? 'http://127.0.0.1:8787'
const JSONL = process.env.EVENT_JSONL ?? null

/** 每个 worker 首次调用时声明自己是谁 */
let announced = null

function writeJsonl(item) {
  if (!JSONL) return
  try {
    fs.mkdirSync(path.dirname(JSONL), { recursive: true })
    fs.appendFileSync(JSONL, JSON.stringify(item) + '\n')
  } catch {
    /* 落盘失败不影响主流程 */
  }
}

/**
 * @param {object} ev  { type, agent, parent, dept, task, tool, p, msg, agents, topic, ms, tokens }
 */
export async function emit(ev) {
  const item = { ...ev, _ts: Date.now(), _pid: process.pid }
  if (!item.agent && announced) item.agent = announced

  writeJsonl(item)
  if (!process.env.NO_BRIDGE) {
    try {
      await fetch(`${BRIDGE}/emit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(item),
        signal: AbortSignal.timeout(2500),
      })
    } catch {
      /* bridge 没起：静默降级 */
    }
  }
  return item
}

/** 不等待的版本，用于工具调用打点（不想因为 HTTP 拖慢真实工作） */
export function emitAsync(ev) {
  emit(ev).catch(() => {})
}

/** 声明身份：之后所有事件的 agent 字段自动填这个 id */
export function identify(id, dept) {
  announced = id
  process.env.AGENT_ID = id
  process.env.AGENT_DEPT = dept
  return emit({ type: 'agent.start', agent: id, dept, task: process.env.AGENT_TASK ?? undefined })
}

/** 包一层真实工具调用：打点 → 执行 → 打点，耗时就是真实耗时 */
export async function tracedTool(agent, dept, tool, fn, msg) {
  const t0 = Date.now()
  await emit({ type: 'tool', agent, dept, tool, msg: msg ?? tool })
  let ok = true
  let out
  try {
    out = await fn()
    return out
  } catch (e) {
    ok = false
    throw e
  } finally {
    if (process.env.TRACE_VERBOSE) {
      console.log(`  [${tool}] ${ok ? 'ok' : 'fail'} ${Date.now() - t0}ms`)
    }
  }
}

export function progress(agent, dept, p, msg) {
  return emit({ type: 'progress', agent, dept, p: Math.max(0, Math.min(1, p)), msg })
}

export function done(agent, dept, extra = {}) {
  return emit({ type: 'agent.done', agent, dept, ...extra })
}

export function fail(agent, dept, msg) {
  return emit({ type: 'agent.error', agent, dept, msg })
}
