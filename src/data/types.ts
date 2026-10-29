export type AgentStatus = 'idle' | 'standby' | 'running' | 'blocked' | 'error' | 'offline' | 'meeting'
export type TaskStatus = 'queued' | 'running' | 'review' | 'done' | 'failed'

/** dept = 业务部门；director = 总监办公室；meeting = 会议室 */
export type RoomKind = 'dept' | 'director' | 'meeting'

export interface Dept {
  id: string
  name: string
  short: string
  color: string
  row: number
  col: number
  colSpan: number
  kind: RoomKind
}

export interface Agent {
  id: string
  deptId: string
  name: string
  status: AgentStatus
  deskIndex: number
  taskId: string | null
  tokens: number
  startedAt: number | null
  /** 0..1 视觉亮度，用于呼吸灯 */
  heat: number
  /** 会议席位，null = 不在会议 */
  seatIndex: number | null
  /** 总监：负责调度其他 agent */
  role: 'director' | 'member'
}

export interface Task {
  id: string
  deptId: string
  agentId: string
  title: string
  summary: string
  status: TaskStatus
  progress: number
  createdAt: number
  finishedAt: number | null
  durationMs: number
  tool: string
  tokens: number
  error?: string
}

export type EventKind = 'start' | 'tool' | 'done' | 'error' | 'retry' | 'queue' | 'meeting'

export interface Ev {
  id: string
  ts: number
  kind: EventKind
  deptId: string
  agentId: string
  taskId: string
  text: string
}

export interface Meeting {
  id: string
  topic: string
  agentIds: string[]
  deptIds: string[]
  /** gather = 正在入场，talking = 讨论中，closing = 散会 */
  phase: 'gather' | 'talking' | 'closing'
  startedAt: number
  /** 结束时间戳（ms） */
  endsAt: number
}

export interface Kpis {
  total: number
  running: number
  blocked: number
  done: number
  avgMin: number
  tokens: number
  progress: number
  inMeeting: number
}

export interface DeptLoad {
  id: string
  running: number
  total: number
  error: number
  meeting: number
}

export interface Snapshot {
  kpis: Kpis
  agents: Agent[]
  tasks: Task[]
  events: Ev[]
  deptLoad: DeptLoad[]
  meeting: Meeting | null
  ts: number
}
