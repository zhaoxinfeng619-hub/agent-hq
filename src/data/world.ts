import type { Agent, Dept, Ev, Kpis, LiveEvent, Meeting, Snapshot, Task } from './types'

/* ------------------------------------------------------------------ 房间 / 部门 */

export const DEPTS: Dept[] = [
  { id: 'product', name: '产品部', short: '产品', color: '#4AA8FF', row: 0, col: 0, colSpan: 1, kind: 'dept' },
  { id: 'design', name: '设计部', short: '设计', color: '#FF7AC6', row: 0, col: 1, colSpan: 1, kind: 'dept' },
  { id: 'eng', name: '研发部', short: '研发', color: '#8B7CFF', row: 0, col: 2, colSpan: 1, kind: 'dept' },
  { id: 'market', name: '市场部', short: '市场', color: '#FF7A2F', row: 0, col: 3, colSpan: 1, kind: 'dept' },
  { id: 'ops', name: '运营部', short: '运营', color: '#2FE6D0', row: 1, col: 0, colSpan: 1, kind: 'dept' },
  { id: 'hr', name: '招聘部', short: '招聘', color: '#35E08B', row: 1, col: 1, colSpan: 1, kind: 'dept' },
  { id: 'fin', name: '财务部', short: '财务', color: '#FFD166', row: 2, col: 0, colSpan: 1, kind: 'dept' },
  { id: 'cs', name: '客服部', short: '客服', color: '#7FD8FF', row: 2, col: 1, colSpan: 1, kind: 'dept' },
  { id: 'data', name: '数据部', short: '数据', color: '#FF9E7A', row: 2, col: 2, colSpan: 1, kind: 'dept' },
  { id: 'strat', name: '战略部', short: '战略', color: '#A8E063', row: 2, col: 3, colSpan: 1, kind: 'dept' },
  /* 前排：总监办公室 + 会议室 */
  { id: 'director', name: '总监办公室', short: '总监', color: '#FFC24B', row: 3, col: 0, colSpan: 2, kind: 'director' },
  { id: 'meeting', name: '会议室', short: '会议', color: '#5AD1E8', row: 3, col: 2, colSpan: 2, kind: 'meeting' },
]

/** 业务部门（不含总监室 / 会议室） */
export const BIZ_DEPTS = DEPTS.filter((d) => d.kind === 'dept')

const ROLES: Record<string, string[]> = {
  product: ['需求拆解', '竞品雷达', '用户访谈', 'PRD 撰写', '埋点设计', '增长实验'],
  design: ['视觉稿', '组件库', '动效稿', '图标规范', '空状态'],
  eng: ['接口联调', '索引重建', '单测补全', '流水线修复', '依赖升级', '性能剖析'],
  market: ['价格周报', '渠道复盘', '选题池', '通稿撰写', 'SEO 词库'],
  ops: ['活动校对', '分层触达', '内容抽检', '留存归因', '社群策划'],
  hr: ['简历初筛', '面试出题', '背景调查', 'JD 重写'],
  fin: ['毛利测算', '成本分摊', '预算偏差', '回款跟踪'],
  cs: ['工单聚类', '话术更新', '投诉归因', '知识库补全'],
  data: ['漏斗校验', '口径对齐', '波动归因', 'AB 显著性'],
  strat: ['赛道扫描', '融资追踪', '假设推演', '组织建议'],
  director: ['总控调度'],
}

