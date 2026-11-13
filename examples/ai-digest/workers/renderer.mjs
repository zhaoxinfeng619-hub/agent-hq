#!/usr/bin/env node
/**
 * renderer —— 部门 design
 * 真实职责：把 daily.md + insights.md 合成一份可发的 HTML，并对数字做一致性校验。
 * 校验失败就发 agent.error（这条告警是真的：说明上游数据不一致）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { identify, tracedTool, progress, done, fail, emit, emitAsync } from '../lib/emit.mjs'

const ID = process.env.AGENT_ID ?? 'digest.renderer'
const DEPT = 'design'
const OUT = path.resolve(process.cwd(), 'out')

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])

/** 极简 md → html（只覆盖本项目用到的语法，避免引依赖） */
function md2html(md) {
  const out = []
  let inTable = false
  let inList = false
  const closeList = () => {
    if (inList) {
      out.push('</ul>')
      inList = false
    }
  }
  const closeTable = () => {
    if (inTable) {
      out.push('</tbody></table>')
      inTable = false
    }
  }
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      closeList()
      closeTable()
      continue
    }
    if (/^\|/.test(line)) {
      const cells = line.split('|').slice(1, -1).map((c) => c.trim())
      if (/^\|[\s:|-]+\|?$/.test(line)) continue
      if (!inTable) {
        closeList()
        out.push('<table><thead><tr>' + cells.map((c) => `<th>${esc(c)}</th>`).join('') + '</tr></thead><tbody>')
        inTable = true
      } else {
        out.push('<tr>' + cells.map((c) => `<td>${esc(c)}</td>`).join('') + '</tr>')
      }
      continue
    }
    closeTable()
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      closeList()
      out.push(`<h${h[1].length}>${esc(h[2])}</h${h[1].length}>`)
      continue
    }
    if (/^>\s?/.test(line)) {
      closeList()
      out.push(`<blockquote>${inline(esc(line.replace(/^>\s?/, '')))}</blockquote>`)
      continue
    }
    if (/^[-*]\s+/.test(line)) {
      if (!inList) {
        out.push('<ul>')
        inList = true
      }
      out.push(`<li>${inline(esc(line.replace(/^[-*]\s+/, '')))}</li>`)
      continue
    }
    closeList()
    out.push(`<p>${inline(esc(line))}</p>`)
  }
  closeList()
  closeTable()
  return out.join('\n')
}

/** 行内：**粗体** 和 `代码`（在已转义的文本上做） */
function inline(s) {
  return s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>')
}

async function main() {
  await identify(ID, DEPT)

  const read = (f) =>
    tracedTool(ID, DEPT, 'file.read', () => {
      const p = path.join(OUT, f)
      if (!fs.existsSync(p)) throw new Error(`${f} 不存在：上游还没产出`)
      return fs.readFileSync(p, 'utf8')
    }, `读取 out/${f}`)

  const [daily, insights, metricsRaw] = await Promise.all([read('daily.md'), read('insights.md'), read('metrics.json')])
  const m = JSON.parse(metricsRaw)
  await progress(ID, DEPT, 0.4, '三份上游产物已载入')

  await emit({ type: 'tool', agent: ID, dept: DEPT, tool: 'md.render', msg: `渲染 ${daily.length + insights.length} 字` })
  const dailyHtml = md2html(daily)
  const insightsHtml = md2html(insights)
  await progress(ID, DEPT, 0.65, '正文已排版')

  // ---- 真实一致性校验 ----
  const dailySum = [...daily.matchAll(/·\s*(\d+)\s*次提交/g)].reduce((s, x) => s + Number(x[1]), 0)
  const insightTotal = Number((insights.match(/\|\s*提交总数\s*\|\s*(\d+)\s*\|/) ?? [])[1] ?? -1)
  const wsFiles = m.workspace?.files ?? 0
  const checks = [
    { name: '日报逐天合计 = metrics.commits', pass: dailySum === m.commits, got: `${dailySum} vs ${m.commits}` },
    { name: '洞察提交总数 = metrics.commits', pass: insightTotal === m.commits, got: `${insightTotal} vs ${m.commits}` },
    { name: '工作区盘点非空', pass: wsFiles > 0, got: `${wsFiles} 文件 / ${m.workspace?.projects ?? 0} 项目` },
  ]
  const failed = checks.filter((c) => !c.pass)
  await emit({
    type: 'tool',
    agent: ID,
    dept: DEPT,
    tool: 'qa.assert',
    msg: failed.length ? `${failed.length} 项不一致` : `${checks.length} 项全部通过`,
  })
  await progress(ID, DEPT, 0.85, failed.length ? '发现数字不一致' : '数字校验通过')

  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(m.repo)} · AI 日报 / 周报</title>
