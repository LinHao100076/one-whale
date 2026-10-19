#!/usr/bin/env node
/**
 * ui-server.mjs — one-whale 本地面板（L0–L3 四层）
 *
 * 零依赖，只用 Node 内置 http。默认 http://127.0.0.1:8787
 *
 *   L0 对话原文   /v3/conversation/query
 *   L1 原子记忆   /v3/atomic/query
 *   L2 场景块     /v3/scenario/ls + /read
 *   L3 人格       腾讯的 /v3/core/read  +  我们合成的 persona.md
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
const MAX_ATOMS = Number(process.env.WHALE_MAX_ATOMS || 20000)
const MAX_L0 = Number(process.env.WHALE_MAX_L0 || 200)

const TYPE_LABEL = {
  persona: '画像 / 偏好', instruction: '规则 / 雷区', work_fact: '项目事实',
  episodic: '经历', work_task: '待办', work_method: '方法', work_artifact: '产物',
}
const TYPE_COLOR = {
  persona: '#6ea8fe', instruction: '#ff8fab', work_fact: '#8bd450',
  episodic: '#ffd166', work_task: '#c792ea', work_method: '#4dd0e1', work_artifact: '#b0bec5',
}

// ── API helper ──────────────────────────────────────────────────────────
async function api(p, body = {}) {
  const res = await fetch(`${GATEWAY}${p}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${GATEWAY_KEY}`,
      'x-tdai-service-id': SERVICE_ID,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${p} ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return (await res.json())?.data
}

async function fetchAtoms() {
  const all = []
  for (let offset = 0; offset < MAX_ATOMS; offset += 100) {
    const d = await api('/v3/atomic/query', { limit: 100, offset })
    const items = d?.items ?? []
    all.push(...items)
    if (items.length < 100) break
  }
  return all
}

async function fetchL0() {
  const d = await api('/v3/conversation/query', { limit: 100, offset: 0 })
  return { messages: (d?.messages ?? []).slice(-MAX_L0), total: d?.total ?? 0 }
}

async function fetchL2() {
  const d = await api('/v3/scenario/ls', {})
  const entries = (d?.entries ?? []).filter((e) => !e.path.endsWith('/'))
  const withBody = []
  for (const e of entries) {
    try {
      const r = await api('/v3/scenario/read', { path: e.path })
      withBody.push({ ...e, content: r?.content ?? '' })
    } catch {
      withBody.push({ ...e, content: '' })
    }
  }
  return { entries: withBody, total: d?.total ?? entries.length }
}

function readPersona() {
  try { return fs.readFileSync(PERSONA_FILE, 'utf8') } catch { return '' }
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

async function state() {
  const [atoms, l0, l2, core] = await Promise.all([
    fetchAtoms().catch(() => []),
    fetchL0().catch(() => ({ messages: [], total: 0 })),
    fetchL2().catch(() => ({ entries: [], total: 0 })),
    api('/v3/core/read', {}).catch(() => null),
  ])
  const byType = {}
  for (const a of atoms) byType[a.type] = (byType[a.type] ?? 0) + 1
  return {
    l0, l1: atoms, l2,
    l3: { ours: readPersona(), tencent: core?.content ?? '', tencentUpdated: core?.updated_at ?? '' },
    stats: { total: atoms.length, byType, bytes: dirSize(DATA_DIR) },
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
  header{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:14px}
  h1{margin:0;font-size:22px;letter-spacing:.5px}
  h1 span{color:var(--accent)}
  .sub{color:var(--dim);font-size:13px}
  .chips{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 16px}
  .chip{background:var(--card);border:1px solid var(--line);border-radius:999px;
        padding:5px 12px;font-size:12.5px;color:var(--dim)}
  .chip b{color:var(--fg);font-weight:600}
  .tabs{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}
  .tab{background:var(--card);border:1px solid var(--line);color:var(--dim);
       padding:7px 15px;border-radius:9px;font-size:13px;cursor:pointer;user-select:none}
  .tab.on{color:var(--fg);border-color:var(--accent);background:#17223a}
  .tab i{font-style:normal;color:var(--accent);font-weight:600;margin-right:5px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .card h2{margin:0;padding:12px 16px;font-size:12px;font-weight:600;color:var(--dim);
           border-bottom:1px solid var(--line);display:flex;justify-content:space-between;
           align-items:center;letter-spacing:.6px}
  .body{padding:16px}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  @media(max-width:860px){.two{grid-template-columns:1fr}}
  pre{margin:0;white-space:pre-wrap;word-break:break-word;font:13px/1.75 inherit}
  .md h3{margin:16px 0 6px;font-size:15px;color:var(--accent)}
  .md h3:first-child{margin-top:0}
  .md h4{margin:13px 0 4px;font-size:13.5px}
  .md ul{margin:4px 0 10px;padding-left:20px}
  .md p{margin:6px 0}
  .md em{color:var(--dim);font-style:normal;font-size:12px}
  .atom{display:flex;gap:10px;padding:8px 0;border-bottom:1px dashed var(--line)}
  .atom:last-child{border-bottom:0}
  .tag{flex:none;font-size:11px;padding:1px 8px;border-radius:6px;background:#0d1117;
       border:1px solid var(--line);height:20px;line-height:18px}
  .txt{flex:1;min-width:0;word-break:break-word}
  .msg{padding:8px 0;border-bottom:1px dashed var(--line)}
  .msg:last-child{border-bottom:0}
  .role{font-size:11px;color:var(--dim);margin-right:8px}
  .role.user{color:#8bd450}
  .scene{border-bottom:1px dashed var(--line);padding:10px 0}
  .scene:last-child{border-bottom:0}
  .scene .p{color:var(--accent);font-size:12.5px}
  .scene .s{color:var(--dim);font-size:12.5px;margin:2px 0 6px}
  .scene pre{font-size:12.5px;color:#c9d1d9;background:#0d1117;padding:10px 12px;
             border-radius:8px;border:1px solid var(--line);max-height:280px;overflow:auto}
  button{background:var(--accent);color:#0d1117;border:0;border-radius:8px;
         padding:6px 13px;font-size:12.5px;font-weight:600;cursor:pointer}
  button:disabled{opacity:.5}
  .empty{color:var(--dim);text-align:center;padding:26px 0}
  .err{color:#ff8fab;padding:12px 16px;font-size:13px}
  footer{color:var(--dim);font-size:12px;margin-top:20px;text-align:center}
  .hide{display:none}
</style></head><body><div class="wrap">
<header>
  <h1>one-whale<span>.</span></h1>
  <div class="sub">一条鱼，所有渠道 · 四层记忆一眼看全</div>
</header>
<div class="chips" id="chips"><div class="chip">加载中…</div></div>

<div class="tabs">
  <div class="tab on" data-t="l3"><i>L3</i>人格</div>
  <div class="tab" data-t="l2"><i>L2</i>场景块</div>
  <div class="tab" data-t="l1"><i>L1</i>原子记忆</div>
  <div class="tab" data-t="l0"><i>L0</i>对话原文</div>
</div>

<section id="pane-l3">
  <div class="two">
    <div class="card"><h2>我们合成的 · 主人档案 <button id="synth">重新合成</button></h2>
      <div class="body md" id="ours"><div class="empty">还没有合成过</div></div></div>
    <div class="card"><h2>腾讯自带的 · 团队规范 <span class="sub" id="tencent-at"></span></h2>
      <div class="body md" id="tencent"><div class="empty">读不到</div></div></div>
  </div>
</section>

<section id="pane-l2" class="hide">
  <div class="card"><h2>场景块（L2） <span class="sub" id="l2-count"></span></h2>
    <div class="body" id="l2"><div class="empty">加载中…</div></div></div>
</section>

<section id="pane-l1" class="hide">
  <div class="card"><h2>原子记忆（L1） <span class="sub" id="l1-count"></span></h2>
    <div class="body" id="l1"><div class="empty">加载中…</div></div></div>
</section>

<section id="pane-l0" class="hide">
  <div class="card"><h2>对话原文（L0） <span class="sub" id="l0-count"></span></h2>
    <div class="body" id="l0"><div class="empty">加载中…</div></div></div>
</section>

<footer>读自 TencentDB Agent Memory · <span id="gw"></span></footer>
</div>
<script>
const TC = ${JSON.stringify(TYPE_COLOR)};
const TL = ${JSON.stringify(TYPE_LABEL)};
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

function renderMd(md){
  if(!md) return '';
  return md.split('\\n').map(l=>{
    if(/^#\\s/.test(l))  return '<h3>'+esc(l.replace(/^#\\s+/,''))+'</h3>';
    if(/^#{2,3}\\s/.test(l)) return '<h4>'+esc(l.replace(/^#{2,3}\\s+/,''))+'</h4>';
    if(/^\\s*[-*]\\s/.test(l)) return '<li>'+esc(l.replace(/^\\s*[-*]\\s+/,''))+'</li>';
    if(/^---+$/.test(l.trim())) return '<hr style="border:0;border-top:1px solid #21262d;margin:12px 0">';
    if(/^\\*.*\\*$/.test(l.trim())) return '<p><em>'+esc(l.trim().replace(/^\\*|\\*$/g,''))+'</em></p>';
    if(!l.trim()) return '';
    return '<p>'+esc(l)+'</p>';
  }).join('').replace(/(<li>.*?<\\/li>)+/gs, m=>'<ul>'+m+'</ul>');
}

document.querySelectorAll('.tab').forEach(t=>{
  t.onclick = () => {
    document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('on', x===t));
    ['l0','l1','l2','l3'].forEach(k=>
      document.getElementById('pane-'+k).classList.toggle('hide', k!==t.dataset.t));
  };
});

async function load(){
  try{
    const s = await (await fetch('/api/state')).json();
    if(s.error) throw new Error(s.error);
    const chips = [
      ['L0', s.l0.total + ' 条'],
      ['L1', s.l1.length + ' 条'],
      ['L2', s.l2.entries.length + ' 块'],
      ['L3', s.l3.ours ? '有' : '无'],
      ['数据', (s.stats.bytes/1048576).toFixed(1) + ' MB'],
    ];
    document.getElementById('chips').innerHTML =
      chips.map(([k,v])=>'<div class="chip">'+k+' <b>'+esc(v)+'</b></div>').join('');

    document.getElementById('ours').innerHTML = s.l3.ours ? renderMd(s.l3.ours)
      : '<div class="empty">还没有合成过 —— 点「重新合成」</div>';
    document.getElementById('tencent').innerHTML = s.l3.tencent ? renderMd(s.l3.tencent)
      : '<div class="empty">读不到</div>';
    document.getElementById('tencent-at').textContent = s.l3.tencentUpdated ? s.l3.tencentUpdated.slice(0,19).replace('T',' ') : '';

    document.getElementById('l2-count').textContent = s.l2.entries.length + ' 块';
    document.getElementById('l2').innerHTML = s.l2.entries.length
      ? s.l2.entries.map(e=>'<div class="scene"><div class="p">'+esc(e.path)+'</div>'
          +'<div class="s">'+esc(e.summary||'')+'</div>'
          +'<pre>'+esc((e.content||'').slice(0,1400))+'</pre></div>').join('')
      : '<div class="empty">还没有场景块</div>';

    document.getElementById('l1-count').textContent = s.l1.length + ' 条';
    document.getElementById('l1').innerHTML = s.l1.length
      ? s.l1.map(a=>'<div class="atom"><span class="tag" style="color:'+(TC[a.type]||'#8b949e')+'">'
          +(TL[a.type]||a.type)+'</span><span class="txt">'+esc(a.content)+'</span></div>').join('')
      : '<div class="empty">还没有原子记忆</div>';

    document.getElementById('l0-count').textContent = s.l0.total + ' 条（显示最近 ' + s.l0.messages.length + '）';
    document.getElementById('l0').innerHTML = s.l0.messages.length
      ? s.l0.messages.slice().reverse().map(m=>'<div class="msg"><span class="role '
          +(m.role==='user'?'user':'')+'">'+esc(m.role)+'</span>'+esc(m.content)+'</div>').join('')
      : '<div class="empty">还没有对话</div>';

    document.getElementById('gw').textContent = location.hostname + ':' + location.port;
  }catch(e){
    document.getElementById('chips').innerHTML = '<div class="chip">读取失败</div>';
    console.error(e);
  }
}

document.getElementById('synth').onclick = async (ev) => {
  const b = ev.target; b.disabled = true; b.textContent = '合成中…';
  try{
    const j = await (await fetch('/api/synth', {method:'POST'})).json();
    if(j.error) alert('合成失败：' + j.error);
    await load();
  }catch(e){ alert('合成失败：' + e.message) }
  b.disabled = false; b.textContent = '重新合成';
};
load();
setInterval(load, 20000);
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
        send(200, 'application/json', JSON.stringify({ ok: true }))
      })
  }

  send(404, 'text/plain; charset=utf-8', 'not found')
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`one-whale UI → http://127.0.0.1:${PORT}`)
  console.log(`gateway: ${GATEWAY} · data: ${DATA_DIR}`)
})