const TASKS: Record<string, string[]> = {
  product: ['智能定价器 · 需求文档 v3', '竞品价格带横向对比', '企业问答助手 · 访谈纪要', '内容审核 Agent · 埋点方案', 'AI PM 工具 · 增长实验设计', '月度路线图复盘'],
  design: ['定价器结果页视觉稿', '组件库暗色规范对齐', '空状态与骨架屏插画', 'Agent 详情页交互动效', '图标集删减与统一', '大屏首屏信息层级稿'],
  eng: ['工单聚类接口联调', 'RAGFlow 索引重建', '审核链路单测补全', 'CI 流水线偶发失败修复', 'Electron 依赖安全升级', '首屏渲染性能剖析'],
  market: ['Q4 竞品价格周报', 'B 站渠道投放复盘', '社媒选题池 · 40 条', '发布会通稿初稿', 'SEO 长尾词库扩展', '竞对融资动作追踪'],
  ops: ['双十一活动规则校对', '高价值用户分层触达', '课程内容抽检 · 200 条', '次留下滑归因分析', '社群话题周策划', '会员权益配置核查'],
  hr: ['前端岗简历初筛 · 32 份', 'AI 产品岗面试题库', '候选人文档背景核查', '岗位 JD 重写（三版）'],
  fin: ['AI PM 薪酬毛利测算', '云成本分摊表重算', '季度预算偏差分析', '渠道回款跟踪'],
  cs: ['客诉工单主题聚类', '退款话术库更新', '投诉升级归因', '帮助中心知识补全'],
  data: ['定价漏斗埋点校验', '指标口径对齐（GMV）', '转化异常波动归因', 'AB 实验显著性复核'],
  strat: ['AI Agent 赛道扫描', '竞对融资与估值追踪', '三年收入假设推演', '外部合作方能力评估'],
  director: ['全局任务编排 · 48 agent', '算力预算重分配', '异常根因复盘', '上线决策复核', 'SLA 周度审计', '跨部门协同调度'],
}

const MEETING_TOPICS = [
  '定价策略对齐',
  '审核链路复盘',
  '发布窗口确认',
  '指标口径拉齐',
  'Q4 资源分配',
  '异常根因会诊',
  '内容规范评审',
]

const ERRORS = ['工具调用超时', '上下文超限', 'schema 校验失败', '上游 429 限流', '文件写入被拒']

const TOOLS = ['web.search', 'python.exec', 'file.read', 'sql.query', 'playwright', 'doc.write', 'llm.vision', 'http.fetch']

const AGENT_COUNT: Record<string, number> = {
  product: 6, design: 5, eng: 6, market: 5, ops: 5, hr: 4, fin: 4, cs: 4, data: 4, strat: 4,
  director: 1, meeting: 0,
}

/* ------------------------------------------------------------------ 工具 */

let seq = 0
const uid = (p: string) => `${p}_${(++seq).toString(36)}`
const rand = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]

const now = () => Date.now()

/** 一次 tick 的时长（与 start() 的 interval 保持一致） */
const TICK_MS = 420

/* ------------------------------------------------------------------ 世界 */

class World {
  version = 0
  agents: Agent[] = []
  tasks: Task[] = []
  byId = new Map<string, Task>()
  events: Ev[] = []
  meeting: Meeting | null = null

  /** mock = 内置演出；live = 外部事件流驱动 */
  mode: 'mock' | 'live' = 'mock'
  link: 'off' | 'connecting' | 'on' | 'lost' = 'off'
  /** 外部 agent id → 座位上的 agent */
  private extToAgent = new Map<string, Agent>()
  /** 外部 agent 最近一次事件的墙钟时间，用于回收座位 */
  private lastSeen = new Map<string, number>()
  /** 父 → 子 的协作关系（索引指向 agents），场景据此画流动光点 */
  links: { from: number; to: number; born: number; until: number }[] = []
  /** 外部 id 的父子关系，页面中途接入也能重建连线 */
  private parentOf = new Map<string, string>()

  doneCount = 0
  failedCount = 0
  totalCount = 0
  tokens = 0
  durSum = 0
  durCnt = 0

  /** 下一次注入故障的时间（毫秒时间戳） */
  private nextChaosAt = 0
  /** 下一次开会时间 */
  private nextMeetingAt = 0
  /** 单个 agent 从异常中恢复的时间 */
  private recoverAt = new Map<string, number>()
  /** 存在 taskId 但被会议打断的 agent */
  private timers = new Map<string, number>()
  private tickHandle: number | null = null
  private subs = new Set<() => void>()
  private clock = 0

  private loadVersion = -1
  private loadCache: { id: string; running: number; total: number; error: number; meeting: number }[] = []

  constructor() {
    this.seed()
    this.recomputeLoad()
  }

