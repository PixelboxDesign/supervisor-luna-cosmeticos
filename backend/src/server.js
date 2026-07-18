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

// Alias para compatibilidade
app.post('/logs/ingest', (req, res) => {
  req.url = '/ingest';
  app._router.handle(req, res, () => {});
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
