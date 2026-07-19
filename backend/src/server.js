/**
 * Supervisor de Logs — Luna Cosméticos
 * Porta 4500 — Backend local
 *
 * Rotas:
 *   POST /ingest          — recebe lote de logs do backend principal
 *   GET  /live            — buffer em memória (últimos 500)
 *   GET  /history/search  — busca em arquivos NDJSON
 *   POST /clear-live      — limpa buffer em memória
 *   WS   /ws              — WebSocket ao vivo
 */

const express  = require('express');
const cors     = require('cors');
const http     = require('http');
const { WebSocketServer } = require('ws');
const fs       = require('fs');
const path     = require('path');

// ── Config ────────────────────────────────────────────────────────────────────
const PORT     = parseInt(process.env.SUPERVISOR_PORT) || 4500;
const LOG_DIR  = process.env.LOG_DIR || path.join(__dirname, '..', 'logs');
const MAX_LIVE = 500; // logs em memória

// URLs dos serviços Render para keep-alive (separados por vírgula no .env)
const KEEP_ALIVE_URLS = (process.env.KEEP_ALIVE_URLS || '').split(',').map(u => u.trim()).filter(Boolean);

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// ── Estado em memória ─────────────────────────────────────────────────────────
let liveLogs = []; // buffer circular dos últimos MAX_LIVE logs

// ── Utils ─────────────────────────────────────────────────────────────────────
function hoje() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function logFilePath(date) {
  return path.join(LOG_DIR, `${date}.ndjson`);
}

function appendLog(entry) {
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(logFilePath(hoje()), line, 'utf-8');
}