  private seed() {
    this.doneCount = 126
    this.totalCount = 240
    this.tokens = 5_240_000
    this.durSum = 126 * 11.4
    this.durCnt = 126

    for (const d of DEPTS) {
      const n = AGENT_COUNT[d.id] ?? 0
      const roles = ROLES[d.id] ?? ['Agent']
      for (let i = 0; i < n; i++) {
        this.agents.push({
          id: `${d.id}-${i}`,
          deptId: d.id,
          name: roles[i % roles.length],
          status: 'standby',
          deskIndex: i,
          taskId: null,
          tokens: Math.round(rand(18_000, 190_000)),
          startedAt: null,
          heat: 0,
          seatIndex: null,
          role: d.kind === 'director' ? 'director' : 'member',
        })
      }
    }

    // 开局：主业部门约 7 成 agent 在跑，总监常亮
    for (const a of this.agents) {
      if (a.role === 'director') {
        this.startTask(a)
        continue
      }
      if (Math.random() < 0.72) this.startTask(a)
      else this.timers.set(a.id, this.clock + rand(2, 8))
    }

    this.nextChaosAt = now() + rand(18_000, 28_000)
    this.nextMeetingAt = now() + rand(12_000, 18_000)
  }

  private deptOf(id: string) {
    return DEPTS.find((d) => d.id === id)!
  }

  private startTask(a: Agent, title?: string) {
    const d = this.deptOf(a.deptId)
    const t: Task = {
      id: uid('t'),
      deptId: a.deptId,
      agentId: a.id,
      title: title ?? pick(TASKS[a.deptId] ?? ['待分配任务']),
      summary: a.name,
      status: 'running',
      progress: Math.random() * 12,
      createdAt: now(),
      finishedAt: null,
      durationMs: 0,
      tool: pick(TOOLS),
      tokens: 0,
    }
    a.status = 'running'
    a.taskId = t.id
    a.startedAt = now()
    this.tasks.unshift(t)
    this.byId.set(t.id, t)
    if (this.tasks.length > 220) {
      for (const old of this.tasks.splice(200)) this.byId.delete(old.id)
    }
    this.totalCount++
    this.push({ kind: 'start', deptId: d.id, agentId: a.id, taskId: t.id, text: `${a.name} 开始 ${t.title}` })
    this.touch()
  }

  private finishTask(a: Agent, realTokens?: number) {
    const t = a.taskId ? this.byId.get(a.taskId) : null
    const d = this.deptOf(a.deptId)
    if (t) {
      t.status = this.mode === 'live' ? 'done' : Math.random() < 0.14 ? 'review' : 'done'
      t.progress = 100
      t.finishedAt = now()
      t.durationMs = t.finishedAt - t.createdAt
      t.tokens = realTokens ?? Math.round(rand(12_000, 96_000))
      this.doneCount++
      this.durSum += t.durationMs / 60000
      this.durCnt++
      this.push({ kind: 'done', deptId: d.id, agentId: a.id, taskId: t.id, text: `${a.name} 交付 ${t.title}` })
    }
    a.status = 'standby'
    a.taskId = null
    a.startedAt = null
    a.tokens += realTokens ?? Math.round(rand(8_000, 40_000))
    // 总监不休息：马上派下一个（live 模式由外部事件决定，不自己派活）
    if (this.mode === 'mock') this.timers.set(a.id, this.clock + (a.role === 'director' ? rand(1, 3) : rand(3, 12)))
    this.touch()
  }

  private failTask(a: Agent, reason?: string) {
    const t = a.taskId ? this.byId.get(a.taskId) : null
    const d = this.deptOf(a.deptId)
    if (t) {
      t.status = 'failed'
      t.progress = Math.min(t.progress, 96)
      t.finishedAt = now()
      t.durationMs = t.finishedAt - t.createdAt
      t.error = reason ?? pick(ERRORS)
      this.failedCount++
      this.push({
        kind: 'error',
        deptId: d.id,
        agentId: a.id,
        taskId: t.id,
        text: `${a.name} 异常 · ${t.error}`,
      })
    }
    a.status = 'error'
    a.startedAt = a.startedAt ?? now()
    // 8~14 秒后自动恢复（live 模式等外部发 retry / start 事件）
    if (this.mode === 'mock') this.recoverAt.set(a.id, now() + rand(8_000, 14_000))
    this.touch()
  }

  private recover(a: Agent) {
    this.recoverAt.delete(a.id)
    const d = this.deptOf(a.deptId)
    a.status = 'standby'
    a.taskId = null
    this.startTask(a)
    this.push({ kind: 'retry', deptId: d.id, agentId: a.id, taskId: a.taskId ?? '', text: `${a.name} 已恢复重试` })
    this.touch()
  }

