import { useEffect, useRef, useState } from 'react'
import { HQScene } from '../scene/HQScene'
import { sceneRef as globalScene } from '../scene/ref'
import { DEPTS, world } from '../data/world'
import { useHQ } from '../store/useHQ'

const DEPT_INDEX = new Map(DEPTS.map((d, i) => [d.id, i]))

export default function Stage() {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<HQScene | null>(null)
  const labelRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null)

  const focusDept = useHQ((s) => s.focusDept)
  const roam = useHQ((s) => s.roam)
  const openAgentId = useHQ((s) => s.openAgentId)

  useEffect(() => {
    const el = hostRef.current!
    const sc = new HQScene(el, {
      onHoverAgent: (id, x, y) => setTip(id ? { id, x, y } : null),
      onSelectAgent: (id) => useHQ.getState().openAgent(id),
      onSelectRoom: (id) => {
        useHQ.getState().setFocusDept(id)
        if (id) useHQ.getState().openAgent(null)
      },
    })
    sceneRef.current = sc
    globalScene.current = sc

    const ro = new ResizeObserver(() => sc.resize())
    ro.observe(el)

    let raf = 0
    let frame = 0
    const cache: Record<string, string> = {}

    const loop = () => {
      raf = requestAnimationFrame(loop)
      // 标签定位每两帧更新一次就够，省掉一半 DOM 写入
      frame++
      if (frame % 2) return

      const loads = world.deptLoad()
      const focus = useHQ.getState().focusDept
      for (const d of DEPTS) {
        const node = labelRefs.current[d.id]
        if (!node) continue
        const p = sc.projectRoom(d.id)
        if (!p) {
          node.style.opacity = '0'
          continue
        }
        node.style.opacity = ''
        node.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0) translate(-50%, -100%)`
        const load = loads[DEPT_INDEX.get(d.id)!]
        const meetCount = world.meeting ? world.meeting.agentIds.length : 0
        const key = `${load.running}/${load.total}/${load.error}/${meetCount}/${load.meeting}`
        if (cache[d.id] !== key) {
          cache[d.id] = key
          const em = node.querySelector('em')
          if (em) {
            if (d.kind === 'meeting') em.textContent = meetCount ? `IN SESSION · ${meetCount}` : '待使用'
            else if (d.kind === 'director' && !load.running && load.meeting) em.textContent = '在会议室'
            else if (load.error) em.textContent = `ERR · ${load.running}/${load.total}`
            else em.textContent = `${load.running}/${load.total} 运行`
          }
          node.classList.toggle('err', load.error > 0)
          node.classList.toggle('live', d.kind === 'meeting' && meetCount > 0)
        }
        node.classList.toggle('dim', !!focus && focus !== d.id)
      }
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      sc.dispose()
      sceneRef.current = null
      globalScene.current = null
    }
  }, [])

  useEffect(() => {
    sceneRef.current?.setFocusDept(focusDept)
  }, [focusDept])

  useEffect(() => {
    sceneRef.current?.setRoam(roam)
  }, [roam])

  useEffect(() => {
    if (openAgentId) sceneRef.current?.focusAgent(openAgentId)
    else sceneRef.current?.clearAgentMarker()
  }, [openAgentId])

  const agent = tip ? world.agents.find((a) => a.id === tip.id) : null
  const dept = agent ? DEPTS.find((d) => d.id === agent.deptId) : null
  const task = agent?.taskId ? world.byId.get(agent.taskId) : null

  return (
    <>
      <div className="stage" ref={hostRef} />
      <div className="room-labels">
        {DEPTS.map((d) => (
          <div
            key={d.id}
            ref={(n) => {
              labelRefs.current[d.id] = n
            }}
            className={`room-label ${d.kind !== 'dept' ? 'special' : ''}`}
            style={{ ['--c' as string]: d.color }}
          >
            <i />
            <b>{d.name}</b>
            <em>—</em>
          </div>
        ))}
      </div>
      <Dbg />
      {tip && agent && dept && (
        <div className="tip" style={{ left: tip.x, top: tip.y }}>
          <b style={{ color: dept.color }}>{agent.name}</b>
          <small>
            {dept.short} · {agent.status === 'meeting' ? '在会议室' : task ? task.title : '待命中'}
          </small>
        </div>
      )}
    </>
  )
}


function Dbg() {
  const [txt, setTxt] = useState('')
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('debug')) return
    const pose = new URLSearchParams(location.search).has('pose')
    const id = setInterval(() => {
      if (pose) globalScene.current?.snapMeeting()
      const m = world.meeting
      const s2 = globalScene.current?.stats
      const sc = globalScene.current as unknown as { debugPos?: () => string }
      const st = s2 as { avgMs: number; quality: number; calls: number; tris: number } | undefined
      setTxt(
        `Q${st?.quality} · ${st?.avgMs.toFixed(1)}ms · draw ${st?.calls} · tri ${st ? Math.round(st.tris / 1000) : '-'}k | inMeeting=${world.kpis().inMeeting} | ${sc?.debugPos?.() ?? ''}`
      )
    }, 500)
    return () => clearInterval(id)
  }, [])
  if (!txt) return null
  return <div className="dbg">{txt}</div>
}
