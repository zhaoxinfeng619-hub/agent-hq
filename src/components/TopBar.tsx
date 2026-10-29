import { useEffect, useState } from 'react'
import { useHQ, type ViewFilter } from '../store/useHQ'
import { sceneRef } from '../scene/ref'

const TABS: { id: ViewFilter; label: string }[] = [
  { id: 'all', label: '总览' },
  { id: 'running', label: '仅看运行' },
  { id: 'error', label: '仅看异常' },
]

export default function TopBar() {
  const filter = useHQ((s) => s.filter)
  const setFilter = useHQ((s) => s.setFilter)
  const roam = useHQ((s) => s.roam)
  const setRoam = useHQ((s) => s.setRoam)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const hh = now.getHours().toString().padStart(2, '0')
  const mm = now.getMinutes().toString().padStart(2, '0')
  const ss = now.getSeconds().toString().padStart(2, '0')

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">
          AGENT<span>·</span>HQ
        </div>
        <div className="brand-sub">智能总部</div>
      </div>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${filter === t.id ? 'on' : ''}`}
            onClick={() => setFilter(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="top-right">
        <div className="conn">
          <i />
          LIVE
        </div>
        <div className="clock">
          {hh}:{mm}:{ss}
        </div>
        <button className={`icon-btn ${roam ? 'on' : ''}`} onClick={() => setRoam(!roam)}>
          {roam ? '巡游中' : '巡游'}
        </button>
        <button
          className="icon-btn"
          onClick={() => {
            useHQ.getState().setFocusDept(null)
            useHQ.getState().openAgent(null)
            sceneRef.current?.resetView()
          }}
        >
          全景
        </button>
      </div>
    </header>
  )
}