  private push(e: Omit<Ev, 'id' | 'ts'>) {
    this.events.unshift({ ...e, id: uid('e'), ts: now() })
    if (this.events.length > 90) this.events.length = 90
  }

  private touch() {
    this.version++
  }

  private countStatus(s: Agent['status']) {
    let n = 0
    for (const a of this.agents) if (a.status === s) n++
    return n
  }

  /* ---------------------------------------------------------------- 会议 */

  private startMeeting() {
    const seats = 6
    const candidates = this.agents.filter(
      (a) => a.role === 'member' && (a.status === 'running' || a.status === 'standby')
    )
    if (candidates.length < 3) return

    // 尽量跨部门挑人
    const chosen: Agent[] = []
    const usedDept = new Set<string>()
    const shuffled = candidates.slice().sort(() => Math.random() - 0.5)
    for (const a of shuffled) {
      if (chosen.length >= 3 + Math.floor(Math.random() * 2)) break
      if (usedDept.has(a.deptId) && chosen.length < 3) continue
      usedDept.add(a.deptId)
      chosen.push(a)
    }

    // 总监作为主持人，六成概率亲自到场
    const director = this.agents.find((a) => a.role === 'director')
    if (director && Math.random() < 0.6) chosen.unshift(director)

    const seatsOrder = [0, 1, 2, 3, 4, 5]
    chosen.slice(0, seats).forEach((a, i) => {
      a.seatIndex = seatsOrder[i]
      if (a.status !== 'error') a.status = 'meeting'
    })

    const deptIds = Array.from(new Set(chosen.map((a) => a.deptId)))
    const topic = pick(MEETING_TOPICS)
    const duration = rand(15_000, 21_000)

    this.meeting = {
      id: uid('m'),
      topic,
      agentIds: chosen.map((a) => a.id),
      deptIds,
      phase: 'gather',
      startedAt: now(),
      endsAt: now() + duration,
    }

    this.push({
      kind: 'meeting',
      deptId: 'meeting',
      agentId: director && chosen[0] === director ? director.id : chosen[0].id,
      taskId: '',
      text: `召集会议 · ${topic}（${chosen.length} 人）`,
    })
    this.touch()
  }

  private endMeeting() {
    const m = this.meeting
    if (!m) return
    const participants = this.agents.filter((a) => m.agentIds.includes(a.id))
    for (const a of participants) {
      a.seatIndex = null
      if (a.status === 'meeting') {
        if (a.taskId && this.byId.get(a.taskId)?.status === 'running') {
          a.status = 'running'
        } else {
          a.status = 'standby'
          if (this.mode === 'mock') this.timers.set(a.id, this.clock + rand(2, 6))
        }
      }
    }
    this.push({
      kind: 'done',
      deptId: 'meeting',
      agentId: participants[0]?.id ?? '',
      taskId: '',
      text: `会议结束 · ${m.topic}，决议已归档`,
    })
    this.meeting = null
    this.touch()
  }

  /* ---------------------------------------------------------------- 主循环 */

  tick() {
    this.clock++
    const wall = now()

    // live：回收长期无事件的座位，避免 48 席被历史 agent 占满
    if (this.mode === 'live' && this.clock % 24 === 0) this.gcBindings()

    // 会议开场 / 散会
    if (this.meeting) {
      if (wall >= this.meeting.endsAt) this.endMeeting()
      else if (this.meeting.phase === 'gather' && wall - this.meeting.startedAt > 3200) {
        this.meeting.phase = 'talking'
        this.touch()
      }
    } else if (this.mode === 'mock' && wall >= this.nextMeetingAt) {
      this.startMeeting()
      this.nextMeetingAt = wall + rand(42_000, 72_000)
    }

    // 混沌注入：有节奏地出一次故障，而不是每帧掷骰子（live 模式由真实错误驱动）
    if (this.mode === 'mock' && wall >= this.nextChaosAt) {
      this.nextChaosAt = wall + rand(36_000, 68_000)
      const busy = this.agents.filter((a) => a.status === 'running' && a.role === 'member')
      if (this.countStatus('error') < 2 && busy.length > 0) {
        this.failTask(pick(busy))
      }
    }

    for (const a of this.agents) {
      if (a.status === 'meeting') {
        a.heat = Math.min(1, a.heat + 0.06)
        continue
      }
      if (a.status === 'error') {
        a.heat = Math.max(0, a.heat - 0.06)
        const due = this.recoverAt.get(a.id)
        if (due !== undefined && wall >= due) this.recover(a)
        continue
      }
      if (a.status === 'running') {
        const t = a.taskId ? this.byId.get(a.taskId) : null
        if (t) {
          // live 模式进度只认外部 progress 事件，这里不再自己涨
          if (this.mode === 'mock') {
            t.progress = Math.min(100, t.progress + rand(1.4, 4.6))
            a.tokens += Math.round(rand(160, 1400))
            this.tokens += Math.round(rand(160, 1400))
            if (Math.random() < 0.02) {
              this.push({
                kind: 'tool',
                deptId: a.deptId,
                agentId: a.id,
                taskId: t.id,
                text: `${a.name} 调用 ${t.tool}`,
              })
            }
            if (t.progress >= 100) this.finishTask(a)
          }
        } else if (this.mode === 'mock') {
          this.finishTask(a)
        }
        a.heat = Math.min(1, a.heat + 0.12)
      } else {
        a.heat = Math.max(0, a.heat - 0.05)
        const due = this.timers.get(a.id)
        if (due !== undefined && this.clock >= due) {
          this.timers.delete(a.id)
          this.startTask(a)
        }
      }
    }

    this.touch()
    this.subs.forEach((fn) => fn())
  }

