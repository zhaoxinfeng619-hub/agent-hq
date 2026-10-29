import { useEffect, useMemo, useRef } from 'react'
import { DEPTS } from '../data/world'
import { useHQ } from '../store/useHQ'

export default function Ticker() {
  const events = useHQ((s) => s.snap.events)
  const trackRef = useRef<HTMLDivElement>(null)
  const xRef = useRef(0)
  const seen = useRef<Set<string>>(new Set())
  const first = useRef(true)

  const items = useMemo(() => [...events.slice(0, 16)].reverse(), [events])

  useEffect(() => {
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const el = trackRef.current
      if (!el) return
      xRef.current -= 0.42
      const half = el.scrollWidth / 2
      if (half > 0 && -xRef.current >= half) xRef.current += half
      el.style.transform = `translate3d(${xRef.current}px,0,0)`
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const fresh = (id: string) => {
    const isNew = !seen.current.has(id)
    if (isNew) seen.current.add(id)
    return isNew && !first.current
  }
  if (items.length) first.current = false

  const all = [...items, ...items]

  return (
    <footer className="ticker rise d4">
      <div className="ticker-head">
        <span>ACTIVITY STREAM · 实时活动</span>
        <span>{events.length} EVENTS</span>
      </div>
      <div style={{ overflow: 'hidden', flex: 1, display: 'flex', alignItems: 'flex-start' }}>
        <div className="ticker-track" ref={trackRef}>
          {all.map((e, i) => {
            const d = DEPTS.find((x) => x.id === e.deptId)
            const t = new Date(e.ts)
            const hm = `${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')}:${t
              .getSeconds()
              .toString()
              .padStart(2, '0')}`
            return (
              <div
                key={e.id + i}
                className={`tick-card ${e.kind === 'error' ? 'err' : ''} ${i < items.length && fresh(e.id) ? 'fresh' : ''}`}
                style={{ ['--c' as string]: d?.color ?? '#888' }}
              >
                <i />
                {e.text}
                <em>{hm}</em>
              </div>
            )
          })}
        </div>
      </div>
    </footer>
  )
}
