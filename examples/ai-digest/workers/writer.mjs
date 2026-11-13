#!/usr/bin/env node
/**
 * writer —— 部门 product
 * 真实职责：读 collector 产出的 metrics.json，逐天生成日报正文。
 * 依赖真实数据：metrics.json 不存在就直接报错退出（不兜底造假）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { identify, tracedTool, progress, done, fail, emit } from '../lib/emit.mjs'

const ID = process.env.AGENT_ID ?? 'digest.writer'
const DEPT = 'product'
const OUT = path.resolve(process.cwd(), 'out')

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 把提交标题归到一条"人话"上：去掉 conventional commit 前缀，动词化 */
function humanize(subject) {
  const s = subject.replace(/^(feat|fix|docs|chore|refactor|ci|test|style|perf)(\([^)]+\))?:\s*/i, '')
  return s.trim() || subject
}

function bucketOf(subject) {
  const t = subject.toLowerCase()
  if (/^feat|add|新增|实现|support/.test(t)) return 'feature'
  if (/^fix|bug|修复|hotfix/.test(t)) return 'fix'
  if (/^docs|readme|文档/.test(t)) return 'doc'
  if (/^ci|deploy|workflow|部署/.test(t)) return 'infra'
  if (/^refactor|重构|cleanup/.test(t)) return 'refactor'
  return 'misc'
}

async function main() {
  await identify(ID, DEPT)

  // 1) 真读上游产物；没有就失败（说明依赖顺序被破坏）
  const m = await tracedTool(
    ID,
    DEPT,
    'file.read',
    async () => {
      const p = path.join(OUT, 'metrics.json')
      if (!fs.existsSync(p)) throw new Error('metrics.json 不存在：collector 还没跑完')
      return JSON.parse(fs.readFileSync(p, 'utf8'))
    },
    '读取 out/metrics.json'
  )
  await progress(ID, DEPT, 0.15, `已载入 ${m.commits} 个提交`)

  // 2) 按天重组：真的按日期分组、排序，逐天写
  const days = Object.keys(m.byDay).sort()
  const lines = []
  lines.push(`# ${m.repo} 工作日报`)
  lines.push('')
  lines.push(`> 区间：最近 ${m.range.days} 天 · 分支 \`${m.branch}\` · HEAD \`${m.head}\``)
  lines.push('> 数据来源：git 历史真实统计，由 collector 生成于 ' + new Date(m.generatedAt).toLocaleString('zh-CN'))
  lines.push('')

  for (let i = 0; i < days.length; i++) {
    const d = days[i]
    const list = m.recent.filter((c) => c.date === d)
    const wd = WEEKDAY[new Date(`${d}T12:00:00`).getDay()]
    lines.push(`## ${d} ${wd} · ${m.byDay[d]} 次提交`)
    lines.push('')
    if (!list.length) {
      lines.push('- 当天无记录（近期窗口截断，详见 git log）')
    } else {
      for (const c of list) {
        lines.push(`- **${humanize(c.subject)}** — ${c.author} \`${c.hash}\` · ${c.files} 个文件`)
      }
    }
    lines.push('')
    await emit({ type: 'progress', agent: ID, dept: DEPT, p: 0.15 + (0.75 * (i + 1)) / Math.max(1, days.length), msg: `已写 ${d}` })
  }

  // 3) 项目活跃度（来自 collector 真实遍历目录的结果）
  if (m.workspace) {
    const w = m.workspace
    lines.push('## 工作区盘点')
    lines.push('')
    lines.push(`- 扫描根目录：\`${path.basename(m.scanRoot ?? '')}\``)
    lines.push(`- 文件总数：${w.files.toLocaleString('en-US')} · 总体积：${(w.bytes / 1048576).toFixed(0)} MB · 项目数：${w.projects}`)
    lines.push(`- 近 ${m.range.days} 天有变更的项目：**${w.activeProjects}** 个`)
    lines.push('')
    lines.push('| 项目 | 文件 | 体积 | 近 ' + m.range.days + ' 天变更 | 最后活动 |')
    lines.push('| --- | --- | --- | --- | --- |')
    for (const p of w.top.slice(0, 8)) {
      lines.push(`| ${p.name} | ${p.files} | ${p.mb} MB | ${p.recentFiles} | ${p.last} |`)
    }
    lines.push('')
    if (w.extStat?.length) {
      lines.push('文件类型分布：' + w.extStat.map(([e, n]) => `\`${e || '(无后缀)'}\` ${n}`).join(' · '))
      lines.push('')
    }
    await emit({ type: 'progress', agent: ID, dept: DEPT, p: 0.85, msg: `项目盘点 ${w.projects} 个` })
  }

  // 4) 分类汇总（真实按前缀归类，不是随机）
  const buckets = {}
  for (const c of m.recent) {
    const b = bucketOf(c.subject)
    buckets[b] = buckets[b] ?? []
    buckets[b].push(humanize(c.subject))
  }
  const label = { feature: '新功能', fix: '修复', doc: '文档', infra: '工程化', refactor: '重构', misc: '其他' }
  lines.push('## 类型分布')
  lines.push('')
  lines.push('| 类型 | 条数 | 占比 |')
  lines.push('| --- | --- | --- |')
  const total = m.recent.length || 1
  for (const k of ['feature', 'fix', 'refactor', 'infra', 'doc', 'misc']) {
    if (!buckets[k]) continue
    lines.push(`| ${label[k]} | ${buckets[k].length} | ${((buckets[k].length / total) * 100).toFixed(0)}% |`)
  }
  lines.push('')

  // 5) 真写盘
  const md = lines.join('\n')
  await tracedTool(ID, DEPT, 'file.write', async () => fs.writeFileSync(path.join(OUT, 'daily.md'), md), `写 out/daily.md（${md.length} 字）`)

  await progress(ID, DEPT, 1, `日报 ${days.length} 天 / ${md.length} 字`)
  await done(ID, DEPT, { tokens: 0, artifacts: ['out/daily.md'] })
  console.log(`[writer] ${days.length} 天, ${md.length} chars → out/daily.md`)
}

main().catch(async (e) => {
  await fail(ID, DEPT, String(e.message ?? e))
  console.error(e)
  process.exit(1)
})