  start(intervalMs = TICK_MS) {
    if (this.tickHandle !== null) return
    this.tickHandle = window.setInterval(() => this.tick(), intervalMs)
  }

  subscribe(fn: () => void) {
    this.subs.add(fn)
    return () => this.subs.delete(fn)
  }

  /** 手动重试：给详情抽屉的按钮用 */
  retryAgent(id: string) {
    const a = this.agents.find((x) => x.id === id)
    if (!a || a.status === 'running' || a.status === 'meeting') return
    this.timers.delete(a.id)
    this.recoverAt.delete(a.id)
    if (a.status === 'error') this.recover(a)
    else this.startTask(a)
    this.subs.forEach((fn) => fn())
  }

  /* ---------------------------------------------------------------- 真实接入 */

  /** 切到 live：清空演出内容，等外部事件来驱动 */
  goLive() {
    if (this.mode === 'live') return
    this.mode = 'live'
    this.link = 'connecting'
    this.extToAgent.clear()
    this.lastSeen.clear()
    this.parentOf.clear()
    this.links.length = 0
    this.meeting = null
    this.tasks.length = 0
    this.byId.clear()
    this.events.length = 0
    this.doneCount = 0
    this.failedCount = 0
    this.totalCount = 0
    this.tokens = 0
    this.durSum = 0
    this.durCnt = 0
    this.timers.clear()
    this.recoverAt.clear()
    for (const a of this.agents) {
      a.status = 'standby'
      a.taskId = null
      a.startedAt = null
      a.seatIndex = null
      a.tokens = 0
      a.extId = null
    }
    this.touch()
    this.subs.forEach((fn) => fn())
  }

  setLink(s: 'off' | 'connecting' | 'on' | 'lost') {
    this.link = s
    this.touch()
    this.subs.forEach((fn) => fn())
  }

  /**
   * 外部 agent id → 座位。同一个外部 id 永远落在同一个座位（视觉连续性）；
   * 座位池固定 48 席，满了就顶掉最久没活动的那个。
   */
  private bind(extId: string, deptId?: string): Agent {
    const hit = this.extToAgent.get(extId)
    if (hit) return hit

    // 编排者 / 总监：直接坐总监办公室那把大班台
    if (deptId === 'director') {
      const dir = this.agents.find((a) => a.role === 'director')
      if (dir) {
        if (dir.extId) this.extToAgent.delete(dir.extId)
        dir.extId = extId
        this.extToAgent.set(extId, dir)
        return dir
      }
    }

    const members = this.agents.filter((a) => a.role === 'member')
    const inDept = deptId ? members.filter((a) => a.deptId === deptId) : []
    const freeInDept = inDept.find((a) => !a.extId)
    const freeAny = members.find((a) => !a.extId)
    const target =
      freeInDept ??
      freeAny ??
      // 池满：优先顶掉 standby / 已结束的
      inDept.find((a) => a.status === 'standby') ??
      members.find((a) => a.status === 'standby') ??
      members.reduce((x, y) => ((x.startedAt ?? 0) <= (y.startedAt ?? 0) ? x : y))

    // 顶掉旧绑定
    if (target.extId) this.extToAgent.delete(target.extId)
    if (target.baseName === undefined) target.baseName = target.name
    target.extId = extId
    // 用外部名字的末段当工位名，太长就截断
    const short = extId.replace(/^.*[/:]/, '').slice(0, 12)
    if (short) target.name = short
    this.extToAgent.set(extId, target)
    this.lastSeen.set(extId, now())
    return target
  }

