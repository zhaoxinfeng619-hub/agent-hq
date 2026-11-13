#!/usr/bin/env node
/**
 * collector —— 部门 data
 * 真实职责：
 *   1. 真的跑 git，读最近 N 天的提交
 *   2. 真的遍历工作区目录，统计每个项目的文件数 / 体积 / 最近活动
 *   3. --deep 时真的把每个代码/文档文件的内容读一遍（这是重活，耗时几十秒）
 *
 * 不是读死数据：换一个 --repo / --scan，结论就完全不同。
 */

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { identify, tracedTool, progress, done, fail } from '../lib/emit.mjs'

const run = promisify(execFile)

const ID = process.env.AGENT_ID ?? 'digest.collector'
const DEPT = 'data'
const REPO = process.env.REPO ?? path.resolve(process.cwd(), '../agent-hq')
const SCAN = process.env.SCAN ?? path.resolve(process.cwd(), '..')
const DAYS = Number(process.env.DAYS ?? 7)
const DEEP = process.env.DEEP === '1'
const OUT = path.resolve(process.cwd(), 'out')

const SKIP = new Set(['node_modules', '.git', 'dist', '.npm-cache', '.next', '__pycache__', '.venv'])
const CODE = new Set(['.ts', '.tsx', '.js', '.mjs', '.jsx', '.css', '.html', '.md', '.json', '.py', '.sh', '.yml', '.yaml', '.sql'])

