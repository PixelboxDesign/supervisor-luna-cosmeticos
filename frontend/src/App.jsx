import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Activity, Search, Trash2, Download, Wifi, WifiOff,
  AlertCircle, AlertTriangle, Info, Bug, RefreshCw, Filter, X
} from 'lucide-react';

// ── Config ────────────────────────────────────────────────────────────────────
const API_BASE = import.meta.env.VITE_SUPERVISOR_URL || '';
const WS_URL   = import.meta.env.VITE_SUPERVISOR_WS  || (
  typeof window !== 'undefined'
    ? (window.location.protocol === 'https:' ? 'wss://' : 'ws://') +
      window.location.host.replace(':5174','') + ':4500/ws'
    : 'ws://localhost:4500/ws'
);

// ── Helpers ───────────────────────────────────────────────────────────────────
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function levelBadge(level) {
  const map = {
    error: 'badge badge-error',
    warn:  'badge badge-warn',
    info:  'badge badge-info',
    debug: 'badge badge-debug',
  };
  const icons = {
    error: <AlertCircle size={11}/>,
    warn:  <AlertTriangle size={11}/>,
    info:  <Info size={11}/>,
    debug: <Bug size={11}/>,
  };
  return (
    <span className={map[level] || 'badge badge-debug'}>
      {icons[level]} {level || 'info'}
    </span>
  );
}

function sourceBadge(source) {
  const col = source === 'frontend' ? '#a78bfa' : source === 'system' ? '#34d399' : '#60a5fa';
  return <span style={{ color: col, fontWeight: 600 }}>{source || 'backend'}</span>;
}

function fmtTime(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleTimeString('pt-BR', { hour12: false });
  } catch { return ts; }
}

function fmtDate(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('pt-BR', { hour12: false });
  } catch { return ts; }
}

