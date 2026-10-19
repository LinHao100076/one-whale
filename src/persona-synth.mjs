#!/usr/bin/env node
/**
 * persona-synth.mjs — 我们自己的 L3
 *
 * 腾讯那套的 L3 只会合成《Team Operating Doctrine》（骨架写死）。
 * 这个脚本只做一件事：把它存好的 L1 原子记忆取出来，用**我们自己的提示词**
 * 合成一份「使用者画像」，写成一个 Markdown 文件，供 DSH / 渠道适配器直接读。
 *
 * 用法：
 *   node persona-synth.mjs              合成并写入
 *   node persona-synth.mjs --dry        只打印，不写文件
 *   node persona-synth.mjs --show       只显示现有画像
 *
 * 数据来源：腾讯 MemoryCore（默认 http://127.0.0.1:8420）
 * 输出：~/.dsh/whale-persona/persona.md
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const GATEWAY = process.env.TDAI_GATEWAY_URL || 'http://127.0.0.1:8420'
const GATEWAY_KEY = process.env.TDAI_GATEWAY_API_KEY || 'local-dev-key'
const SERVICE_ID = process.env.TDAI_SERVICE_ID || 'default'
const OUT_DIR = path.join(os.homedir(), '.dsh', 'whale-persona')
const OUT_FILE = path.join(OUT_DIR, 'persona.md')

const DRY = process.argv.includes('--dry')
const SHOW = process.argv.includes('--show')

// ── 读 DeepSeek key（先环境变量，再 DSH 凭据库）────────────────────────
function deepseekKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY
  const p = path.join(os.homedir(), '.dsh', '.credentials.yaml')
  const text = fs.readFileSync(p, 'utf8')
  const m = text.match(/^\s*DEEPSEEK_API_KEY\s*:\s*(\S+)\s*$/m)
  if (!m) throw new Error('找不到 DEEPSEEK_API_KEY（env 或 ~/.dsh/.credentials.yaml）')
  return m[1].trim().replace(/^["']|["']$/g, '')
}

// ── 从 MemoryCore 取 L1 原子记忆 ────────────────────────────────────────
async function fetchAtoms() {
  const all = []
  for (let offset = 0; offset < 2000; offset += 100) {
    const res = await fetch(`${GATEWAY}/v3/atomic/query`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${GATEWAY_KEY}`,
        'x-tdai-service-id': SERVICE_ID,
      },
      body: JSON.stringify({ limit: 100, offset }),
    })
    if (!res.ok) throw new Error(`atomic/query ${res.status}: ${await res.text()}`)
    const json = await res.json()
    const items = json?.data?.items ?? []
    all.push(...items)
    if (items.length < 100) break
  }
  return all
}

// ── 我们的 L3 提示词（这才是"她的人格"，不是团队规范）────────────────────
const SYSTEM_PROMPT = `你要为一个助手写一份「主人档案」—— 她以后每次开口说话、每次做决定，都要先读这一页。

规则：
- 用**第二人称**写给助手自己看（"叫他阿鲸，别叫全名"），不是写给团队看的规范。
- 只写记忆里有依据的内容。没有依据的，宁可留空，**绝不编造**。
- 每条都要具体。"对香菜过敏"远好于"有饮食偏好"。"不许叫他胖，叫一次他会记着"远好于"注意称呼"。
- 语气平实，像便签，不像公文。

固定结构（没内容的小节直接省略）：

# 主人档案

## 怎么称呼他
## 他是个什么人
## 喜欢什么 / 讨厌什么
## 雷区（踩了会很惨）
## 正在做的事
## 跟他说话的方式`

function userPrompt(atoms) {
  const order = ['persona', 'instruction', 'work_fact', 'episodic', 'work_task', 'work_method', 'work_artifact']
  const label = {
    persona: '画像/偏好', instruction: '规则/雷区', work_fact: '项目事实',
    episodic: '经历过的事', work_task: '待办', work_method: '方法', work_artifact: '产物',
  }
  const groups = new Map()
  for (const a of atoms) {
    const t = order.includes(a.type) ? a.type : 'work_fact'
    if (!groups.has(t)) groups.set(t, [])
    groups.get(t).push(a.content)
  }
  const lines = [...order.filter((t) => groups.has(t)).map((t) =>
    `【${label[t]}】\n` + groups.get(t).map((c) => '- ' + c).join('\n'))]
  return `以下是目前存下来的全部记忆（共 ${atoms.length} 条）：\n\n${lines.join('\n\n')}\n\n请据此写出主人档案。`
}

// ── 调 DeepSeek 合成 ────────────────────────────────────────────────────
async function synth(atoms) {
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${deepseekKey()}` },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt(atoms) },
      ],
      temperature: 0.3,
      max_tokens: 1200,
    }),
  })
  if (!res.ok) throw new Error(`deepseek ${res.status}: ${await res.text()}`)
  const json = await res.json()
  return json.choices[0].message.content.trim()
}

// ── main ────────────────────────────────────────────────────────────────
if (SHOW) {
  if (!fs.existsSync(OUT_FILE)) { console.log('还没有生成过画像。'); process.exit(0) }
  console.log(fs.readFileSync(OUT_FILE, 'utf8'))
  process.exit(0)
}

const atoms = await fetchAtoms()
if (atoms.length === 0) {
  console.error('没有记忆，先往 MemoryCore 写点东西。')
  process.exit(1)
}

const byType = atoms.reduce((m, a) => ((m[a.type] = (m[a.type] ?? 0) + 1), m), {})
console.error(`取到 ${atoms.length} 条记忆：${JSON.stringify(byType)}`)

const md = await synth(atoms)
const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19)
const body = `${md}\n\n---\n\n*由 persona-synth 从 ${atoms.length} 条记忆合成 · ${stamp}*\n`

if (DRY) {
  console.log(body)
} else {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(OUT_FILE, body, 'utf8')
  console.log(`已写入 ${OUT_FILE}（${body.length} 字）\n`)
  console.log(body)
}
