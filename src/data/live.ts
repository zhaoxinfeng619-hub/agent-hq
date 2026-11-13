import { world } from './world'
import type { LiveEvent } from './types'

/**
 * 真实接入的客户端：把 bridge 推过来的事件流灌进 world。
 *
 *   ?live=1                        → http://127.0.0.1:8787/events
 *   ?live=http://host:port/events  → 指定地址
 *   ?live=...&liveFallback=poll    → 用轮询代替 SSE（有代理/防火墙时）
 *
 * 事件契约见 README「真实接入」一节，服务端实现见 server/bridge.mjs。
 */

export interface LiveHandle {
  close: () => void
  source: 'sse' | 'poll'
}

const DEFAULT_URL = 'http://127.0.0.1:8787/events'

export function liveUrl(): string | null {
  const v = new URLSearchParams(location.search).get('live')
  if (v === null) return null
  if (v === '1' || v === '') return DEFAULT_URL
  return v
}

export function connectLive(url: string): LiveHandle {
  world.goLive()

  // 支持 ?live=http://host:port 这种只给 origin 的写法
  const eventsUrl = url.includes('/events') ? url : `${url.replace(/\/$/, '')}/events`
  const base = eventsUrl.replace(/\/events$/, '')

  let closed = false
  let es: EventSource | null = null
  let timer: number | null = null

  const handle = (raw: string) => {
    let ev: LiveEvent
    try {
      ev = JSON.parse(raw) as LiveEvent
    } catch {
      return
    }
    if (!ev || typeof ev.type !== 'string') return
    world.applyEvent(ev)
  }

  const startPoll = () => {
    world.setLink('connecting')
    let since = 0
    const tick = async () => {
      if (closed) return
      try {
        const r = await fetch(`${base}/events.json?since=${since}`)
        const list = (await r.json()) as (LiveEvent & { _n?: number })[]
        for (const ev of list) {
          handle(JSON.stringify(ev))
          if (typeof ev._n === 'number') since = Math.max(since, ev._n)
        }
        world.setLink('on')
      } catch {
        world.setLink('lost')
      }
      if (!closed) timer = window.setTimeout(tick, 900)
    }
    tick()
  }

  const usePoll = new URLSearchParams(location.search).get('liveFallback') === 'poll'

  if (usePoll || typeof EventSource === 'undefined') {
    startPoll()
  } else {
    es = new EventSource(eventsUrl)
    es.onopen = () => world.setLink('on')
    es.onmessage = (e) => handle(e.data)
    es.onerror = () => {
      // EventSource 自己会重连，这里只把状态标成"断"
      world.setLink('lost')
    }
  }

  return {
    close: () => {
      closed = true
      es?.close()
      if (timer !== null) window.clearTimeout(timer)
    },
    source: es ? 'sse' : 'poll',
  }
}