function matchesFilter(log, { search, level, source, module }) {
  if (level  && log.level  !== level)  return false;
  if (source && log.source !== source) return false;
  if (module && log.module !== module) return false;
  if (search) {
    const q = search.toLowerCase();
    return (
      (log.message || '').toLowerCase().includes(q) ||
      (log.module  || '').toLowerCase().includes(q) ||
      (log.session || '').toLowerCase().includes(q) ||
      JSON.stringify(log.meta || '').toLowerCase().includes(q)
    );
  }
  return true;
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function App() {
  const [tab,       setTab]       = useState('live');   // 'live' | 'history'
  const [logs,      setLogs]      = useState([]);
  const [histLogs,  setHistLogs]  = useState([]);
  const [histTotal, setHistTotal] = useState(0);
  const [histPage,  setHistPage]  = useState(1);
  const [connected, setConnected] = useState(false);
  const [stats,     setStats]     = useState(null);
  const [paused,    setPaused]    = useState(false);
  const [filters,   setFilters]   = useState({ search: '', level: '', source: '', module: '' });
  const [histFilters, setHistFilters] = useState({ search: '', level: '', source: '', module: '', dateFrom: '', dateTo: '' });
  const [loading,   setLoading]   = useState(false);
  const [autoScroll,setAutoScroll]= useState(true);

  const wsRef      = useRef(null);
  const bottomRef  = useRef(null);
  const reconnRef  = useRef(null);
  const pausedRef  = useRef(paused);
  pausedRef.current = paused;

  // ── WebSocket ──────────────────────────────────────────────────────────────
  const connectWS = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen  = () => { setConnected(true); clearTimeout(reconnRef.current); };
    ws.onclose = () => {
      setConnected(false);
      reconnRef.current = setTimeout(connectWS, 3000);
    };
    ws.onerror = () => ws.close();

    ws.onmessage = ({ data }) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'history') {
          setLogs(msg.logs || []);
        } else if (msg.type === 'logs' && !pausedRef.current) {
          setLogs(prev => {
            const next = [...prev, ...(msg.logs || [])];
            return next.length > 500 ? next.slice(-500) : next;
          });
        } else if (msg.type === 'clear') {
          setLogs([]);
        }
      } catch {}
    };
  }, []);

  useEffect(() => {
    connectWS();
    fetchStats();
    const statsInterval = setInterval(fetchStats, 10000);
    return () => {
      wsRef.current?.close();
      clearTimeout(reconnRef.current);
      clearInterval(statsInterval);
    };
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && tab === 'live' && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll, tab]);

  // ── API calls ──────────────────────────────────────────────────────────────
  async function fetchStats() {
    try {
      const r = await fetch(`${API_BASE}/stats`);
      if (r.ok) setStats(await r.json());
    } catch {}
  }

  async function fetchHistory(page = 1) {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '100',
        ...Object.fromEntries(Object.entries(histFilters).filter(([,v]) => v))
      });
      const r = await fetch(`${API_BASE}/history/search?${params}`);
      if (r.ok) {
        const data = await r.json();
        setHistLogs(data.logs || []);
        setHistTotal(data.total || 0);
        setHistPage(page);
      }
    } catch {}
    setLoading(false);
  }

  async function clearLive() {
    await fetch(`${API_BASE}/clear-live`, { method: 'POST' });
    setLogs([]);
  }

  function exportCSV() {
    const rows = filteredLive.map(l =>
      [fmtDate(l.timestamp), l.level, l.source, l.module, l.message, l.session || '']
        .map(v => `"${String(v).replace(/"/g,'""')}"`)
        .join(',')
    );
    const csv = ['Timestamp,Level,Source,Module,Message,Session', ...rows].join('\n');
    const a   = document.createElement('a');
    a.href    = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `logs-luna-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  }

  // ── Filtros ────────────────────────────────────────────────────────────────
  const filteredLive = logs.filter(l => matchesFilter(l, filters));

  function setFilter(key, val) {
    setFilters(prev => ({ ...prev, [key]: val }));
  }
  function setHistFilter(key, val) {
    setHistFilters(prev => ({ ...prev, [key]: val }));
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

      {/* Header */}
      <header style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '0 1.25rem', height: 52, display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, fontSize: 15 }}>
          <Activity size={18} color="var(--primary)" />
          Supervisor — Luna Cosméticos
        </div>

        {/* Status conexão */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: 12, color: connected ? 'var(--success)' : 'var(--danger)' }}>
          <span className={`dot ${connected ? 'dot-green' : 'dot-red'} ${!connected ? 'pulse' : ''}`} />
          {connected ? 'Conectado' : 'Reconectando...'}
        </div>

        {/* Stats */}
        {stats && (
          <div style={{ display: 'flex', gap: '0.75rem', fontSize: 12, color: 'var(--text2)', marginLeft: '0.5rem' }}>
            <span style={{ color: '#f87171' }}>⬤ {stats.levelCounts?.error || 0} erros</span>
            <span style={{ color: '#fbbf24' }}>⬤ {stats.levelCounts?.warn  || 0} avisos</span>
            <span style={{ color: 'var(--text2)' }}>{stats.liveCount || 0} em memória · {stats.totalFiles || 0} arquivos</span>
          </div>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
          <button onClick={() => setPaused(p => !p)} title={paused ? 'Retomar' : 'Pausar'} style={{ background: paused ? 'rgba(245,158,11,0.2)' : 'var(--bg3)', color: paused ? 'var(--warning)' : 'var(--text2)', padding: '4px 10px', borderRadius: 6, fontSize: 12 }}>
            {paused ? '▶ Retomar' : '⏸ Pausar'}
          </button>
          <button onClick={() => setAutoScroll(a => !a)} title="Auto-scroll" style={{ background: autoScroll ? 'rgba(108,99,255,0.2)' : 'var(--bg3)', color: autoScroll ? 'var(--primary)' : 'var(--text2)', padding: '4px 10px', borderRadius: 6, fontSize: 12 }}>
            ↓ Auto
          </button>
          <button onClick={exportCSV} title="Exportar CSV" style={{ background: 'var(--bg3)', color: 'var(--text2)', padding: '4px 10px', borderRadius: 6, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Download size={13} /> CSV
          </button>
          <button onClick={clearLive} title="Limpar logs" style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', padding: '4px 10px', borderRadius: 6, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Trash2 size={13} /> Limpar
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '0 1.25rem', display: 'flex', gap: 0, flexShrink: 0 }}>
        {['live', 'history'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '8px 16px', background: 'none', color: tab === t ? 'var(--primary)' : 'var(--text2)', borderBottom: tab === t ? '2px solid var(--primary)' : '2px solid transparent', fontSize: 13, fontWeight: tab === t ? 600 : 400 }}>
            {t === 'live' ? '⚡ Ao Vivo' : '📁 Histórico'}
          </button>
        ))}
      </div>

      {/* Filtros */}
      <FilterBar
        filters={tab === 'live' ? filters : histFilters}
        setFilter={tab === 'live' ? setFilter : setHistFilter}
        isHistory={tab === 'history'}
        onSearch={() => fetchHistory(1)}
      />

      {/* Conteúdo */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {tab === 'live' ? (
          <LogTable logs={filteredLive} bottomRef={bottomRef} />
        ) : (
          <HistoryView
            logs={histLogs} total={histTotal} page={histPage}
            loading={loading} onPage={fetchHistory}
          />
        )}
      </div>
    </div>
  );
}

// ── FilterBar ─────────────────────────────────────────────────────────────────
function FilterBar({ filters, setFilter, isHistory, onSearch }) {
  return (
    <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '6px 1.25rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
      <Filter size={13} color="var(--text2)" />

      {/* Busca */}
      <div style={{ position: 'relative' }}>
        <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
        <input
          value={filters.search} placeholder="Buscar mensagem, módulo, sessão..."
          onChange={e => setFilter('search', e.target.value)}
          onKeyDown={e => isHistory && e.key === 'Enter' && onSearch()}
          style={{ paddingLeft: 26, paddingRight: 8, paddingTop: 4, paddingBottom: 4, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 12, width: 260 }}
        />
      </div>

      {/* Level */}
      <select value={filters.level} onChange={e => setFilter('level', e.target.value)}
        style={{ padding: '4px 8px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 12 }}>
        <option value="">Todos os níveis</option>
        <option value="error">Error</option>
        <option value="warn">Warn</option>
        <option value="info">Info</option>
        <option value="debug">Debug</option>
      </select>

      {/* Source */}
      <select value={filters.source} onChange={e => setFilter('source', e.target.value)}
        style={{ padding: '4px 8px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 12 }}>
        <option value="">Todas as fontes</option>
        <option value="backend">Backend</option>
        <option value="frontend">Frontend</option>
        <option value="system">System</option>
      </select>

      {/* Module */}
      <input value={filters.module} placeholder="Módulo..."
        onChange={e => setFilter('module', e.target.value)}
        style={{ padding: '4px 8px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 12, width: 120 }} />

      {/* Datas (só histórico) */}
      {isHistory && (
        <>
          <input type="date" value={filters.dateFrom} onChange={e => setFilter('dateFrom', e.target.value)}
            style={{ padding: '4px 8px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 12 }} />
          <span style={{ color: 'var(--text2)', fontSize: 12 }}>→</span>
          <input type="date" value={filters.dateTo} onChange={e => setFilter('dateTo', e.target.value)}
            style={{ padding: '4px 8px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 12 }} />
          <button onClick={onSearch} style={{ padding: '4px 12px', background: 'var(--primary)', color: '#fff', borderRadius: 6, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
            <RefreshCw size={12} /> Buscar
          </button>
        </>
      )}

      {/* Limpar filtros */}
      {(filters.search || filters.level || filters.source || filters.module) && (
        <button onClick={() => { setFilter('search',''); setFilter('level',''); setFilter('source',''); setFilter('module',''); }}
          style={{ padding: '4px 8px', background: 'rgba(239,68,68,0.1)', color: '#f87171', borderRadius: 6, fontSize: 12, display: 'flex', alignItems: 'center', gap: 3 }}>
          <X size={12} /> Limpar
        </button>
      )}
    </div>
  );
}

// ── LogTable ──────────────────────────────────────────────────────────────────
function LogTable({ logs, bottomRef }) {
  const [expanded, setExpanded] = useState(null);

  if (logs.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)', flexDirection: 'column', gap: '0.5rem' }}>
        <Activity size={32} opacity={0.3} />
        <span>Aguardando logs...</span>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', fontFamily: 'var(--mono)', fontSize: 12 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead style={{ position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 5 }}>
          <tr>
            {['Hora','Nível','Fonte','Módulo','Mensagem','Sessão'].map(h => (
              <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--text2)', fontWeight: 600, fontSize: 11, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {logs.map((log, i) => (
            <>
              <tr key={log.id || i}
                onClick={() => setExpanded(expanded === i ? null : i)}
                className="fade-in"
                style={{
                  cursor: 'pointer',
                  background: expanded === i ? 'var(--bg3)' : i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                  borderLeft: `3px solid ${log.level === 'error' ? 'var(--danger)' : log.level === 'warn' ? 'var(--warning)' : log.level === 'debug' ? 'var(--muted)' : 'var(--info)'}`,
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
                onMouseLeave={e => e.currentTarget.style.background = expanded === i ? 'var(--bg3)' : i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)'}
              >
                <td style={{ padding: '5px 10px', whiteSpace: 'nowrap', color: 'var(--text2)' }}>{fmtTime(log.timestamp)}</td>
                <td style={{ padding: '5px 10px' }}>{levelBadge(log.level)}</td>
                <td style={{ padding: '5px 10px' }}>{sourceBadge(log.source)}</td>
                <td style={{ padding: '5px 10px', color: 'var(--primary)', whiteSpace: 'nowrap' }}>{log.module || '—'}</td>
                <td style={{ padding: '5px 10px', maxWidth: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.message}</td>
                <td style={{ padding: '5px 10px', color: 'var(--text2)', whiteSpace: 'nowrap' }}>{log.session ? log.session.slice(0, 8) : '—'}</td>
              </tr>
              {expanded === i && (
                <tr key={`${log.id}-expanded`}>
                  <td colSpan={6} style={{ background: 'var(--bg3)', padding: '12px 16px', borderLeft: '3px solid var(--primary)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: log.meta ? '0.75rem' : 0 }}>
                      <div><span style={{ color: 'var(--text2)' }}>Timestamp:</span> <span>{fmtDate(log.timestamp)}</span></div>
                      <div><span style={{ color: 'var(--text2)' }}>Sessão:</span> <span>{log.session || '—'}</span></div>
                      {log.duration && <div><span style={{ color: 'var(--text2)' }}>Duração:</span> <span>{log.duration}ms</span></div>}
                      {log.status   && <div><span style={{ color: 'var(--text2)' }}>Status:</span> <span>{log.status}</span></div>}
                    </div>
                    {log.meta && (
                      <pre style={{ background: 'var(--bg)', padding: '8px', borderRadius: 6, fontSize: 11, overflowX: 'auto', color: '#a5d6a7', maxHeight: 200 }}>
                        {JSON.stringify(log.meta, null, 2)}
                      </pre>
                    )}
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
      <div ref={bottomRef} style={{ height: 1 }} />
    </div>
  );
}

// ── HistoryView ───────────────────────────────────────────────────────────────
function HistoryView({ logs, total, page, loading, onPage }) {
  const totalPages = Math.ceil(total / 100);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '6px 1.25rem', background: 'var(--bg2)', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--text2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <span>{total.toLocaleString('pt-BR')} logs encontrados</span>
        {loading && <span style={{ color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: 4 }}><RefreshCw size={12} className="pulse" /> Carregando...</span>}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button onClick={() => onPage(page - 1)} disabled={page <= 1 || loading} style={{ padding: '3px 8px', background: 'var(--bg3)', color: 'var(--text)', borderRadius: 4, fontSize: 12, opacity: page <= 1 ? 0.4 : 1 }}>«</button>
          <span>{page} / {totalPages || 1}</span>
          <button onClick={() => onPage(page + 1)} disabled={page >= totalPages || loading} style={{ padding: '3px 8px', background: 'var(--bg3)', color: 'var(--text)', borderRadius: 4, fontSize: 12, opacity: page >= totalPages ? 0.4 : 1 }}>»</button>
        </div>
      </div>
      <LogTable logs={logs} bottomRef={{ current: null }} />
    </div>
  );
}
