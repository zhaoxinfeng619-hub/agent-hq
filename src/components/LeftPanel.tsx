import { BIZ_DEPTS, DEPTS } from '../data/world'
import { useHQ } from '../store/useHQ'

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US')
const fmtM = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${Math.round(n)}`)

export default function LeftPanel() {
  const snap = useHQ((s) => s.snap)
  const focusDept = useHQ((s) => s.focusDept)
  const setFocusDept = useHQ((s) => s.setFocusDept)
  const k = snap.kpis
  const load = snap.deptLoad
  const errors = snap.agents.filter((a) => a.status === 'error').slice(0, 3)
  const meeting = snap.meeting
  const meetCount = meeting ? meeting.agentIds.length : 0
  const left = meeting ? Math.max(0, Math.round((meeting.endsAt - Date.now()) / 1000)) : 0

  return (
    <aside className="hud-left panel rise d1">
      <div className="p-head">
        <div className="p-title">
          <b>总任务进度</b> / CAMPAIGN
        </div>
        <div className="p-title">{BIZ_DEPTS.length} DEPTS / {DEPTS.length} ROOMS</div>
      </div>

      <div className="kpi-block">
        <div className="kpi-big">
          {k.progress.toFixed(0)}
          <i>%</i>
        </div>
        <div className="bar">
          <i style={{ width: `${Math.max(2, k.progress)}%` }} />
        </div>
        <div className="bar-meta">
          <span>DONE {fmtInt(k.done)}</span>
          <span>TOTAL {fmtInt(k.total)}</span>
        </div>

        <div className="kpi-grid">
          <div className="kpi-cell">
            <b>{fmtInt(k.total)}</b>
            <small>总任务数</small>
          </div>
          <div className="kpi-cell">
            <b style={{ color: 'var(--green)' }}>{k.running}</b>
            <small>运行中</small>
          </div>
          <div className={`kpi-cell ${k.blocked > 0 ? 'alert' : ''}`}>
            <b>
              {k.blocked}
              {k.blocked > 0 && <em>!</em>}
            </b>
            <small>阻塞 / 异常</small>
          </div>
          <div className="kpi-cell">
            <b>{fmtInt(k.done)}</b>
            <small>已完成</small>
          </div>
          <div className="kpi-cell">
            <b>
              {k.avgMin.toFixed(1)}
              <em>m</em>
            </b>
            <small>平均耗时</small>
          </div>
          <div className="kpi-cell">
            <b>
              {fmtM(k.tokens)}
              <em>tk</em>
            </b>
            <small>TOKEN 消耗</small>
          </div>
        </div>
      </div>

      <div className="chips-row">
        <button
          className={`chip ${!focusDept ? 'on' : ''}`}
          style={{ ['--c' as string]: '#ff7a2f' }}
          onClick={() => setFocusDept(null)}
        >
          全部
        </button>
        {BIZ_DEPTS.map((d) => (
          <button
            key={d.id}
            className={`chip ${focusDept === d.id ? 'on' : ''}`}
            style={{ ['--c' as string]: d.color }}
            onClick={() => setFocusDept(focusDept === d.id ? null : d.id)}
          >
            <i />
            {d.short}
          </button>
        ))}
      </div>

      <div className="dept-load">
        {DEPTS.map((d) => {
          const l = load.find((x) => x.id === d.id)!
          const isMeeting = d.kind === 'meeting'
          const pct = isMeeting ? 0 : (l.running / Math.max(1, l.total)) * 100
          return (
            <div
              key={d.id}
              className={`load-row ${l.error > 0 ? 'err' : ''} ${isMeeting && meetCount > 0 ? 'live' : ''}`}
              style={{ ['--c' as string]: d.color }}
              onClick={() => setFocusDept(focusDept === d.id ? null : d.id)}
            >
              <i />
              <b>{d.short}</b>
              {isMeeting ? (
                <div className="track quiet">
                  <i style={{ width: `${Math.min(100, (meetCount / 6) * 100)}%` }} />
                </div>
              ) : (
                <div className="track">
                  <i style={{ width: `${pct}%` }} />
                </div>
              )}
              <small>{isMeeting ? (meetCount ? `${meetCount} 人在会` : '空闲') : `${l.running}/${l.total}`}</small>
            </div>
          )
        })}
      </div>

      <div className="meet-card">
        <div className="m-head">
          <span>会议室 / WAR ROOM</span>
          {meeting && <em>{left}s</em>}
        </div>
        {meeting ? (
          <>
            <div className="m-topic">{meeting.topic}</div>
            <div className="m-people">
              {meeting.agentIds.map((id) => {
                const a = snap.agents.find((x) => x.id === id)
                const d = DEPTS.find((x) => x.id === a?.deptId)
                return (
                  <span key={id} title={`${a?.name ?? ''} · ${d?.name ?? ''}`}>
                    <i style={{ background: d?.color, boxShadow: `0 0 8px ${d?.color}` }} />
                    {a?.name}
                  </span>
                )
              })}
            </div>
            <div className="m-foot">
              {meeting.phase === 'gather' ? '正在入场…' : '讨论中'} · 共 {meeting.agentIds.length} 人参会
            </div>
          </>
        ) : (
          <div className="q-ok">
            <i />
            会议室空闲 · 下一场即将召集
          </div>
        )}
      </div>

      <div className="queue">
        <div className="q-head">
          异常队列 / ALERTS
          {meetCount > 0 && <span>· 有会议进行中</span>}
        </div>
        {errors.length === 0 ? (
          <div className="q-ok">
            <i />
            全部 Agent 健康运行
          </div>
        ) : (
          errors.map((a) => {
            const d = DEPTS.find((x) => x.id === a.deptId)!
            return (
              <div key={a.id} className="q-row" style={{ ['--c' as string]: d.color }} onClick={() => useHQ.getState().openAgent(a.id)}>
                <i />
                <b>{a.name}</b>
                <small>{d.short}</small>
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}