<style>
:root{--bg:#0c1017;--panel:#131a24;--line:#222d3c;--fg:#e6ecf5;--dim:#8b9bb0;--acc:#4aa8ff;--ok:#3ddc97;--warn:#ffb454;--bad:#ff6b6b}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
.wrap{max-width:980px;margin:0 auto;padding:40px 24px 80px}
.head{border-bottom:1px solid var(--line);padding-bottom:20px;margin-bottom:28px}
h1{font-size:26px;margin:0 0 6px;letter-spacing:-.3px}
.sub{color:var(--dim);font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:22px 0 30px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.card .k{color:var(--dim);font-size:11px;letter-spacing:.08em;text-transform:uppercase}
.card .v{font-size:22px;font-weight:600;margin-top:4px;font-variant-numeric:tabular-nums}
h2{font-size:17px;margin:34px 0 10px;padding-left:10px;border-left:3px solid var(--acc)}
h3{font-size:15px;margin:22px 0 8px;color:#c9d6e6}
table{width:100%;border-collapse:collapse;margin:12px 0;font-size:13px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)}
th{color:var(--dim);font-weight:500;font-size:12px}
code{background:#1b2431;padding:1px 6px;border-radius:4px;font-size:12px;color:#9fd0ff}
blockquote{margin:10px 0;padding:8px 14px;border-left:2px solid #2c3b4f;color:var(--dim);font-size:13px}
ul{padding-left:20px}li{margin:4px 0}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:8px 22px 18px;margin-top:8px}
.qa{margin-top:36px;border-top:1px solid var(--line);padding-top:20px;font-size:13px}
.qa div{display:flex;gap:10px;align-items:baseline}
.dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto;margin-top:7px}
.ok{background:var(--ok)}.bad{background:var(--bad)}
.tag{display:inline-block;background:#182634;color:var(--acc);border-radius:20px;padding:2px 10px;font-size:11px;margin-left:8px;vertical-align:middle}
</style></head><body><div class="wrap">
<div class="head">
  <h1>${esc(m.repo)} · AI 日报 / 周报<span class="tag">真实数据</span></h1>
  <div class="sub">分支 <code>${esc(m.branch)}</code> · HEAD <code>${esc(m.head)}</code> · 窗口最近 ${m.range.days} 天 · 生成于 ${esc(new Date(m.generatedAt).toLocaleString('zh-CN'))}</div>
</div>
<div class="grid">
  <div class="card"><div class="k">Commit</div><div class="v">${m.commits}</div></div>
  <div class="card"><div class="k">+ / −</div><div class="v">+${m.insertions}<span style="color:var(--dim)">/−${m.deletions}</span></div></div>
  <div class="card"><div class="k">活跃天数</div><div class="v">${Object.keys(m.byDay).length}</div></div>
  <div class="card"><div class="k">涉及文件</div><div class="v">${m.filesTouched}</div></div>
  <div class="card"><div class="k">工作区</div><div class="v">${(m.workspace?.files ?? 0).toLocaleString('en-US')}<span style="font-size:13px;color:var(--dim)"> 文件</span></div></div>
  <div class="card"><div class="k">项目 / 活跃</div><div class="v">${m.workspace?.projects ?? 0}<span style="font-size:13px;color:var(--dim)"> / ${m.workspace?.activeProjects ?? 0}</span></div></div>
</div>
<div class="panel">${insightsHtml}</div>
<div class="panel">${dailyHtml}</div>
<div class="qa">
  <div style="color:var(--dim);margin-bottom:8px">一致性校验 · 由 renderer 进程在 ${new Date().toLocaleTimeString('zh-CN')} 实际执行</div>
  ${checks.map((c) => `<div><i class="dot ${c.pass ? 'ok' : 'bad'}"></i><span>${esc(c.name)} <span style="color:var(--dim)">(${esc(c.got)})</span></span></div>`).join('\n  ')}
</div>
<footer style="margin-top:36px;color:var(--dim);font-size:12px">由 ai-digest 多进程流水线生成 · collector → writer / analyst → renderer · 事件流见 Agent HQ</footer>
</div></body></html>`

  await tracedTool(ID, DEPT, 'file.write', async () => fs.writeFileSync(path.join(OUT, 'report.html'), html), `写 out/report.html（${(html.length / 1024).toFixed(1)} KB）`)

  await emit({ type: 'tool', agent: ID, dept: DEPT, tool: 'qa.report', msg: failed.length ? failed.map((f) => f.name).join('; ') : '全部通过' })
  await progress(ID, DEPT, 1, failed.length ? `${failed.length} 项校验失败` : '校验通过')

  if (failed.length) {
    // 真实的失败：不发 done，发 error
    await fail(ID, DEPT, `一致性校验失败：${failed.map((f) => f.name).join('；')}`)
    console.error('[renderer] 校验失败', failed)
    process.exit(2)
  }

  await done(ID, DEPT, { tokens: 0, artifacts: ['out/report.html'] })
  console.log(`[renderer] ${(html.length / 1024).toFixed(1)} KB → out/report.html（校验 ${checks.length} 项通过）`)
}

main().catch(async (e) => {
  await fail(ID, DEPT, String(e.message ?? e))
  console.error(e)
  process.exit(1)
})