  /** 释放超时未活跃的绑定，把座位还回池子（真实接入里 agent 是有生命周期的） */
  private gcBindings() {
    const wall = now()
    for (const [extId, a] of this.extToAgent) {
      if (a.status === 'running' || a.status === 'meeting') continue
      const seen = this.lastSeen.get(extId) ?? 0
      if (wall - seen < 25_000) continue
      this.extToAgent.delete(extId)
      this.lastSeen.delete(extId)
      this.parentOf.delete(extId)
      a.extId = null
      if (a.baseName) a.name = a.baseName
      a.status = 'standby'
      a.taskId = null
      a.startedAt = null
      a.heat = 0
      if (this.mode === 'live') this.touch()
    }
    this.refreshLinks()
  }

  private linkOf(parent?: string, child?: string) {
    if (!parent || !child) return
    this.parentOf.set(child, parent)
    this.refreshLinks()
  }

  /** 从 parentOf 重建连线：只画两端都还坐在座位上的关系 */
  private refreshLinks() {
    const t = now()
    const out: { from: number; to: number; born: number; until: number }[] = []
    for (const [child, parent] of this.parentOf) {
      const a = this.extToAgent.get(parent)
      const b = this.extToAgent.get(child)
      if (!a || !b) continue
      const from = this.agents.indexOf(a)
      const to = this.agents.indexOf(b)
      if (from < 0 || to < 0 || from === to) continue
      out.push({ from, to, born: t, until: t + 600_000 })
      if (out.length >= 12) break
    }
    this.links = out
  }

  /** 外部事件 → 场景状态。这是接真实 runtime 的唯一入口 */
  applyEvent(ev: LiveEvent) {
    if (this.mode !== 'live') this.goLive()
    const t = now()

    switch (ev.type) {
      case 'reset': {
        this.mode = 'mock'
        this.link = 'off'
        this.links.length = 0
        this.meeting = null
        this.extToAgent.clear()
        for (const a of this.agents) {
          a.extId = null
          a.seatIndex = null
          if (a.status === 'meeting') a.status = 'standby'
          this.timers.set(a.id, this.clock + rand(1, 6))
        }
        this.touch()
        this.subs.forEach((fn) => fn())
        return
      }
      case 'meeting.start': {
        const ids = ev.agents ?? []
        if (ids.length < 2) return
        this.startMeetingWith(ids, ev.topic ?? '协同会诊', ev.ms ?? 18_000)
        return
      }
      case 'meeting.end': {
        this.endMeeting()
        return
      }
      case 'subagent.spawn': {
        if (!ev.agent) return
        const child = this.bind(ev.agent, ev.dept)
        this.linkOf(ev.parent, ev.agent)
        this.push({
          kind: 'start',
          deptId: child.deptId,
          agentId: child.id,
          taskId: '',
          text: `${ev.parent ?? 'orchestrator'} 派出子 agent · ${child.name}`,
        })
        this.touch()
        this.subs.forEach((fn) => fn())
        return
      }
      default:
        break
    }

    if (!ev.agent) return
    const a = this.bind(ev.agent, ev.dept)
    this.lastSeen.set(ev.agent, t)

    switch (ev.type) {
      case 'agent.spawn':
      case 'agent.start': {
        if (ev.parent) this.linkOf(ev.parent, ev.agent)
        this.timers.delete(a.id)
        this.recoverAt.delete(a.id)
        if (a.status !== 'running' || !a.taskId) this.startTask(a, ev.task)
        break
      }
      case 'tool': {
        const task = a.taskId ? this.byId.get(a.taskId) : null
        if (task && ev.tool) task.tool = ev.tool
        this.push({
          kind: 'tool',
          deptId: a.deptId,
          agentId: a.id,
          taskId: a.taskId ?? '',
          text: ev.msg ?? `${a.name} 调用 ${ev.tool ?? 'tool'}`,
        })
        break
      }
      case 'progress': {
        const task = a.taskId ? this.byId.get(a.taskId) : null
        if (task && typeof ev.p === 'number') {
          task.progress = Math.max(task.progress, Math.min(99, ev.p * 100))
        }
        if (a.status === 'standby') this.startTask(a, ev.task)
        break
      }
      case 'agent.done': {
        this.finishTask(a, ev.tokens)
        break
      }
      case 'agent.error': {
        this.failTask(a, ev.msg)
        break
      }
      case 'agent.idle': {
        a.status = 'standby'
        a.taskId = null
        a.startedAt = null
        a.heat = 0
        break
      }
      default:
        return
    }

    this.refreshLinks()
    this.touch()
    this.subs.forEach((fn) => fn())
  }

