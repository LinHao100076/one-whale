#!/usr/bin/env node
/**
 * ui-server.mjs — one-whale 本地面板
 *
 * 零依赖，只用 Node 内置 http。默认 http://127.0.0.1:8787
 * 读腾讯 MemoryCore 的原子记忆 + 我们合成的 persona.md，渲染成一页。
 */
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const GATEWAY = process.env.TDAI_GATEWAY_URL || 'http://127.0.0.1:8420'
const GATEWAY_KEY = process.env.TDAI_GATEWAY_API_KEY || 'local-dev-key'
const SERVICE_ID = process.env.TDAI_SERVICE_ID || 'default'
const DATA_DIR = path.join(os.homedir(), '.memory-tencentdb', 'memory-tdai')
const PERSONA_FILE = path.join(os.homedir(), '.dsh', 'whale-persona', 'persona.md')
const PORT = Number(process.env.WHALE_UI_PORT || 8787)

const TYPE_LABEL = {
  persona: '画像 / 偏好', instruction: '规则 / 雷区', work_fact: '项目事实',
  episodic: '经历', work_task: '待办', work_method: '方法', work_artifact: '产物',
}
const TYPE_COLOR = {
  persona: '#6ea8fe', instruction: '#ff8fab', work_fact: '#8bd450',
  episodic: '#ffd166', work_task: '#c792ea', work_method: '#4dd0e1', work_artifact: '#b0bec5',
}

const MAX_ATOMS = Number(process.env.WHALE_MAX_ATOMS || 20000)

async function fetchAtoms() {
  const all = []
  for (let offset = 0; offset < MAX_ATOMS; offset += 100) {
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
    const items = (await res.json())?.data?.items ?? []
    all.push(...items)
    if (items.length < 100) break
  }
  return all
}

function dirSize(dir) {
  let total = 0
  const walk = (d) => {
    let entries
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else { try { total += fs.statSync(p).size } catch {} }
    }
  }
  walk(dir)
  return total
}

function readPersona() {
  try { return fs.readFileSync(PERSONA_FILE, 'utf8') } catch { return '' }
}

async function state() {
  const atoms = await fetchAtoms()
  const persona = readPersona()
  const byType = {}
  for (const a of atoms) byType[a.type] = (byType[a.type] ?? 0) + 1
  const stamp = persona.match(/\*由 persona-synth[^*]*\*/)?.[0] ?? ''
  return {
    atoms,
    persona,
    stamp,
    stats: { total: atoms.length, byType, bytes: dirSize(DATA_DIR), lastSynth: stamp },
  }
}

