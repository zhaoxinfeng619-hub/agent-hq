#!/usr/bin/env node
/**
 * analyst —— 部门 eng
 * 真实职责：对 metrics.json 做真实统计与规则判定，输出周报的洞察与风险段。
 * 每一条结论都由具体数字支撑，规则命中即输出，不命中就不输出（不凑字数）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { identify, tracedTool, progress, done, fail, emit } from '../lib/emit.mjs'

const ID = process.env.AGENT_ID ?? 'digest.analyst'
const DEPT = 'eng'
const OUT = path.resolve(process.cwd(), 'out')

async function main() {
  await identify(ID, DEPT)

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
  await progress(ID, DEPT, 0.2, '指标已载入')

  // ---- 真实计算 ----
  const dayCount = Object.keys(m.byDay).length || 1
  const perDay = m.commits / dayCount
  const authors = Object.keys(m.byAuthor)
  const authorMax = Math.max(...Object.values(m.byAuthor), 0)
  const concentration = m.commits ? authorMax / m.commits : 0
  const churn = m.insertions + m.deletions
  const net = m.insertions - m.deletions
  const delRatio = churn ? m.deletions / churn : 0

  await tracedTool(ID, DEPT, 'stats.compute', async () => null, `日均 ${perDay.toFixed(1)} · 作者 ${authors.length} · 净增 ${net}`)
  await progress(ID, DEPT, 0.5, '趋势已算出')

  // ---- 规则判定（命中才写） ----
  const risks = []
  if (authors.length === 1 && m.commits > 0) {
    risks.push(`**巴士因子 = 1**：${m.range.days} 天内全部 ${m.commits} 次提交来自同一人（${authors[0]}），任一中途离场即停摆。`)
  } else if (concentration >= 0.7 && authors.length > 1) {
    risks.push(`**作者集中度过高**：${authors[0] ?? '首要作者'} 承担了 ${(concentration * 100).toFixed(0)}% 的提交。`)
  }
  if (delRatio > 0.45) {
    risks.push(`**删除占比异常**：删除 ${m.deletions} 行、占比 ${(delRatio * 100).toFixed(0)}%，像是重写而非增量推进。`)
  }
  if (m.commits === 0) {
    risks.push(`**本期零提交**：最近 ${m.range.days} 天窗口内没有任何提交，日报内容为空。`)
  }
  const hot = m.topFiles[0]
  if (hot && hot.n >= 3) {
    risks.push(`**热点文件**：\`${hot.file}\` 在 ${dayCount} 个活跃日里被改 ${hot.n} 次，建议拆分或补测试。`)
  }

  // 工作区层面的判断（数据来自 collector 的真实遍历）
  const w = m.workspace
  if (w) {
    const staleRatio = w.projects ? 1 - w.activeProjects / w.projects : 0
    if (staleRatio >= 0.75) {
      risks.push(
        `**项目腐化风险**：${w.projects} 个项目里只有 ${w.activeProjects} 个在近 ${m.range.days} 天有变更，` +
          `${(staleRatio * 100).toFixed(0)}% 处于停滞状态，建议归档或明确下线。`
      )
    }
    const biggest = w.top[0]
    if (biggest && w.bytes && biggest.mb / (w.bytes / 1048576) >= 0.5) {
      risks.push(`**体积集中**：\`${biggest.name}\` 占工作区总体积的 ${((biggest.mb / (w.bytes / 1048576)) * 100).toFixed(0)}%，注意构建产物入库问题。`)
    }
  }
  if (!risks.length) risks.push('未命中任何风险规则（提交分散、增删均衡、无单一热点文件）。')

  await emit({ type: 'tool', agent: ID, dept: DEPT, tool: 'rules.eval', msg: `命中 ${risks.length} 条` })
  await progress(ID, DEPT, 0.75, `${risks.length} 条判断`)

  // ---- 输出 ----
  const L = []
  L.push('# 本周工程洞察')
  L.push('')
  L.push('## 关键指标（真实统计）')
  L.push('')
  L.push('| 指标 | 数值 |')
  L.push('| --- | --- |')
  L.push(`| 提交总数 | ${m.commits} |`)
  L.push(`| 活跃天数 | ${dayCount} |`)
  L.push(`| 日均提交 | ${perDay.toFixed(1)} |`)
  L.push(`| 增 / 删 | +${m.insertions} / -${m.deletions} |`)
  L.push(`| 净增行数 | ${net >= 0 ? '+' : ''}${net} |`)
  L.push(`| 涉及文件 | ${m.filesTouched} |`)
  L.push(`| 参与作者 | ${authors.length} |`)
  if (m.workspace) {
    L.push(`| 工作区文件 | ${m.workspace.files.toLocaleString('en-US')} |`)
    L.push(`| 工作区体积 | ${(m.workspace.bytes / 1048576).toFixed(0)} MB |`)
    L.push(`| 项目 / 活跃 | ${m.workspace.projects} / ${m.workspace.activeProjects} |`)
  }
  L.push('')
  L.push('## 改动热点')
  L.push('')
  for (const f of m.topFiles.slice(0, 5)) {
    const bar = '█'.repeat(Math.min(16, f.n * 3))
    L.push(`- \`${f.file}\` ${bar} ${f.n}`)
  }
  L.push('')
  L.push('## 风险与建议')
  L.push('')
  for (const r of risks) L.push(`- ${r}`)
  L.push('')

  const md = L.join('\n')
  await tracedTool(ID, DEPT, 'file.write', async () => fs.writeFileSync(path.join(OUT, 'insights.md'), md), `写 out/insights.md（${md.length} 字）`)

  await progress(ID, DEPT, 1, `洞察 ${md.length} 字`)
  await done(ID, DEPT, { tokens: 0, artifacts: ['out/insights.md'] })
  console.log(`[analyst] ${risks.length} risks, ${md.length} chars → out/insights.md`)
}

main().catch(async (e) => {
  await fail(ID, DEPT, String(e.message ?? e))
  console.error(e)
  process.exit(1)
})