async function git(args, cwd = REPO) {
  const { stdout } = await run('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 })
  return stdout
}

async function main() {
  await identify(ID, DEPT)
  fs.mkdirSync(OUT, { recursive: true })
  const cutoff = Date.now() - DAYS * 86400_000

  /* ---------- 1. git 历史 ---------- */
  await tracedTool(ID, DEPT, 'git.rev-parse', async () => git(['rev-parse', '--short', 'HEAD']), `校验仓库 ${path.basename(REPO)}`)
  await progress(ID, DEPT, 0.06, '仓库可达')

  const raw = await tracedTool(
    ID,
    DEPT,
    'git.log',
    () => git(['log', `--since=${DAYS} days ago`, '--numstat', '--date=short', '--pretty=format:@@%H|%an|%ad|%s']),
    `git log --since="${DAYS} days ago"`
  )
  await progress(ID, DEPT, 0.16, `提交日志 ${(raw.length / 1024).toFixed(1)} KB`)

  const commits = []
  const fileStat = new Map()
  const byDay = {}
  const byAuthor = {}
  let add = 0
  let del = 0
  let cur = null
  for (const line of raw.split('\n')) {
    if (line.startsWith('@@')) {
      const [hash, author, date, ...rest] = line.slice(2).split('|')
      cur = { hash: hash.slice(0, 8), author, date, subject: rest.join('|'), files: 0 }
      commits.push(cur)
      byDay[date] = (byDay[date] ?? 0) + 1
      byAuthor[author] = (byAuthor[author] ?? 0) + 1
      continue
    }
    if (!cur || !line.trim()) continue
    const [a, d, ...p] = line.split('\t')
    const file = p.join('\t')
    if (!file) continue
    cur.files++
    if (a !== '-') add += Number(a)
    if (d !== '-') del += Number(d)
    fileStat.set(file, (fileStat.get(file) ?? 0) + 1)
  }

  /* ---------- 2. 工作区盘点（真实遍历） ---------- */
  const projects = new Map()
  let totalFiles = 0
  let totalBytes = 0
  const extStat = {}
  let scanned = 0

  const walk = (dir, top) => {
    let ents
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      if (SKIP.has(e.name)) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(p, top)
      } else {
        let st
        try {
          st = fs.statSync(p)
        } catch {
          continue
        }
        scanned++
        totalFiles++
        totalBytes += st.size
        const ext = path.extname(e.name).toLowerCase()
        extStat[ext] = (extStat[ext] ?? 0) + 1
        const key = top ?? '~'
        let o = projects.get(key)
        if (!o) {
          o = { name: key, files: 0, bytes: 0, last: 0, recentFiles: 0, codeLoc: 0 }
          projects.set(key, o)
        }
        o.files++
        o.bytes += st.size
        if (st.mtimeMs > o.last) o.last = st.mtimeMs
        if (st.mtimeMs >= cutoff) o.recentFiles++
        // 只在 deep 时真的读内容算行数（重活）
        if (DEEP && CODE.has(ext) && st.size < 4 * 1024 * 1024) {
          try {
            const buf = fs.readFileSync(p, 'utf8')
            o.codeLoc += buf.length ? buf.split('\n').length : 0
          } catch {
            /* 编码问题跳过 */
          }
        }
      }
      if (scanned % 4000 === 0 && scanned > 0) {
        // 每 4000 个文件报一次真实进度（不 await，不拖慢遍历）
        progress(ID, DEPT, 0.2 + Math.min(0.55, (scanned / 70_000) * 0.55), `已扫 ${scanned} 个文件`)
      }
    }
  }

  await tracedTool(
    ID,
    DEPT,
    'fs.walk',
    async () => {
      // 以 SCAN 的每个直接子目录为一个"项目"，逐个真实遍历
      let ents = []
      try {
        ents = fs.readdirSync(SCAN, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of ents) {
        if (!e.isDirectory() || SKIP.has(e.name)) continue
        walk(path.join(SCAN, e.name), e.name)
      }
    },
    `遍历 ${path.basename(SCAN)}${DEEP ? '（读取内容）' : '（stat）'}`
  )
  await progress(ID, DEPT, 0.8, `${totalFiles} 文件 / ${(totalBytes / 1048576).toFixed(0)} MB / ${projects.size} 个项目`)

  const projList = [...projects.values()].sort((a, b) => b.last - a.last)
  const metrics = {
    repo: path.basename(REPO),
    repoPath: REPO,
    scanRoot: SCAN,
    head: (await git(['rev-parse', '--short', 'HEAD'])).trim(),
    branch: (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim(),
    range: { days: DAYS, deep: DEEP },
    commits: commits.length,
    insertions: add,
    deletions: del,
    filesTouched: fileStat.size,
    byDay,
    byAuthor,
    topFiles: [...fileStat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([f, n]) => ({ file: f, n })),
    recent: commits.slice(0, 20).map((c) => ({ ...c, subject: c.subject.slice(0, 72) })),
    workspace: {
      files: totalFiles,
      bytes: totalBytes,
      projects: projList.length,
      activeProjects: projList.filter((p) => p.recentFiles > 0).length,
      extStat: Object.entries(extStat).sort((a, b) => b[1] - a[1]).slice(0, 8),
      top: projList.slice(0, 10).map((p) => ({
        name: p.name,
        files: p.files,
        mb: +(p.bytes / 1048576).toFixed(1),
        recentFiles: p.recentFiles,
        loc: p.codeLoc,
        last: new Date(p.last).toISOString().slice(0, 10),
      })),
    },
    generatedAt: new Date().toISOString(),
    generatedBy: `${ID}@${process.pid}`,
    elapsedFree: true,
  }

  fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(metrics, null, 2))
  await progress(ID, DEPT, 1, `${commits.length} commits · ${totalFiles} 文件 · ${projects.size} 项目`)
  await done(ID, DEPT, { tokens: 0, artifacts: ['out/metrics.json'] })

  console.log(
    `[collector] ${commits.length} commits, ${fileStat.size} files changed, ` +
      `workspace ${totalFiles} files / ${(totalBytes / 1048576).toFixed(0)}MB / ${projects.size} projects → out/metrics.json`
  )
}

main().catch(async (e) => {
  await fail(ID, DEPT, String(e.message ?? e))
  console.error(e)
  process.exit(1)
})