function normalizeEntry(raw) {
  return {
    id:        raw.id         || `${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
    timestamp: raw.timestamp  || new Date().toISOString(),
    level:     raw.level      || 'info',      // info | warn | error | debug
    source:    raw.source     || 'backend',   // backend | frontend | system
    module:    raw.module     || '',
    message:   raw.message    || '',
    meta:      raw.meta       || null,
    session:   raw.session    || null,
    duration:  raw.duration   || null,
    status:    raw.status     || null,
  };
}

// ── App Express ───────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

app.use(cors({ origin: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ limit: '10mb' }));

// ── WebSocket ─────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

wss.on('connection', ws => {
  // Ao conectar, envia os últimos logs em memória
  ws.send(JSON.stringify({ type: 'history', logs: liveLogs }));
  ws.on('error', () => {});
});

// ── Rotas ─────────────────────────────────────────────────────────────────────

// Health
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), logs: liveLogs.length });
});

// Ingestão de logs (batch ou único)
app.post('/ingest', (req, res) => {
  try {
    const body    = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const entries = Array.isArray(body) ? body : [body];

    const normalized = entries.map(normalizeEntry);

    // Persistir em arquivo NDJSON
    normalized.forEach(e => appendLog(e));

    // Adicionar ao buffer em memória
    liveLogs.push(...normalized);
    if (liveLogs.length > MAX_LIVE) liveLogs = liveLogs.slice(-MAX_LIVE);

    // Broadcast via WebSocket
    broadcast({ type: 'logs', logs: normalized });

    res.json({ ok: true, count: normalized.length });
  } catch(e) {
    console.error('[ingest] erro:', e.message);
    res.status(400).json({ error: e.message });
  }
});

// ── Servir painel HTML ────────────────────────────────────────────────────────
// Tenta servir o build do Vite; caso não exista, serve painel inline
const DIST_DIR = path.join(__dirname, '..', 'frontend', 'dist');

app.get('/panel', (_req, res) => {
  const indexHtml = path.join(DIST_DIR, 'index.html');
  if (fs.existsSync(indexHtml)) {
    res.sendFile(indexHtml);
  } else {
    // Painel inline mínimo — redireciona para a SPA em memória
    res.redirect('/');
  }
});

if (fs.existsSync(DIST_DIR)) {
  const serveStatic = require('serve-static');
  app.use(serveStatic(DIST_DIR));
}

// Fallback: painel HTML básico inline quando não há build
app.get('/', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <title>Supervisor — Luna Cosméticos</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#0f1117;color:#e2e8f0;font-family:-apple-system,sans-serif;font-size:13px}
    #app{display:flex;flex-direction:column;height:100vh}
    header{background:#1a1d27;border-bottom:1px solid #2d3148;padding:0 1.25rem;height:52px;display:flex;align-items:center;gap:1rem}
    header h1{font-size:15px;font-weight:700;color:#e2e8f0}
    .dot{width:8px;height:8px;border-radius:50%;display:inline-block}
    .green{background:#22c55e;box-shadow:0 0 6px #22c55e}
    .red{background:#ef4444}
    #logs{flex:1;overflow-y:auto;padding:0.5rem 0;font-family:monospace;font-size:12px}
    .log{padding:4px 1rem;border-left:3px solid transparent;display:flex;gap:1rem;align-items:flex-start}
    .log.error{border-color:#ef4444;background:rgba(239,68,68,0.05)}
    .log.warn{border-color:#f59e0b;background:rgba(245,158,11,0.05)}
    .log.info{border-color:#3b82f6}
    .log.debug{border-color:#64748b;color:#64748b}
    .ts{color:#64748b;white-space:nowrap;flex-shrink:0}
    .lvl{width:45px;flex-shrink:0;font-weight:600;text-transform:uppercase;font-size:10px}
    .lvl.error{color:#f87171}.lvl.warn{color:#fbbf24}.lvl.info{color:#60a5fa}.lvl.debug{color:#64748b}
    .mod{color:#a78bfa;min-width:80px;flex-shrink:0}
    .msg{word-break:break-word}
    #status{font-size:12px;color:#64748b;display:flex;align-items:center;gap:0.5rem}
    #count{margin-left:auto;color:#64748b;font-size:12px}
    #clear{margin-left:0.5rem;background:rgba(239,68,68,0.15);color:#f87171;border:none;padding:3px 10px;border-radius:6px;cursor:pointer;font-size:12px}
  </style>
</head>
<body>
<div id="app">
  <header>
    <h1>🔍 Supervisor — Luna Cosméticos</h1>
    <div id="status"><span class="dot red" id="wsdot"></span> <span id="wsstate">Conectando...</span></div>
    <span id="count">0 logs</span>
    <button id="clear" onclick="clearLogs()">Limpar</button>
  </header>
  <div id="logs"></div>
</div>
<script>
const colors={error:'#f87171',warn:'#fbbf24',info:'#60a5fa',debug:'#64748b'};
let total=0;
const logsEl=document.getElementById('logs');
const countEl=document.getElementById('count');
const dotEl=document.getElementById('wsdot');
const stateEl=document.getElementById('wsstate');

function addLogs(entries){
  entries.forEach(e=>{
    const d=document.createElement('div');
    const ts=new Date(e.timestamp||Date.now()).toLocaleTimeString('pt-BR',{hour12:false});
    d.className='log '+(e.level||'info');
    d.innerHTML='<span class="ts">'+ts+'</span>'
      +'<span class="lvl '+(e.level||'info')+'">'+(e.level||'info')+'</span>'
      +'<span class="mod">'+(e.module||'')+'</span>'
      +'<span class="msg">'+(e.message||'').replace(/</g,'&lt;')+'</span>';
    logsEl.appendChild(d);
    total++;
  });
  countEl.textContent=total+' logs';
  logsEl.scrollTop=logsEl.scrollHeight;
}

function clearLogs(){
  logsEl.innerHTML='';total=0;countEl.textContent='0 logs';
  fetch('/clear-live',{method:'POST'});
}

function connect(){
  const proto=location.protocol==='https:'?'wss':'ws';
  const ws=new WebSocket(proto+'://'+location.host+'/ws');
  ws.onopen=()=>{dotEl.className='dot green';stateEl.textContent='Conectado';};
  ws.onclose=()=>{dotEl.className='dot red';stateEl.textContent='Reconectando...';setTimeout(connect,2000);};
  ws.onmessage=({data})=>{
    try{
      const msg=JSON.parse(data);
      if(msg.type==='history'||msg.type==='logs') addLogs(msg.logs||[]);
      else if(msg.type==='clear'){logsEl.innerHTML='';total=0;countEl.textContent='0 logs';}
    }catch(_){}
  };
}
connect();
</script>
</body>
</html>`);
});



