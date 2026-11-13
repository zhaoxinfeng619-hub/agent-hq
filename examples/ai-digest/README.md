# AI 日报 / 周报 · 真实多 agent 流水线

一个**真的会跑**的 AI 日报/周报生成器：4 个 worker 是真正的 OS 子进程，真的执行 `git`、真的遍历目录、真的读写文件，并把每一步通过 HTTP 打给 [Agent HQ](../..) 大屏。

大屏上出现的每个身影、每条连线、每个数字，都对应一次真实的进程和一次真实的工具调用。

---

## 30 秒跑起来

```bash
cd examples/ai-digest
npm run live
```

然后浏览器打开：

```
Agent-HQ-智能总部.html?live=1
```

顶栏会出现 `LIVE · 正常`，任务流开始滚动，研发部/产品部/设计部/数据部会各出现一个人，会议室会有人去开会。

其它用法：

```bash
npm run digest                 # 只跑一轮，看产物（不连大屏也能跑）
npm run live:slow              # 40 秒一轮，观察更从容
node run.mjs --repo ../foo --days 30 --deep    # 换仓库 / 换窗口 / 深扫
node run.mjs --scan /path/to/workspace         # 换盘点目录
node run.mjs --no-meeting      # 不要协同会议
```

产物在 `out/`：`metrics.json`（原始统计）、`daily.md`（日报）、`insights.md`（洞察）、`report.html`（可发的成品）。

---

## 为什么这是"真的"（4 条可验证判据）

### 1. bridge 不造事件

`relay` 模式下 bridge 只转发，自身不生成任何事件。启动即可验证：

```bash
curl -s localhost:8787/health
# {"ok":true,"mode":"relay","clients":1,"seq":0}
#                                   ↑ 序列号为 0 = 一条都没自己产生
curl -s "localhost:8787/events.json?since=0"
# []  ← 空数组，证明没有预录时间线
```

`--demo` 模式下 `seq` 会自己涨；`--relay` 下不跑流水线就永远停在 0。

### 2. 进程是真的

```bash
ps -ef | grep "ai-digest/workers" | grep -v grep
# 能看到 4 个独立的 node 进程，各自 pid 不同
```

每个事件都带 `_pid` 字段，可以核对它确实来自不同进程：

```bash
curl -s "localhost:8787/events.json?since=0" | python3 -c "
import json,sys
for e in json.load(sys.stdin)[:15]:
    print(e.get('_pid'), e['type'], e.get('agent'), e.get('tool') or '')
"
```

### 3. 依赖是真的

`collector` 必须先写出 `out/metrics.json`，`writer` / `analyst` 才读得到。把它删掉再直接跑 writer：

```bash
rm out/metrics.json && node workers/writer.mjs
# Error: metrics.json 不存在：collector 还没跑完
```

`writer` 和 `analyst` 是真并行（`Promise.all` + 两个子进程同时 `spawn`），不是排队假装。

### 4. 结论是真的

`insights.md` 里的每一条都由具体数字触发，命中才输出。当前这台机器跑出来的是：

- **巴士因子 = 1**：14 天内全部提交来自同一人
- **项目腐化风险**：83 个项目里只有 2 个在近 14 天有变更，98% 停滞

换个仓库、改个 `--days`，结论就会变。它们不是写死的文案。

---

## 架构

```
run.mjs  (orchestrator · 总监办公室)
  │
  ├─ 阶段1  串行 ─→ workers/collector.mjs   数据部   真跑 git + 真遍历 6 万个文件 → metrics.json
  │
  ├─ 阶段2  并行 ─┬→ workers/writer.mjs     产品部   读 metrics → 按天写 daily.md
  │               └→ workers/analyst.mjs    研发部   算趋势 + 规则判定 → insights.md
  │
  ├─ 阶段3  会议 ─→ 三方去会议室对齐数字口径
  │
  └─ 阶段4  串行 ─→ workers/renderer.mjs    设计部   合成 HTML + 校验数字一致性
```

阶段 4 的校验不是走形式：`renderer` 会把「日报逐天合计」「洞察提交总数」和 `metrics.json` 的真实值做比对，不一致就发 `agent.error` 并以退出码 2 结束——大屏上会真的红一下。

---

## 事件契约

打到 `POST /emit` 的 JSON，字段与 Agent HQ 一致：

| type | 作用 | 关键字段 |
| --- | --- | --- |
| `agent.start` | 某人开始干活 | `agent, dept, task` |
| `subagent.spawn` | 谁派了谁（大屏画发光连线） | `agent, parent, dept, task` |
| `tool` | 调了一次工具 | `agent, dept, tool, msg` |
| `progress` | 进度 0..1 | `agent, dept, p, msg` |
| `agent.done` | 完成 | `agent, dept` |
| `agent.error` | 失败（大屏告警） | `agent, dept, msg` |
| `meeting.start` / `meeting.end` | 去会议室协同 | `agents[], topic, ms` |
| `reset` | 清场重来 | — |

`dept` 取值：`product` `design` `eng` `market` `ops` `hr` `fin` `cs` `data` `strat` `director`。

---

## 接上你自己的运行时

### 方式 A：直接 POST（最简单）

任何能发起 HTTP 请求的脚本都能驱动大屏：

```bash
curl -X POST localhost:8787/emit -H 'content-type: application/json' \
  -d '{"type":"agent.start","agent":"my-agent","dept":"eng","task":"重构登录模块"}'
```

### 方式 B：跟读 JSONL（适合已有结构化日志）

Claude Code 的会话日志就在 `~/.claude/projects/<proj>/<session>.jsonl`，Codex 也有类似产物。写个几十行适配器把每条记录映射成上面的 type，落成 JSONL，然后：

```bash
node server/bridge.mjs --file ./run.jsonl
```

bridge 用 `tail -f` 语义跟读，追加即上屏。

### 方式 C：换成你自己的 worker

复制 `run.mjs` 的阶段结构，把 `spawn` 的目标换成你的真实任务（跑测试、调模型、发版），在关键节点调 `lib/emit.mjs` 的 `tracedTool()` / `progress()`。编排逻辑一行不用改。

---

## 已知限制（说实话）

1. **没有调用大模型**。这里的"AI"部分（摘要、措辞）由确定性规则生成，不是 LLM 写的。本机只有一个内部网关凭证，直调返回 401，按规矩我不会去动它。要接真模型，在 `writer.mjs` 里把 `humanize()` 换成一次 API 调用即可，其余不用动。
2. **单轮只有 7 秒左右**。因为任务本身就这么快（`stat` 6 万个文件只要 346ms，读一遍也就 26 秒）。想要更长的观察窗口，用 `--watch 14` 连续重跑，或 `--deep` 做全量内容读取。**我没有给流水线人为加 sleep**——大屏上看到的时长就是任务真实耗时。
3. **座位绑定是池化的**。同一次运行内外部 id 稳定回到同一张桌子；超过 25 秒没有事件会回收座位。所以连跑多轮时，同一个 agent 可能换桌子。
