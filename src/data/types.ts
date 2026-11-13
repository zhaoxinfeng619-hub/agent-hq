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
  /** 真实接入时绑定的外部 agent id（外部运行时给的名字） */
  extId?: string | null
  /** 绑定前的岗位名，解绑时还原 */
  baseName?: string
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
  /** mock = 内置演出；live = 外部事件流驱动 */
  mode: 'mock' | 'live'
  /** live 连接状态 */
  link: 'off' | 'connecting' | 'on' | 'lost'
}

/** 外部事件契约（bridge 推送的原样 JSON） */
export type LiveKind =
  | 'agent.spawn'
  | 'agent.start'
  | 'tool'
  | 'progress'
  | 'agent.done'
  | 'agent.error'
  | 'agent.idle'
  | 'subagent.spawn'
  | 'meeting.start'
  | 'meeting.end'
  | 'reset'

export interface LiveEvent {
  type: LiveKind
  /** 外部 agent id（必填，除 meeting.* / reset） */
  agent?: string
  /** subagent.spawn 时的父 agent 外部 id */
  parent?: string
  /** 归到哪个房间：dept id（eng / product…），缺省按席位池轮转 */
  dept?: string
  /** 任务标题 */
  task?: string
  /** 当前工具名 */
  tool?: string
  /** 进度 0..1 */
  p?: number
  /** 错误信息 / 事件文案 */
  msg?: string
  /** meeting.* 的参与者（外部 id） */
  agents?: string[]
  topic?: string
  /** meeting 持续毫秒 */
  ms?: number
  /** agent.done 时的 token 消耗 */
  tokens?: number
}