// Buffer em memória
app.get('/live', (_req, res) => {
  res.json({ logs: liveLogs, count: liveLogs.length });
});

// Limpar buffer
app.post('/clear-live', (_req, res) => {
  liveLogs = [];
  broadcast({ type: 'clear' });
  res.json({ ok: true });
});

// Busca em histórico NDJSON
app.get('/history/search', (req, res) => {
  try {
    const {
      q        = '',
      level    = '',
      source   = '',
      module   = '',
      dateFrom = '',
      dateTo   = '',
      page     = '1',
      limit    = '100',
    } = req.query;

    const pg  = Math.max(1, parseInt(page));
    const lim = Math.min(500, Math.max(1, parseInt(limit)));

    // Listar arquivos NDJSON no período
    const allFiles = fs.readdirSync(LOG_DIR)
      .filter(f => f.endsWith('.ndjson'))
      .map(f => f.replace('.ndjson', ''))
      .sort()
      .filter(d => (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo));

    let results = [];

    for (const date of allFiles.reverse()) { // mais recente primeiro
      const filePath = logFilePath(date);
      const lines    = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);

      for (const line of lines.reverse()) {
        try {
          const entry = JSON.parse(line);
          if (level  && entry.level  !== level)  continue;
          if (source && entry.source !== source) continue;
          if (module && entry.module !== module) continue;
          if (q && !JSON.stringify(entry).toLowerCase().includes(q.toLowerCase())) continue;
          results.push(entry);
        } catch(_) {}
      }

      if (results.length > lim * pg * 2) break; // otimização: parar cedo
    }

    const total  = results.length;
    const offset = (pg - 1) * lim;
    const pagina = results.slice(offset, offset + lim);

    res.json({ logs: pagina, total, page: pg, limit: lim, totalPages: Math.ceil(total / lim) });
  } catch(e) {
    console.error('[history] erro:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Stats rápidos
app.get('/stats', (_req, res) => {
  try {
    const files  = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.ndjson'));
    const counts = { info: 0, warn: 0, error: 0, debug: 0 };
    for (const l of liveLogs) counts[l.level] = (counts[l.level] || 0) + 1;
    res.json({ totalFiles: files.length, liveCount: liveLogs.length, levelCounts: counts });
  } catch(e) {
    res.json({ totalFiles: 0, liveCount: 0, levelCounts: {} });
  }
});

// ── Keep-alive dos serviços Render ────────────────────────────────────────────
function keepAlive() {
  if (KEEP_ALIVE_URLS.length === 0) return;
  const https = require('https');
  const http2 = require('http');
  KEEP_ALIVE_URLS.forEach(url => {
    const lib = url.startsWith('https') ? https : http2;
    const req = lib.request(url, { method: 'HEAD' }, res => {
      console.log(`[keep-alive] ${url} → ${res.statusCode}`);
    });
    req.on('error', () => {});
    req.end();
  });
}

// Rodar keep-alive a cada 2 minutos
setInterval(keepAlive, 2 * 60 * 1000);

// ── Iniciar ───────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🚀 Supervisor Luna rodando na porta ${PORT}`);
  console.log(`📁 Logs em: ${LOG_DIR}`);
  console.log(`🔌 WebSocket: ws://localhost:${PORT}/ws`);
  if (KEEP_ALIVE_URLS.length > 0) {
    console.log(`🏓 Keep-alive: ${KEEP_ALIVE_URLS.length} serviços`);
  }
  console.log('');
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT',  () => process.exit(0));
