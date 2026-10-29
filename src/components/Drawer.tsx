import { DEPTS, world } from '../data/world'
import { useHQ } from '../store/useHQ'
import { sceneRef } from '../scene/ref'

const time = (ts: number) => {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d
    .getSeconds()
    .toString()
    .padStart(2, '0')}`
}

const STATUS_TEXT: Record<string, string> = {
  running: '执行中',
  standby: '待命',
  error: '异常',
  idle: '空闲',
  blocked: '阻塞',
  offline: '离线',
  meeting: '会议中',
}

export default function Drawer() {
  const openAgentId = useHQ((s) => s.openAgentId)
  const snap = useHQ((s) => s.snap)
  const openAgent = useHQ((s) => s.openAgent)
  if (!openAgentId) return null

  const agent = world.agents.find((a) => a.id === openAgentId)
  if (!agent) return null
  const dept = DEPTS.find((d) => d.id === agent.deptId)!
  const task = agent.taskId ? world.byId.get(agent.taskId) : null
  const logs = snap.events.filter((e) => e.agentId === agent.id).slice(0, 9)
  const elapsed = agent.startedAt ? Math.max(1, Math.round((Date.now() - agent.startedAt) / 1000)) : 0

  return (
    <aside className="drawer" style={{ ['--c' as string]: dept.color }}>
      <div className="d-head">
        <div className="d-top">
          <div>
            <div className="d-name">
              <i />
              {agent.name}
            </div>
            <div className="d-sub">
              {dept.name} · AGENT {agent.id.toUpperCase()} · {STATUS_TEXT[agent.status] ?? agent.status}
            </div>
          </div>
          <div className="d-close" onClick={() => openAgent(null)}>
            ✕
          </div>
        </div>

        <div className="d-stats">
          <div className="d-stat">
            <b>{(agent.tokens / 1000).toFixed(1)}K</b>
            <small>TOKEN</small>
          </div>
          <div className="d-stat">
            <b>{elapsed ? `${elapsed}s` : '—'}</b>
            <small>本任务耗时</small>
          </div>
          <div className="d-stat">
            <b
              style={{
                color:
                  agent.status === 'error'
                    ? 'var(--red)'
                    : agent.status === 'meeting'
                      ? '#5AD1E8'
                      : 'var(--green)',
              }}
            >
              {agent.status === 'error' ? 'ERR' : agent.status === 'meeting' ? 'MEET' : agent.status === 'running' ? 'RUN' : 'IDLE'}
            </b>
            <small>状态</small>
          </div>
        </div>
      </div>

      <div className="drawer-body">
        {agent.status === 'meeting' && snap.meeting && (
          <div className="d-meet">
            <div className="d-sec-title">IN SESSION</div>
            <div className="d-meet-topic">{snap.meeting.topic}</div>
            <div className="d-meet-sub">
              与 {Math.max(0, snap.meeting.agentIds.length - 1)} 名同事在会议室 · 剩余{' '}
              {Math.max(0, Math.round((snap.meeting.endsAt - Date.now()) / 1000))}s
            </div>
          </div>
        )}
        {task && (
          <>
            <div className="d-sec-title">CURRENT TASK</div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: '#fff', fontWeight: 600, marginBottom: 6 }}>{task.title}</div>
              <div className="bar" style={{ margin: '0 0 4px' }}>
                <i style={{ width: `${task.progress}%` }} />
              </div>
              <div className="bar-meta">
                <span>{task.progress.toFixed(0)}%</span>
                <span>
                  {task.tool} · {task.status.toUpperCase()}
                </span>
              </div>
              {task.error && (
                <div style={{ marginTop: 10, fontSize: 11, color: '#ff98a4' }}>异常：{task.error}</div>
              )}
            </div>
          </>
        )}

        <div className="d-sec-title">SESSION LOG</div>
        <div className="log">
          {logs.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--faint)' }}>暂无该 Agent 的事件记录</div>
          )}
          {logs.map((e) => (
            <div key={e.id} className={`log-item ${e.kind === 'tool' ? 'tool' : e.kind === 'error' ? 'err' : ''}`}>
              <time>{time(e.ts)}</time>
              <p>{e.text}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="d-actions">
        <button
          className="btn primary"
          disabled={agent.status === 'meeting'}
          onClick={() => world.retryAgent(agent.id)}
        >
          {agent.status === 'error' ? '重试任务' : agent.status === 'meeting' ? '会议中…' : '重新派活'}
        </button>
        <button className="btn" onClick={() => sceneRef.current?.focusAgent(agent.id)}>
          定位视角
        </button>
      </div>
    </aside>
  )
}