  /** 指定参会人开会（live 用，不随机挑人） */
  private startMeetingWith(extIds: string[], topic: string, ms: number) {
    const chosen = extIds
      .map((id) => this.bind(id))
      .filter((a) => a.role === 'member')
      .slice(0, 6)
    if (chosen.length < 2) return
    if (this.meeting) this.endMeeting()

    chosen.forEach((a, i) => {
      a.seatIndex = i
      if (a.status !== 'error') a.status = 'meeting'
    })
    this.meeting = {
      id: uid('m'),
      topic,
      agentIds: chosen.map((a) => a.id),
      deptIds: Array.from(new Set(chosen.map((a) => a.deptId))),
      phase: 'gather',
      startedAt: now(),
      endsAt: now() + ms,
    }
    this.push({
      kind: 'meeting',
      deptId: 'meeting',
      agentId: chosen[0].id,
      taskId: '',
      text: `召集会议 · ${topic}（${chosen.length} 人）`,
    })
    this.touch()
    this.subs.forEach((fn) => fn())
  }

  /* ---------------------------------------------------------------- 调试 */

  /** 立刻召集一场会议（截图 / 演示用） */
  forceMeeting() {
    if (!this.meeting) this.startMeeting()
    this.subs.forEach((fn) => fn())
  }

  /** 立刻制造一次异常（截图 / 演示用） */
  forceError() {
    const busy = this.agents.filter((a) => a.status === 'running' && a.role === 'member')
    if (busy.length) this.failTask(busy[0])
    this.subs.forEach((fn) => fn())
  }

  /* ---------------------------------------------------------------- 读取 */

  private recomputeLoad() {
    const map = new Map<string, { id: string; running: number; total: number; error: number; meeting: number }>()
    for (const d of DEPTS) map.set(d.id, { id: d.id, running: 0, total: 0, error: 0, meeting: 0 })
    for (const a of this.agents) {
      const row = map.get(a.deptId)
      if (!row) continue
      row.total++
      if (a.status === 'running') row.running++
      if (a.status === 'error') row.error++
      if (a.status === 'meeting') row.meeting++
    }
    this.loadCache = DEPTS.map((d) => map.get(d.id)!)
    this.loadVersion = this.version
  }

  /** 带版本号的缓存：3D 每帧读它也不会产生分配 */
  deptLoad() {
    if (this.loadVersion !== this.version) this.recomputeLoad()
    return this.loadCache
  }

  kpis(): Kpis {
    let running = 0
    let blocked = 0
    let inMeeting = 0
    for (const a of this.agents) {
      if (a.status === 'running') running++
      else if (a.status === 'error') blocked++
      else if (a.status === 'meeting') inMeeting++
    }
    return {
      total: this.totalCount,
      running,
      blocked,
      done: this.doneCount,
      avgMin: this.durCnt ? this.durSum / this.durCnt : 0,
      tokens: this.tokens,
      progress: this.totalCount ? Math.min(100, (this.doneCount / this.totalCount) * 100) : 0,
      inMeeting,
    }
  }

  snapshot(): Snapshot {
    return {
      kpis: this.kpis(),
      agents: this.agents,
      tasks: this.tasks.slice(0, 60),
      events: this.events.slice(0, 40),
      deptLoad: this.deptLoad(),
      meeting: this.meeting ? { ...this.meeting } : null,
      ts: now(),
      mode: this.mode,
      link: this.link,
    }
  }
}

export const world = new World()
