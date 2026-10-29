import { useEffect } from 'react'
import Stage from './components/Stage'
import TopBar from './components/TopBar'
import LeftPanel from './components/LeftPanel'
import TaskTable from './components/TaskTable'
import Ticker from './components/Ticker'
import Drawer from './components/Drawer'
import { useHQ } from './store/useHQ'
import { world } from './data/world'

export default function App() {
  const booted = useHQ((s) => s.booted)
  const setBooted = useHQ((s) => s.setBooted)
  const blocked = useHQ((s) => s.snap.kpis.blocked)
  const setFilter = useHQ((s) => s.setFilter)

  useEffect(() => {
    const q = new URLSearchParams(location.search)
    if (q.has('noroam')) useHQ.getState().setRoam(false)
    if (q.get('focus')) useHQ.getState().setFocusDept(q.get('focus'))
    if (q.get('agent')) useHQ.getState().openAgent(q.get('agent'))
    if (q.has('meet')) world.forceMeeting()
    if (q.has('err')) world.forceError()

    if (q.has('noboot')) {
      setBooted(true)
      return
    }
    const t = setTimeout(() => setBooted(true), 1150)
    return () => clearTimeout(t)
  }, [setBooted])

  const noanim = typeof location !== 'undefined' && new URLSearchParams(location.search).has('noanim')

  return (
    <div className={`app ${noanim ? 'noanim' : ''}`}>
      <Stage />
      <div className="vignette" />
      <div className="scanlines" />
      <div className="corner tl" />
      <div className="corner tr" />
      <div className="corner bl" />
      <div className="corner br" />

      <TopBar />
      <LeftPanel />
      <TaskTable />
      <Ticker />
      <Drawer />

      {blocked > 0 && (
        <div className="alert-bar" onClick={() => setFilter('error')}>
          <i />
          {blocked} 个 Agent 处于异常 · 点击查看
        </div>
      )}

      {!booted && (
        <div className="boot">
          <div className="boot-mark">
            AGENT<span>·</span>HQ
          </div>
          <div className="boot-line">
            <i />
          </div>
          <div className="boot-txt">BOOTING FLOOR PLAN…</div>
        </div>
      )}
    </div>
  )
}