// ── 页面 ────────────────────────────────────────────────────────────────
const HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>one-whale</title>
<style>
  :root{--bg:#0d1117;--card:#161b22;--line:#21262d;--fg:#e6edf3;--dim:#8b949e;--accent:#6ea8fe}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);
       font:14px/1.7 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
  .wrap{max-width:1180px;margin:0 auto;padding:28px 20px 60px}
  header{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:6px}
  h1{margin:0;font-size:22px;letter-spacing:.5px}
  h1 span{color:var(--accent)}
  .sub{color:var(--dim);font-size:13px}
  .chips{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0 22px}
  .chip{background:var(--card);border:1px solid var(--line);border-radius:999px;
        padding:6px 13px;font-size:12.5px;color:var(--dim)}
  .chip b{color:var(--fg);font-weight:600}
  .grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:18px}
  @media(max-width:900px){.grid{grid-template-columns:1fr}}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .card h2{margin:0;padding:14px 16px;font-size:13px;font-weight:600;color:var(--dim);
           border-bottom:1px solid var(--line);display:flex;justify-content:space-between;
           align-items:center;letter-spacing:.6px;text-transform:uppercase}
  .body{padding:16px}
  pre{margin:0;white-space:pre-wrap;word-break:break-word;font:13px/1.75 inherit}
  .persona h3{margin:18px 0 6px;font-size:15px;color:var(--accent)}
  .persona h3:first-child{margin-top:0}
  .persona h4{margin:14px 0 4px;font-size:13.5px;color:var(--fg)}
  .persona ul{margin:4px 0 10px;padding-left:20px}
  .persona li{margin:2px 0}
  .persona p{margin:6px 0}
  .persona em{color:var(--dim);font-style:normal;font-size:12px}
  .atom{display:flex;gap:10px;padding:9px 0;border-bottom:1px dashed var(--line)}
  .atom:last-child{border-bottom:0}
  .tag{flex:none;font-size:11px;padding:1px 8px;border-radius:6px;
       background:#0d1117;border:1px solid var(--line);height:20px;line-height:18px}
  .txt{flex:1;min-width:0;word-break:break-word}
  button{background:var(--accent);color:#0d1117;border:0;border-radius:8px;
         padding:7px 14px;font-size:12.5px;font-weight:600;cursor:pointer}
  button:disabled{opacity:.5;cursor:default}
  .empty{color:var(--dim);text-align:center;padding:26px 0}
  .err{color:#ff8fab;padding:12px 16px;font-size:13px}
  footer{color:var(--dim);font-size:12px;margin-top:22px;text-align:center}
  a{color:var(--accent);text-decoration:none}
</style></head><body><div class="wrap">
<header>
  <h1>one-whale<span>.</span></h1>
  <div class="sub">一条鱼，所有渠道 · 记忆底座 + 自己的人格层</div>
</header>
<div class="chips" id="chips"><div class="chip">加载中…</div></div>
<div class="grid">
  <section class="card">
    <h2>主人档案 <button id="synth">重新合成</button></h2>
    <div class="body persona" id="persona"><div class="empty">还没有合成过</div></div>
  </section>
  <section class="card">
    <h2>记忆（L1 原子） <span id="mcount" class="sub"></span></h2>
    <div class="body" id="atoms"><div class="empty">加载中…</div></div>
  </section>
</div>
<footer>读自 TencentDB Agent Memory · <span id="gw"></span></footer>
</div>
<script>
const TC = ${JSON.stringify(TYPE_COLOR)};
const TL = ${JSON.stringify(TYPE_LABEL)};
const esc = s => s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

function renderPersona(md){
  if(!md) return '<div class="empty">还没有合成过 —— 点右上角「重新合成」</div>';
  return md.split('\\n').map(l=>{
    if(/^#\\s/.test(l)) return '<h3>'+esc(l.replace(/^#\\s+/,''))+'</h3>';
    if(/^##\\s/.test(l)) return '<h4>'+esc(l.replace(/^##\\s+/,''))+'</h4>';
    if(/^###\\s/.test(l)) return '<h4>'+esc(l.replace(/^###\\s+/,''))+'</h4>';
    if(/^\\s*[-*]\\s/.test(l)) return '<li>'+esc(l.replace(/^\\s*[-*]\\s+/,''))+'</li>';
    if(/^---+$/.test(l.trim())) return '<hr style="border:0;border-top:1px solid #21262d;margin:14px 0">';
    if(/^\\*.*\\*$/.test(l.trim())) return '<p><em>'+esc(l.trim().replace(/^\\*|\\*$/g,''))+'</em></p>';
    if(!l.trim()) return '';
    return '<p>'+esc(l)+'</p>';
  }).join('').replace(/(<li>.*?<\\/li>)+/gs, m=>'<ul>'+m+'</ul>');
}

async function load(){
  try{
    const r = await fetch('/api/state'); const s = await r.json();
    if(s.error) throw new Error(s.error);
    const chips = [
      ['记忆', s.stats.total + ' 条'],
      ['类型', Object.entries(s.stats.byType).map(([k,v])=>TL[k]||k+':'+v).join(' · ') || '—'],
      ['数据', (s.stats.bytes/1048576).toFixed(1) + ' MB'],
    ];
    document.getElementById('chips').innerHTML =
      chips.map(([k,v])=>'<div class="chip">'+k+' <b>'+esc(String(v))+'</b></div>').join('');
    document.getElementById('persona').innerHTML = renderPersona(s.persona);
    document.getElementById('mcount').textContent = s.stats.total ? s.stats.total + ' 条' : '';
    document.getElementById('atoms').innerHTML = s.atoms.length
      ? s.atoms.map(a=>'<div class="atom"><span class="tag" style="color:'+(TC[a.type]||'#8b949e')+'">'
          +(TL[a.type]||a.type)+'</span><span class="txt">'+esc(a.content)+'</span></div>').join('')
      : '<div class="empty">还没有记忆</div>';
    document.getElementById('gw').textContent = location.hostname + ' · ' + new Date().toLocaleString('zh-CN');
  }catch(e){
    document.getElementById('atoms').innerHTML = '<div class="err">读取失败：'+esc(String(e.message))+'</div>';
  }
}
document.getElementById('synth').onclick = async (ev) => {
  const b = ev.target; b.disabled = true; b.textContent = '合成中…';
  try{
    const r = await fetch('/api/synth', {method:'POST'}); const j = await r.json();
    if(j.error) alert('合成失败：' + j.error);
    await load();
  }catch(e){ alert('合成失败：' + e.message) }
  b.disabled = false; b.textContent = '重新合成';
};
load();
setInterval(load, 15000);
</script>
</body></html>`

// ── 路由 ────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const send = (code, type, body) => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' })
    res.end(body)
  }

  if (url.pathname === '/') return send(200, 'text/html; charset=utf-8', HTML)

  if (url.pathname === '/api/state') {
    try {
      return send(200, 'application/json', JSON.stringify(await state()))
    } catch (e) {
      return send(200, 'application/json', JSON.stringify({ error: String(e.message) }))
    }
  }

  if (url.pathname === '/api/synth' && req.method === 'POST') {
    return execFile(process.execPath, [path.join(ROOT, 'src', 'persona-synth.mjs')],
      { cwd: ROOT, env: process.env, timeout: 120000 },
      (err, stdout, stderr) => {
        if (err) return send(200, 'application/json',
          JSON.stringify({ error: (stderr || err.message).trim().slice(0, 400) }))
        send(200, 'application/json', JSON.stringify({ ok: true, out: stdout.slice(0, 200) }))
      })
  }

  send(404, 'text/plain; charset=utf-8', 'not found')
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`one-whale UI → http://127.0.0.1:${PORT}`)
  console.log(`gateway: ${GATEWAY} · data: ${DATA_DIR}`)
})
